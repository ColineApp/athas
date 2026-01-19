import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { useAiCompletionStore } from "@/features/editor/stores/ai-completion-store";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { splitLines } from "@/features/editor/utils/lines";
import { InlineGitBlame } from "@/features/version-control/git/components/inline-blame";
import { useGitBlame } from "@/features/version-control/git/controllers/use-blame";

interface GitBlameLayerProps {
  filePath: string;
  cursorLine: number;
  visualCursorLine: number;
  visualContent: string;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize?: number;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

const GitBlameLayerComponent = ({
  filePath,
  cursorLine,
  visualCursorLine,
  visualContent,
  fontSize,
  fontFamily,
  lineHeight,
  tabSize = 2,
  textareaRef,
}: GitBlameLayerProps) => {
  // Subscribe to scroll state for reactivity
  const scrollTop = useEditorStateStore.use.scrollTop();
  const scrollLeft = useEditorStateStore.use.scrollLeft();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const aiSuggestion = useAiCompletionStore.use.suggestion();
  const aiSuggestionVisible = useAiCompletionStore.use.isVisible();
  const aiSuggestionBufferId = useAiCompletionStore.use.bufferId();
  const aiCursorLine = useAiCompletionStore.use.cursorLine();
  const aiCursorColumn = useAiCompletionStore.use.cursorColumn();

  const { getBlameForLine } = useGitBlame(filePath);
  const blameLine = getBlameForLine(cursorLine);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [lineContentWidth, setLineContentWidth] = useState(0);

  const lines = useMemo(() => splitLines(visualContent), [visualContent]);
  const currentLineContent = lines[visualCursorLine] || "";
  const ghostFirstLine = aiSuggestion ? (aiSuggestion.split("\n")[0] ?? "") : "";

  const shouldShiftForGhost =
    aiSuggestionVisible &&
    !!ghostFirstLine &&
    aiSuggestionBufferId === activeBufferId &&
    aiCursorLine === cursorLine &&
    aiCursorColumn !== null &&
    aiCursorColumn !== undefined;

  const effectiveLineContent = useMemo(() => {
    if (!shouldShiftForGhost) return currentLineContent;
    const safeColumn = Math.min(Math.max(aiCursorColumn ?? 0, 0), currentLineContent.length);
    return (
      currentLineContent.slice(0, safeColumn) +
      ghostFirstLine +
      currentLineContent.slice(safeColumn)
    );
  }, [shouldShiftForGhost, currentLineContent, aiCursorColumn, ghostFirstLine]);

  // Reset width when file changes to prevent stale positioning during file switches
  useLayoutEffect(() => {
    setLineContentWidth(0);
  }, [filePath]);

  // Measure the actual rendered width using a hidden element
  useLayoutEffect(() => {
    if (measureRef.current) {
      setLineContentWidth(measureRef.current.offsetWidth);
    }
  }, [effectiveLineContent, fontSize, fontFamily, tabSize, filePath]);

  // Calculate position only when we have valid data
  const shouldShowBlame = blameLine && lineContentWidth > 0;

  // Calculate scroll ratio to compensate for browser rendering differences
  // (same approach as gutter component)
  const textarea = textareaRef.current;
  const totalLines = lines.length;
  const totalContentHeight = totalLines * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP * 2;
  const textareaScrollHeight = textarea?.scrollHeight ?? totalContentHeight;
  const scrollRatio = textareaScrollHeight > 0 ? totalContentHeight / textareaScrollHeight : 1;

  // Apply ratio to get adjusted scroll position
  const adjustedScrollTop = scrollTop * scrollRatio;

  // Position relative to viewport (subtract adjusted scroll to get viewport-relative position)
  const top =
    visualCursorLine * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP - adjustedScrollTop;
  const left =
    lineContentWidth +
    EDITOR_CONSTANTS.EDITOR_PADDING_LEFT +
    EDITOR_CONSTANTS.GUTTER_MARGIN -
    scrollLeft;

  return (
    <div
      className="git-blame-layer pointer-events-none absolute inset-0"
      style={{
        fontSize: `${fontSize}px`,
        fontFamily,
        lineHeight: `${lineHeight}px`,
      }}
    >
      {/* Hidden element to measure actual text width - always rendered */}
      <span
        ref={measureRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          visibility: "hidden",
          whiteSpace: "pre",
          tabSize,
        }}
      >
        {effectiveLineContent}
      </span>

      {shouldShowBlame && (
        <div
          className="pointer-events-auto absolute flex items-center"
          style={{
            top: `${top}px`,
            left: `${left}px`,
            height: `${lineHeight}px`,
          }}
        >
          <InlineGitBlame blameLine={blameLine} />
        </div>
      )}
    </div>
  );
};

GitBlameLayerComponent.displayName = "GitBlameLayer";

export const GitBlameLayer = memo(GitBlameLayerComponent);
