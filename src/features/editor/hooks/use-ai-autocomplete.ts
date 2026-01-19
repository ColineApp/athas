import { useEffect, useMemo, useRef } from "react";
import { useAutocompleteKeyStore } from "@/features/ai/store/autocomplete-key-store";
import { useAiCompletionStore } from "@/features/editor/stores/ai-completion-store";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { useEditorUIStore } from "@/features/editor/stores/ui-store";
import type { Buffer } from "@/features/tabs/types/buffer";
import "@/utils/autocomplete-provider-registry";
import type { Position } from "@/features/editor/types/editor";
import { useSettingsStore } from "@/features/settings/store";
import { getAutocompleteProvider } from "@/utils/autocomplete-providers";
import { getProviderApiToken } from "@/utils/token-manager";

const MIN_CHARS_BETWEEN_REQUESTS = 2;
const CONTEXT_SIGNATURE_WINDOW = 80;
const TRIGGER_CHAR_REGEX = /[\s)\]}.,;:>]/;
const DEFAULT_MAX_TOKENS = 60;
const DEFAULT_TEMPERATURE = 0.3;
const RECENT_LINES_COUNT = 4;
const CURSOR_CONTEXT_WINDOW = 160;

const isMarkdownFile = (filePath?: string | null, language?: string | null): boolean => {
  if (language?.toLowerCase().includes("markdown")) return true;
  if (!filePath) return false;
  return /\.(md|markdown|mdx)$/i.test(filePath);
};

const isPlaintextFile = (filePath?: string | null, language?: string | null): boolean => {
  if (language?.toLowerCase() === "text") return true;
  if (!filePath) return false;
  return /\.(txt|log)$/i.test(filePath);
};

const getDocumentType = (buffer?: Buffer | null): "plaintext" | "markdown" | "code" => {
  if (!buffer) return "plaintext";
  if (isMarkdownFile(buffer.path, buffer.language ?? null)) return "markdown";
  if (isPlaintextFile(buffer.path, buffer.language ?? null)) return "plaintext";
  return "code";
};

const buildCursorContext = (text: string, cursorOffset: number): string => {
  const start = Math.max(0, cursorOffset - CURSOR_CONTEXT_WINDOW);
  const end = Math.min(text.length, cursorOffset + CURSOR_CONTEXT_WINDOW);
  return `${text.slice(start, cursorOffset)}<CURSOR>${text.slice(cursorOffset, end)}`;
};

const buildRecentText = (text: string, cursorOffset: number): string[] => {
  const before = text.slice(0, cursorOffset);
  const lines = before.split("\n");
  return lines.slice(Math.max(0, lines.length - RECENT_LINES_COUNT));
};

const shouldSkipBuffer = (buffer?: Buffer | null): boolean => {
  if (!buffer) return true;
  if (buffer.isDiff || buffer.isImage || buffer.isSQLite || buffer.isWebViewer) return true;
  if (buffer.isTerminal || buffer.isAgent) return true;
  return false;
};

interface UseAiAutocompleteOptions {
  bufferId?: string | null;
  filePath?: string | null;
  value: string;
  cursorPosition: Position;
  isLspCompletionVisible: boolean;
}

