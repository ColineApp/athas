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

// Context window sizes - balanced prefix/suffix like Void (~25 lines each)
const PREFIX_LINES = 25; // Lines before cursor
const SUFFIX_LINES = 25; // Lines after cursor
const MAX_LINE_LENGTH = 200; // Truncate very long lines
const FULL_FILE_LINE_THRESHOLD = 500; // Only small files get full context

// Cross-file context settings (inspired by Kilo)
const RELATED_FILES_MAX = 2; // Max related files to include
const RELATED_FILE_SNIPPET_LINES = 10; // Lines per related file
const CROSS_FILE_CONTEXT_ENABLED = true; // Toggle cross-file context

// Prediction types based on cursor context (inspired by Void)
type PredictionType =
  | "single-line-fill-middle" // Mid-line completion
  | "single-line-redo-suffix" // Few chars after cursor, ignore suffix
  | "multi-line" // Empty line or after accepted completion
  | "do-not-predict"; // Skip prediction

// Chars threshold for ignoring suffix
const SUFFIX_IGNORE_THRESHOLD = 3;

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

/**
 * Determine the prediction type based on cursor context (inspired by Void).
 * This helps decide what kind of completion to generate.
 */
const getPredictionType = (
  lineContent: string,
  cursorColumn: number,
  justAccepted: boolean,
): PredictionType => {
  const beforeCursor = lineContent.slice(0, cursorColumn);
  const afterCursor = lineContent.slice(cursorColumn);
  const trimmedBefore = beforeCursor.trim();
  const trimmedAfter = afterCursor.trim();

  // No prefix on line → don't predict (user hasn't started typing)
  if (trimmedBefore.length === 0 && trimmedAfter.length === 0) {
    return "multi-line"; // Empty line, could be starting a new block
  }

  // Just accepted a completion → continue with multi-line
  if (justAccepted) {
    return "multi-line";
  }

  // Few chars after cursor → ignore suffix and complete the line
  if (trimmedAfter.length > 0 && trimmedAfter.length <= SUFFIX_IGNORE_THRESHOLD) {
    return "single-line-redo-suffix";
  }

  // Mid-line with content after cursor → fill-middle
  if (trimmedAfter.length > SUFFIX_IGNORE_THRESHOLD) {
    return "single-line-fill-middle";
  }

  // At end of line with prefix → single-line fill
  if (trimmedBefore.length > 0 && trimmedAfter.length === 0) {
    return "single-line-fill-middle";
  }

  return "single-line-fill-middle";
};

const getLanguageFromPath = (filePath?: string | null): string => {
  if (!filePath) return "text";
  const ext = filePath.split(".").pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    cs: "csharp",
    rb: "ruby",
    php: "php",
    swift: "swift",
    kt: "kotlin",
    scala: "scala",
    r: "r",
    sql: "sql",
    sh: "bash",
    bash: "bash",
    zsh: "zsh",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    xml: "xml",
    html: "html",
    css: "css",
    scss: "scss",
    less: "less",
    md: "markdown",
    lua: "lua",
    vim: "vim",
    ex: "elixir",
    exs: "elixir",
    erl: "erlang",
    hs: "haskell",
    ml: "ocaml",
    fs: "fsharp",
    clj: "clojure",
    lisp: "lisp",
    el: "elisp",
  };
  return langMap[ext || ""] || "text";
};

/**
 * Split text into lines efficiently
 */
const splitLines = (text: string): string[] => {
  return text.split("\n");
};

/**
 * Truncate a line if it's too long, preserving context around the cursor
 */
const truncateLine = (line: string, cursorColumn?: number): string => {
  if (line.length <= MAX_LINE_LENGTH) return line;

  if (cursorColumn !== undefined && cursorColumn < line.length) {
    // Keep context around cursor
    const contextBefore = Math.floor(MAX_LINE_LENGTH * 0.6);
    const contextAfter = MAX_LINE_LENGTH - contextBefore;
    const start = Math.max(0, cursorColumn - contextBefore);
    const end = Math.min(line.length, cursorColumn + contextAfter);
    return (start > 0 ? "..." : "") + line.slice(start, end) + (end < line.length ? "..." : "");
  }

  // No cursor info, just truncate from end
  return `${line.slice(0, MAX_LINE_LENGTH)}...`;
};

