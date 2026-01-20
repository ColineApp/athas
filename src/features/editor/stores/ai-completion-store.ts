import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";

export type AiCompletionStatus = "idle" | "loading" | "error";

const MAX_REJECTED_SUGGESTIONS = 5;
const MAX_SUGGESTION_HISTORY = 10;

interface SuggestionHistoryEntry {
  suggestion: string;
  line: number;
  timestamp: number;
}

interface AiCompletionState {
  suggestion: string;
  isVisible: boolean;
  status: AiCompletionStatus;
  bufferId: string | null;
  cursorOffset: number | null;
  cursorLine: number | null;
  cursorColumn: number | null;
  requestId: string | null;
  lastUpdatedAt: number;
  lastAcceptedAt: number; // Track when suggestion was accepted
  lastUndoRedoAt: number; // Track when undo/redo was performed
  rejectedByBuffer: Map<string, string[]>;
  // Rolling history of accepted suggestions per buffer (short-term memory)
  suggestionHistoryByBuffer: Map<string, SuggestionHistoryEntry[]>;
  actions: {
    setLoading: (payload: {
      bufferId: string;
      cursorOffset: number;
      cursorLine: number;
      cursorColumn: number;
      requestId: string;
    }) => void;
    setSuggestion: (payload: {
      suggestion: string;
      bufferId: string;
      cursorOffset: number;
      cursorLine: number;
      cursorColumn: number;
      requestId?: string;
    }) => void;
    clearSuggestion: (options?: { reject?: boolean; accepted?: boolean }) => void;
    addRejectedSuggestion: (bufferId: string, suggestion: string) => void;
    setLastUndoRedoAt: (timestamp: number) => void;
    getSuggestionHistory: (bufferId: string) => SuggestionHistoryEntry[];
  };
}

export const useAiCompletionStore = createSelectors(
  create<AiCompletionState>()((set, get) => ({
    suggestion: "",
    isVisible: false,
    status: "idle",
    bufferId: null,
    cursorOffset: null,
    cursorLine: null,
    cursorColumn: null,
    requestId: null,
    lastUpdatedAt: 0,
    lastAcceptedAt: 0,
    lastUndoRedoAt: 0,
    rejectedByBuffer: new Map(),
    suggestionHistoryByBuffer: new Map(),
    actions: {
      setLoading: ({ bufferId, cursorOffset, cursorLine, cursorColumn, requestId }) =>
        set({
          status: "loading",
          bufferId,
          cursorOffset,
          cursorLine,
          cursorColumn,
          requestId,
        }),
      setSuggestion: ({
        suggestion,
        bufferId,
        cursorOffset,
        cursorLine,
        cursorColumn,
        requestId,
      }) =>
        set({
          suggestion,
          isVisible: suggestion.length > 0,
          status: "idle",
          bufferId,
          cursorOffset,
          cursorLine,
          cursorColumn,
          requestId: requestId ?? null,
          lastUpdatedAt: Date.now(),
        }),
      clearSuggestion: (options) => {
        const { suggestion, bufferId, cursorLine } = get();

        // Add accepted suggestion to history for short-term memory
        if (options?.accepted && suggestion && bufferId && suggestion.trim().length > 0) {
          const historyMap = new Map(get().suggestionHistoryByBuffer);
          const existing = historyMap.get(bufferId) || [];
          const entry: SuggestionHistoryEntry = {
            suggestion: suggestion.trim(),
            line: cursorLine ?? 0,
            timestamp: Date.now(),
          };
          // Add to front, keep last N, avoid duplicates
          const next = [entry, ...existing.filter((e) => e.suggestion !== suggestion.trim())];
          if (next.length > MAX_SUGGESTION_HISTORY) {
            next.length = MAX_SUGGESTION_HISTORY;
          }
          historyMap.set(bufferId, next);
          set({ suggestionHistoryByBuffer: historyMap });
        }

        if (options?.reject && suggestion && bufferId) {
          get().actions.addRejectedSuggestion(bufferId, suggestion);
        }
        set({
          suggestion: "",
          isVisible: false,
          status: "idle",
          bufferId: null,
          cursorOffset: null,
          cursorLine: null,
          cursorColumn: null,
          requestId: null,
          // Track when a suggestion was accepted so we can wait for new input
          lastAcceptedAt: options?.accepted ? Date.now() : get().lastAcceptedAt,
        });
      },
      addRejectedSuggestion: (bufferId, suggestion) =>
        set((state) => {
          const nextMap = new Map(state.rejectedByBuffer);
          const existing = nextMap.get(bufferId) || [];
          const next = [suggestion, ...existing.filter((item) => item !== suggestion)];
          if (next.length > MAX_REJECTED_SUGGESTIONS) {
            next.length = MAX_REJECTED_SUGGESTIONS;
          }
          nextMap.set(bufferId, next);
          return { rejectedByBuffer: nextMap };
        }),
      setLastUndoRedoAt: (timestamp) => set({ lastUndoRedoAt: timestamp }),
      getSuggestionHistory: (bufferId: string) => {
        return get().suggestionHistoryByBuffer.get(bufferId) || [];
      },
    },
  })),
);