export const useAiAutocomplete = ({
  bufferId,
  filePath,
  value,
  cursorPosition,
  isLspCompletionVisible,
}: UseAiAutocompleteOptions) => {
  const aiCompletionEnabled = useEditorUIStore.use.aiCompletion();
  const lastInputTimestamp = useEditorUIStore.use.lastInputTimestamp();
  const selection = useEditorStateStore.use.selection();
  const multiCursorState = useEditorStateStore.use.multiCursorState();
  const autocompleteProviderId = useSettingsStore(
    (state) => state.settings.aiAutocompleteProviderId,
  );
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const activeBuffer = useBufferStore.use.buffers().find((b) => b.id === bufferId) || null;

  const providerKeyMap = useAutocompleteKeyStore.use.providerKeys();
  const checkKey = useAutocompleteKeyStore.use.actions().checkKey;

  const _suggestion = useAiCompletionStore.use.suggestion();
  const suggestionVisible = useAiCompletionStore.use.isVisible();
  const anchorOffset = useAiCompletionStore.use.cursorOffset();
  const anchorBufferId = useAiCompletionStore.use.bufferId();
  const rejectedByBuffer = useAiCompletionStore.use.rejectedByBuffer();
  const aiActions = useAiCompletionStore.use.actions();

  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const lastRequestOffsetRef = useRef<number | null>(null);
  const lastRequestSignatureRef = useRef<string | null>(null);
  const inFlightRef = useRef<boolean>(false);
  const lastInputRef = useRef<number>(0);

  const provider = useMemo(
    () => getAutocompleteProvider(autocompleteProviderId),
    [autocompleteProviderId],
  );

  useEffect(() => {
    aiActions.clearSuggestion();
  }, [provider?.id, aiActions]);

  useEffect(() => {
    if (!provider) return;
    checkKey(provider.id);
  }, [checkKey, provider]);

  const hasProviderKey = useMemo(() => {
    if (!provider) return false;
    if (!provider.requiresApiKey) return true;
    return providerKeyMap.get(provider.id) || false;
  }, [provider, providerKeyMap]);

  useEffect(() => {
    if (!aiCompletionEnabled || !hasProviderKey || isLspCompletionVisible) {
      aiActions.clearSuggestion();
    }
  }, [aiCompletionEnabled, hasProviderKey, isLspCompletionVisible, aiActions]);

  useEffect(() => {
    if (!provider) return;
    if (aiCompletionEnabled && !hasProviderKey) {
      void updateSetting("aiCompletion", false);
    }
  }, [aiCompletionEnabled, hasProviderKey, provider, updateSetting]);

  useEffect(() => {
    if (!suggestionVisible) return;
    if (!bufferId || bufferId !== anchorBufferId) {
      aiActions.clearSuggestion();
      return;
    }
    if (anchorOffset !== null && cursorPosition.offset !== anchorOffset) {
      aiActions.clearSuggestion();
    }
  }, [bufferId, anchorBufferId, anchorOffset, cursorPosition.offset, suggestionVisible, aiActions]);

  useEffect(() => {
    if (!aiCompletionEnabled) {
      console.log("[AI Autocomplete] skip: disabled");
      return;
    }
    if (!hasProviderKey) {
      console.log("[AI Autocomplete] skip: missing api key");
      return;
    }
    if (!provider) {
      console.log("[AI Autocomplete] skip: no provider");
      return;
    }
    if (!bufferId || !filePath) {
      console.log("[AI Autocomplete] skip: missing buffer/file");
      return;
    }
    if (shouldSkipBuffer(activeBuffer)) {
      console.log("[AI Autocomplete] skip: unsupported buffer type", {
        isDiff: activeBuffer?.isDiff,
        isImage: activeBuffer?.isImage,
        isSQLite: activeBuffer?.isSQLite,
        isWebViewer: activeBuffer?.isWebViewer,
        isTerminal: activeBuffer?.isTerminal,
        isAgent: activeBuffer?.isAgent,
      });
      return;
    }
    if (selection) {
      console.log("[AI Autocomplete] skip: selection active");
      aiActions.clearSuggestion();
      return;
    }
    if (multiCursorState && multiCursorState.cursors.length > 1) {
      console.log("[AI Autocomplete] skip: multi-cursor");
      aiActions.clearSuggestion();
      return;
    }
    if (isLspCompletionVisible) {
      console.log("[AI Autocomplete] skip: LSP completions visible");
      return;
    }
    if (!lastInputTimestamp) return;
    if (lastInputRef.current === lastInputTimestamp) {
      console.log("[AI Autocomplete] skip: no new input");
      return;
    }
    lastInputRef.current = lastInputTimestamp;

    if (suggestionVisible) {
      aiActions.clearSuggestion({ reject: true });
    }

    const anchor = {
      bufferId,
      cursorOffset: cursorPosition.offset,
      cursorLine: cursorPosition.line,
      cursorColumn: cursorPosition.column,
    };

    const run = async () => {
      if (lastInputTimestamp !== useEditorUIStore.getState().lastInputTimestamp) {
        return;
      }

      const latestBuffer = useBufferStore.getState().buffers.find((b) => b.id === bufferId);
      const latestContent = latestBuffer?.content ?? value;
      const cursorOffset = anchor.cursorOffset;
      const lineEndIndex = (() => {
        const nextNewline = latestContent.indexOf("\n", cursorOffset);
        return nextNewline === -1 ? latestContent.length : nextNewline;
      })();
      const lineTail = latestContent.slice(cursorOffset, lineEndIndex);
      if (lineTail.trim().length > 0) {
        console.log("[AI Autocomplete] skip: cursor not at end of line");
        return;
      }
      const charBeforeCursor = cursorOffset > 0 ? latestContent[cursorOffset - 1] : "";
      const shouldTriggerChar = charBeforeCursor ? TRIGGER_CHAR_REGEX.test(charBeforeCursor) : true;

      if (
        lastRequestOffsetRef.current !== null &&
        bufferId === anchor.bufferId &&
        cursorOffset - lastRequestOffsetRef.current < MIN_CHARS_BETWEEN_REQUESTS &&
        !shouldTriggerChar
      ) {
        return;
      }

      const signatureStart = Math.max(0, cursorOffset - CONTEXT_SIGNATURE_WINDOW);
      const signature = `${bufferId}:${cursorOffset}:${latestContent.slice(signatureStart, cursorOffset)}`;
      if (signature === lastRequestSignatureRef.current) {
        return;
      }

      lastRequestOffsetRef.current = cursorOffset;
      lastRequestSignatureRef.current = signature;

      if (inFlightRef.current && abortRef.current) {
        abortRef.current.abort();
        inFlightRef.current = false;
      }

      const controller = new AbortController();
      abortRef.current = controller;

      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      requestIdRef.current = requestId;
      aiActions.setLoading({ ...anchor, requestId });
      inFlightRef.current = true;

      try {
        console.log("[AI Autocomplete] request", {
          provider: provider.id,
          bufferId,
          cursorOffset: anchor.cursorOffset,
          cursorLine: anchor.cursorLine,
          cursorColumn: anchor.cursorColumn,
          documentType: getDocumentType(latestBuffer),
          recentText: buildRecentText(latestContent, anchor.cursorOffset),
          cursorContext: buildCursorContext(latestContent, anchor.cursorOffset),
        });
        const apiKey = await getProviderApiToken(provider.id);
        if (!apiKey) {
          aiActions.clearSuggestion();
          return;
        }

        const rejectedSuggestions = rejectedByBuffer.get(bufferId) || [];

        const request = {
          text: latestContent,
          cursorPosition: anchor.cursorOffset,
          maxTokens: DEFAULT_MAX_TOKENS,
          temperature: DEFAULT_TEMPERATURE,
          context: {
            documentType: getDocumentType(latestBuffer),
            cursorContext: buildCursorContext(latestContent, anchor.cursorOffset),
            recentText: buildRecentText(latestContent, anchor.cursorOffset),
            rejectedSuggestions,
          },
        };

        await provider.streamCompletion(
          request,
          apiKey,
          {
            onSuggestion: (nextSuggestion) => {
              if (requestIdRef.current !== requestId) return;
              const currentBufferId = useBufferStore.getState().activeBufferId;
              const currentCursor = useEditorStateStore.getState().cursorPosition;
              if (currentBufferId !== bufferId || currentCursor.offset !== anchor.cursorOffset) {
                return;
              }
              console.log("[AI Autocomplete] suggestion chunk", {
                provider: provider.id,
                requestId,
                length: nextSuggestion.length,
              });
              aiActions.setSuggestion({
                suggestion: nextSuggestion,
                ...anchor,
                requestId,
              });
            },
            onComplete: () => {
              if (requestIdRef.current !== requestId) return;
              inFlightRef.current = false;
              console.log("[AI Autocomplete] complete", {
                provider: provider.id,
                requestId,
                finalLength: useAiCompletionStore.getState().suggestion.length,
              });
            },
            onError: async (error) => {
              if (requestIdRef.current !== requestId) return;
              inFlightRef.current = false;
              console.warn("[AI Autocomplete] error", {
                provider: provider.id,
                requestId,
                status: error.status,
                code: error.code,
                message: error.message,
              });
              if (error.status === 401) {
                await checkKey(provider.id);
              }
              // Fallback to non-streaming for transient errors
              if (error.status === 0 || error.status >= 500) {
                try {
                  const response = await provider.requestCompletion(
                    request,
                    apiKey,
                    controller.signal,
                  );
                  aiActions.setSuggestion({
                    suggestion: response.suggestion,
                    ...anchor,
                    requestId,
                  });
                } catch {
                  aiActions.clearSuggestion();
                }
              } else {
                aiActions.clearSuggestion();
              }
            },
          },
          controller.signal,
        );
      } catch {
        inFlightRef.current = false;
        aiActions.clearSuggestion();
      }
    };

    void run();
  }, [
    aiCompletionEnabled,
    hasProviderKey,
    provider,
    bufferId,
    filePath,
    value,
    cursorPosition,
    lastInputTimestamp,
    selection,
    multiCursorState,
    isLspCompletionVisible,
    suggestionVisible,
    activeBuffer,
    rejectedByBuffer,
    aiActions,
    checkKey,
    updateSetting,
  ]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);
};