/**
 * Build a simple, focused context for autocomplete.
 *
 * Format:
 * ```
 * // File: path/to/file.ts
 * // Language: typescript
 *
 * <prefix lines>
 * <current line prefix>█<current line suffix>
 * <suffix lines>
 * ```
 *
 * The █ marker indicates cursor position.
 */
const buildSimpleContext = (
  text: string,
  _cursorOffset: number,
  cursorLine: number,
  cursorColumn: number,
  filePath?: string | null,
): { prefix: string; suffix: string; currentLine: string } => {
  const lines = splitLines(text);
  const totalLines = lines.length;

  // Clamp cursor position to valid range
  const safeLine = Math.min(Math.max(cursorLine, 0), totalLines - 1);
  const currentLineContent = lines[safeLine] || "";
  const safeColumn = Math.min(Math.max(cursorColumn, 0), currentLineContent.length);

  // Current line split at cursor
  const linePrefix = currentLineContent.slice(0, safeColumn);
  const lineSuffix = currentLineContent.slice(safeColumn);

  // Build prefix (lines before cursor)
  const prefixStartLine = Math.max(0, safeLine - PREFIX_LINES);
  const prefixLines: string[] = [];
  for (let i = prefixStartLine; i < safeLine; i++) {
    prefixLines.push(truncateLine(lines[i] || ""));
  }

  // Build suffix (lines after cursor)
  const suffixEndLine = Math.min(totalLines, safeLine + 1 + SUFFIX_LINES);
  const suffixLines: string[] = [];
  for (let i = safeLine + 1; i < suffixEndLine; i++) {
    suffixLines.push(truncateLine(lines[i] || ""));
  }

  // Add file header for context
  const language = getLanguageFromPath(filePath);
  const fileName = filePath?.split("/").pop() || "untitled";
  const header = `// File: ${fileName}\n// Language: ${language}\n\n`;

  const prefix = header + prefixLines.join("\n") + (prefixLines.length > 0 ? "\n" : "");
  const suffix = (suffixLines.length > 0 ? "\n" : "") + suffixLines.join("\n");
  const currentLine = `${truncateLine(linePrefix, safeColumn)}█${lineSuffix}`;

  return { prefix, suffix, currentLine };
};

/**
 * Build context around cursor for display/debugging.
 * Returns a string with <CURSOR> marker at the cursor position.
 */
const buildCursorContext = (
  text: string,
  cursorOffset: number,
  cursorLine: number,
  cursorColumn: number,
  filePath?: string | null,
): string => {
  const { prefix, suffix, currentLine } = buildSimpleContext(
    text,
    cursorOffset,
    cursorLine,
    cursorColumn,
    filePath,
  );

  // Combine into a single context string with cursor marker
  return prefix + currentLine + suffix;
};

/**
 * Get recent lines before cursor for context.
 * Returns an array of the most recent lines.
 */
const buildRecentText = (text: string, cursorOffset: number): string[] => {
  const beforeCursor = text.slice(0, cursorOffset);
  const lines = beforeCursor.split("\n");
  const count = 15; // Recent lines to include

  return lines.slice(-count).map((line) => truncateLine(line));
};

interface SuggestionHistoryEntry {
  suggestion: string;
  line: number;
  timestamp: number;
}

/**
 * Build FIM (Fill-in-Middle) context for models that support it.
 * For small files (<1500 lines): provides full file with cursor marker
 * For large files: provides windowed context around cursor
 * Includes recent suggestion history for short-term memory.
 */
const buildFIMContext = (
  text: string,
  _cursorOffset: number,
  cursorLine: number,
  cursorColumn: number,
  filePath?: string | null,
  suggestionHistory?: SuggestionHistoryEntry[],
): { prefix: string; suffix: string } => {
  const lines = splitLines(text);
  const totalLines = lines.length;

  const safeLine = Math.min(Math.max(cursorLine, 0), totalLines - 1);
  const currentLineContent = lines[safeLine] || "";
  const safeColumn = Math.min(Math.max(cursorColumn, 0), currentLineContent.length);

  // Extract file info
  const language = getLanguageFromPath(filePath);
  const fileName = filePath?.split("/").pop() || "untitled";
  const directory = filePath ? filePath.split("/").slice(0, -1).join("/") : "";

  // Current line split at cursor
  const linePrefix = currentLineContent.slice(0, safeColumn);
  const lineSuffix = currentLineContent.slice(safeColumn);

  // For small files, provide full file context
  if (totalLines < FULL_FILE_LINE_THRESHOLD) {
    return buildFullFileContext(
      lines,
      safeLine,
      linePrefix,
      lineSuffix,
      fileName,
      directory,
      language,
      suggestionHistory,
    );
  }

  // For large files, use windowed context
  return buildWindowedContext(
    lines,
    safeLine,
    safeColumn,
    linePrefix,
    lineSuffix,
    fileName,
    directory,
    language,
    suggestionHistory,
  );
};

