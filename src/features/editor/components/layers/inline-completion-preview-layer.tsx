import { forwardRef, memo, useMemo } from "react";
import type { ViewportRange } from "@/features/editor/hooks/use-viewport-lines";

interface InlineCompletionPreviewLayerProps {
  lines: string[];
  suggestion: string;
  cursorLine: number;
  cursorColumn: number;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize: number;
  viewportRange?: ViewportRange;
}

const MAX_PREVIEW_LINES = 200;
const EMPTY_LINE = "\u00A0";

const InlineCompletionPreviewLayerComponent = forwardRef<
  HTMLDivElement,
  InlineCompletionPreviewLayerProps
>(
  (
    {
      lines,
      suggestion,
      cursorLine,
      cursorColumn,
      fontSize,
      fontFamily,
      lineHeight,
      tabSize,
      viewportRange,
    },
    ref,
  ) => {
    const suggestionLines = useMemo(() => suggestion.split("\n"), [suggestion]);

    const startLine = Math.min(Math.max(cursorLine, 0), lines.length - 1);
    const endLine = useMemo(() => {
      if (lines.length === 0) return 0;
      if (viewportRange) {
        return Math.min(viewportRange.endLine, lines.length - 1);
      }
      return Math.min(lines.length - 1, startLine + MAX_PREVIEW_LINES);
    }, [lines.length, startLine, viewportRange]);

    const renderedLines = useMemo(() => {
      if (!suggestion) return [];
      const result = [];

      const currentLine = lines[startLine] || "";
      const before = currentLine.slice(0, cursorColumn);
      const after = currentLine.slice(cursorColumn);

      const insertLineCount = suggestionLines.length;
      const lastInsertIndex = Math.max(0, insertLineCount - 1);

      const firstGhost = suggestionLines[0] ?? "";
      const lastGhost = suggestionLines[lastInsertIndex] ?? "";

      result.push(
        <div key={`preview-line-${startLine}-0`} className="inline-completion-preview-line">
          {before || null}
          <span className="inline-completion-preview-ghost">{firstGhost || EMPTY_LINE}</span>
        </div>,
      );

      for (let i = 1; i < lastInsertIndex; i++) {
        const ghost = suggestionLines[i] ?? "";
        result.push(
          <div key={`preview-line-${startLine}-${i}`} className="inline-completion-preview-line">
            <span className="inline-completion-preview-ghost">{ghost || EMPTY_LINE}</span>
          </div>,
        );
      }

      if (insertLineCount > 1) {
        result.push(
          <div
            key={`preview-line-${startLine}-${lastInsertIndex}`}
            className="inline-completion-preview-line"
          >
            <span className="inline-completion-preview-ghost">{lastGhost || EMPTY_LINE}</span>
            {after || null}
          </div>,
        );
      } else if (after) {
        result.push(
          <div key={`preview-line-${startLine}-suffix`} className="inline-completion-preview-line">
            {after}
          </div>,
        );
      }

      const trailingStart = startLine + 1;
      const trailingEnd = Math.min(endLine, lines.length - 1);
      for (let i = trailingStart; i <= trailingEnd; i++) {
        const line = lines[i] ?? "";
        result.push(
          <div key={`preview-line-${i}`} className="inline-completion-preview-line">
            {line || EMPTY_LINE}
          </div>,
        );
      }

      return result;
    }, [lines, suggestion, suggestionLines, startLine, endLine, cursorColumn]);

    return (
      <div
        className="inline-completion-preview-layer"
        style={{
          top: `${startLine * lineHeight}px`,
          fontSize: `${fontSize}px`,
          fontFamily,
          lineHeight: `${lineHeight}px`,
          tabSize,
        }}
        aria-hidden="true"
      >
        <div ref={ref} className="inline-completion-preview-content">
          {renderedLines}
        </div>
      </div>
    );
  },
);

InlineCompletionPreviewLayerComponent.displayName = "InlineCompletionPreviewLayer";

export const InlineCompletionPreviewLayer = memo(InlineCompletionPreviewLayerComponent);
