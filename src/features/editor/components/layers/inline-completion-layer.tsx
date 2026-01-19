import { forwardRef, memo, useMemo } from "react";
import { getAccurateCursorX } from "@/features/editor/utils/position";

interface InlineCompletionLayerProps {
  suggestion: string;
  cursorLine: number;
  cursorColumn: number;
  lines: string[];
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize: number;
}

const InlineCompletionLayerComponent = forwardRef<HTMLDivElement, InlineCompletionLayerProps>(
  (
    { suggestion, cursorLine, cursorColumn, lines, fontSize, fontFamily, lineHeight, tabSize },
    ref,
  ) => {
    const suggestionLines = useMemo(() => suggestion.split("\n"), [suggestion]);
    const baseLine = lines[cursorLine] || "";
    const cursorX = useMemo(
      () => getAccurateCursorX(baseLine, cursorColumn, fontSize, fontFamily, tabSize),
      [baseLine, cursorColumn, fontSize, fontFamily, tabSize],
    );

    if (!suggestion) return null;

    return (
      <div
        className="inline-completion-layer"
        style={{
          fontSize: `${fontSize}px`,
          fontFamily,
          lineHeight: `${lineHeight}px`,
        }}
        aria-hidden="true"
      >
        <div ref={ref} className="inline-completion-content">
          {suggestionLines.map((line, index) => {
            const top = (cursorLine + index) * lineHeight;
            const left = index === 0 ? cursorX : 0;
            return (
              <div
                key={`inline-completion-${index}`}
                className="inline-completion-line"
                style={{ top: `${top}px`, left: `${left}px`, lineHeight: `${lineHeight}px` }}
              >
                {line || "\u00A0"}
              </div>
            );
          })}
        </div>
      </div>
    );
  },
);

InlineCompletionLayerComponent.displayName = "InlineCompletionLayer";

export const InlineCompletionLayer = memo(InlineCompletionLayerComponent);