/**
 * Build full file context for small files.
 * Minimal metadata header, clean code without line numbers.
 */
const buildFullFileContext = (
  lines: string[],
  cursorLine: number,
  linePrefix: string,
  lineSuffix: string,
  fileName: string,
  _directory: string,
  language: string,
  _suggestionHistory?: SuggestionHistoryEntry[],
): { prefix: string; suffix: string } => {
  const totalLines = lines.length;

  // Minimal header - just essential file info
  const header = `// ${fileName} (${language})\n`;

  // Build prefix: all lines before cursor + current line up to cursor
  // NO line numbers - just clean code
  const prefixParts: string[] = [header];

  for (let i = 0; i < cursorLine; i++) {
    prefixParts.push(lines[i] || "");
  }

  // Add current line up to cursor position
  prefixParts.push(linePrefix);

  const prefix = prefixParts.join("\n");

  // Build suffix: rest of current line + remaining lines
  // NO line numbers - just clean code
  const suffixParts: string[] = [lineSuffix];

  for (let i = cursorLine + 1; i < totalLines; i++) {
    suffixParts.push(lines[i] || "");
  }

  const suffix = suffixParts.join("\n");

  return { prefix, suffix };
};

/**
 * Build windowed context for large files.
 * Uses bracket detection to capture relevant code blocks.
 * Clean code without line numbers.
 */
const buildWindowedContext = (
  lines: string[],
  cursorLine: number,
  cursorColumn: number,
  linePrefix: string,
  lineSuffix: string,
  fileName: string,
  _directory: string,
  language: string,
  _suggestionHistory?: SuggestionHistoryEntry[],
): { prefix: string; suffix: string } => {
  const totalLines = lines.length;

  // Find the start of the current block by tracking bracket depth
  let blockStartLine = Math.max(0, cursorLine - PREFIX_LINES);
  let depth = 0;

  for (let i = cursorLine; i >= 0; i--) {
    const line = lines[i] || "";
    const scanEnd = i === cursorLine ? cursorColumn : line.length;

    for (let j = scanEnd - 1; j >= 0; j--) {
      const char = line[j];
      if (char === "]" || char === "}" || char === ")") depth++;
      else if (char === "[" || char === "{" || char === "(") {
        if (depth > 0) depth--;
        else {
          blockStartLine = Math.min(blockStartLine, i);
        }
      }
    }
  }

  const prefixStartLine = Math.min(blockStartLine, Math.max(0, cursorLine - PREFIX_LINES));
  const suffixEndLine = Math.min(totalLines, cursorLine + 1 + SUFFIX_LINES);

  // Minimal header - just essential file info
  const header = `// ${fileName} (${language})\n`;

  // Build prefix - clean code, no line numbers
  const prefixParts: string[] = [header];

  for (let i = prefixStartLine; i < cursorLine; i++) {
    prefixParts.push(truncateLine(lines[i] || ""));
  }

  prefixParts.push(linePrefix);

  const prefix = prefixParts.join("\n");

  // Build suffix - clean code, no line numbers
  const suffixParts: string[] = [lineSuffix];

  for (let i = cursorLine + 1; i < suffixEndLine; i++) {
    suffixParts.push(truncateLine(lines[i] || ""));
  }

  const suffix = suffixParts.join("\n");

  return { prefix, suffix };
};

/**
 * Extract import paths from code content.
 * Supports: import from, require(), dynamic import()
 */
const extractImportPaths = (content: string): string[] => {
  const imports: string[] = [];
  const patterns = [
    /import\s+(?:[\w\s{},*]+\s+from\s+)?['"]([^'"]+)['"]/g, // ES imports
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // CommonJS require
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // Dynamic import
  ];

  for (const pattern of patterns) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      const importPath = match[1];
      // Only include relative imports (likely in same project)
      if (importPath?.startsWith(".") || importPath?.startsWith("@/")) {
        imports.push(importPath);
      }
    }
  }

  return [...new Set(imports)]; // Deduplicate
};

