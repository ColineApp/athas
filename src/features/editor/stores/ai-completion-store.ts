import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";

export type AiCompletionStatus = "idle" | "loading" | "error";

const MAX_REJECTED_SUGGESTIONS = 5;

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
  rejectedByBuffer: Map<string, string[]>;
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
    clearSuggestion: (options?: { reject?: boolean }) => void;
    addRejectedSuggestion: (bufferId: string, suggestion: string) => void;
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
    rejectedByBuffer: new Map(),
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
        const { suggestion, bufferId } = get();
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
    },
  })),
);