/**
 * Check if two file paths are related (same directory or imported).
 */
const areFilesRelated = (
  currentPath: string,
  otherPath: string,
  importPaths: string[],
): boolean => {
  // Same directory
  const currentDir = currentPath.split("/").slice(0, -1).join("/");
  const otherDir = otherPath.split("/").slice(0, -1).join("/");
  if (currentDir === otherDir) return true;

  // Check if other file matches any import path
  const otherFileName =
    otherPath
      .split("/")
      .pop()
      ?.replace(/\.[^.]+$/, "") || "";
  for (const importPath of importPaths) {
    const importName =
      importPath
        .split("/")
        .pop()
        ?.replace(/\.[^.]+$/, "") || "";
    if (importName === otherFileName) return true;
    // Handle @/ alias - check if path ends match
    if (importPath.startsWith("@/") && otherPath.includes(importPath.slice(2))) return true;
  }

  return false;
};

/**
 * Collect context snippets from related files (inspired by Kilo).
 * Prioritizes: 1) Imported files, 2) Same directory files, 3) Same extension
 */
const collectRelatedFileSnippets = (
  buffers: Buffer[],
  currentBuffer: Buffer | null,
): Array<{ filepath: string; body: string; score: number }> => {
  if (!CROSS_FILE_CONTEXT_ENABLED || !currentBuffer?.path || !currentBuffer.content) {
    return [];
  }

  const importPaths = extractImportPaths(currentBuffer.content);
  const currentExt = currentBuffer.path.split(".").pop()?.toLowerCase();
  const snippets: Array<{ filepath: string; body: string; score: number }> = [];

  // Score and filter buffers
  const scoredBuffers = buffers
    .filter((b) => {
      if (b.id === currentBuffer.id) return false;
      if (shouldSkipBuffer(b)) return false;
      if (!b.content || !b.path || b.content.length === 0) return false;
      return true;
    })
    .map((b) => {
      let score = 0;
      const otherExt = b.path?.split(".").pop()?.toLowerCase();

      // Higher score for related files
      if (areFilesRelated(currentBuffer.path!, b.path!, importPaths)) {
        score += 10;
      }

      // Bonus for same extension
      if (currentExt && otherExt === currentExt) {
        score += 5;
      }

      // Small bonus for recently accessed (based on array position as proxy)
      score += 1;

      return { buffer: b, score };
    })
    .filter((item) => item.score >= 5) // Only include somewhat related files
    .sort((a, b) => b.score - a.score)
    .slice(0, RELATED_FILES_MAX);

  for (const { buffer, score } of scoredBuffers) {
    if (!buffer.content || !buffer.path) continue;

    const lines = buffer.content.split("\n");
    // Take imports + first functions/classes (more useful than just first N lines)
    const snippetLines: string[] = [];
    let inImports = true;

    for (let i = 0; i < lines.length && snippetLines.length < RELATED_FILE_SNIPPET_LINES; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Always include imports
      if (
        inImports &&
        (trimmed.startsWith("import") || trimmed.startsWith("from") || trimmed === "")
      ) {
        snippetLines.push(line);
        continue;
      }
      inImports = false;

      // Include function/class/const declarations
      if (
        trimmed.startsWith("export") ||
        trimmed.startsWith("function") ||
        trimmed.startsWith("class") ||
        trimmed.startsWith("const") ||
        trimmed.startsWith("interface") ||
        trimmed.startsWith("type") ||
        trimmed.startsWith("def ") ||
        trimmed.startsWith("fn ") ||
        trimmed.startsWith("pub ")
      ) {
        snippetLines.push(line);
      }
    }

    const body = snippetLines.join("\n");
    if (body.trim().length > 0) {
      snippets.push({
        filepath: buffer.path,
        body,
        score,
      });
    }
  }

  return snippets;
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
  const lastAcceptedAt = useAiCompletionStore.use.lastAcceptedAt();
  const lastUndoRedoAt = useAiCompletionStore.use.lastUndoRedoAt();
  const aiActions = useAiCompletionStore.use.actions();

  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const lastRequestOffsetRef = useRef<number | null>(null);
  const lastRequestSignatureRef = useRef<string | null>(null);
  const inFlightRef = useRef<boolean>(false);
  const lastInputRef = useRef<number>(0);
  const lastAcceptedAtRef = useRef<number>(0);
  const lastUndoRedoAtRef = useRef<number>(0);

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

    // Skip if a suggestion was just accepted - wait for user to type more
    // The lastInputTimestamp at acceptance time should be less than lastAcceptedAt
    if (lastAcceptedAt > 0 && lastAcceptedAtRef.current !== lastAcceptedAt) {
      // A new acceptance happened, record it and skip this trigger
      lastAcceptedAtRef.current = lastAcceptedAt;
      console.log("[AI Autocomplete] skip: just accepted suggestion, waiting for new input");
      return;
    }

    // Skip if undo/redo was just performed - wait for user to type more
    if (lastUndoRedoAt > 0 && lastUndoRedoAtRef.current !== lastUndoRedoAt) {
      // A new undo/redo happened, record it and skip this trigger
      lastUndoRedoAtRef.current = lastUndoRedoAt;
      console.log("[AI Autocomplete] skip: just performed undo/redo, waiting for new input");
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

      // Get current line content for prediction type analysis
      const lineStartIndex = (() => {
        const prevNewline = latestContent.lastIndexOf("\n", cursorOffset - 1);
        return prevNewline === -1 ? 0 : prevNewline + 1;
      })();
      const currentLineContent = latestContent.slice(lineStartIndex, lineEndIndex);
      const cursorColumnInLine = cursorOffset - lineStartIndex;

      // Determine if we just accepted a suggestion (for multi-line continuations)
      const justAccepted = lastAcceptedAt > 0 && Date.now() - lastAcceptedAt < 1000;

      // Get prediction type based on cursor context
      const predictionType = getPredictionType(
        currentLineContent,
        cursorColumnInLine,
        justAccepted,
      );
      console.log("[AI Autocomplete] prediction type", {
        predictionType,
        currentLineContent,
        cursorColumnInLine,
      });

      // For single-line-fill-middle with significant suffix, be more conservative
      const lineTail = latestContent.slice(cursorOffset, lineEndIndex);
      if (
        predictionType === "single-line-fill-middle" &&
        lineTail.trim().length > SUFFIX_IGNORE_THRESHOLD
      ) {
        console.log("[AI Autocomplete] skip: mid-line with significant suffix");
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
          cursorContext: buildCursorContext(
            latestContent,
            anchor.cursorOffset,
            anchor.cursorLine,
            anchor.cursorColumn,
          ),
        });
        const apiKey = await getProviderApiToken(provider.id);
        if (!apiKey) {
          aiActions.clearSuggestion();
          return;
        }

        const rejectedSuggestions = rejectedByBuffer.get(bufferId) || [];

        // Get suggestion history for this buffer (short-term memory)
        const suggestionHistory = aiActions.getSuggestionHistory(bufferId);

        // Build FIM context (clean prefix/suffix for models that support it)
        const fimContext = buildFIMContext(
          latestContent,
          anchor.cursorOffset,
          anchor.cursorLine,
          anchor.cursorColumn,
          latestBuffer?.path,
          suggestionHistory,
        );

        // Collect related file snippets (imports, same directory, same extension)
        const allBuffers = useBufferStore.getState().buffers;
        const relatedSnippets = collectRelatedFileSnippets(allBuffers, latestBuffer ?? null);

        const request = {
          // Send ONLY the FIM context, not the full file
          // The full file was causing the API to build bad context
          text: fimContext.prefix,
          suffix: fimContext.suffix,
          cursorPosition: fimContext.prefix.length,
          maxTokens: DEFAULT_MAX_TOKENS,
          temperature: DEFAULT_TEMPERATURE,
          context: {
            documentType: getDocumentType(latestBuffer),
            // FIM context (preferred by modern models)
            prefix: fimContext.prefix,
            suffix: fimContext.suffix,
            // Prediction type hint for the model
            predictionType,
            // File info
            filepath: latestBuffer?.path || undefined,
            language: getLanguageFromPath(latestBuffer?.path),
            // Related files context (inspired by Kilo)
            relatedFiles: relatedSnippets.length > 0 ? relatedSnippets : undefined,
            // Filtering
            rejectedSuggestions,
          },
        };

        console.log("[AI Autocomplete] FIM context", {
          prefixLast200: fimContext.prefix.slice(-200),
          suffixFirst100: fimContext.suffix.slice(0, 100),
        });

        console.log("[AI Autocomplete] FULL REQUEST", JSON.stringify(request, null, 2));

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
    lastAcceptedAt,
    lastUndoRedoAt,
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
