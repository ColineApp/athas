import { forwardRef, memo, useMemo } from "react";

interface InlineCompletionPreviewLayerProps {
  content: string;
  suggestion: string;
  cursorOffset: number;
  cursorLine: number;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize: number;
}

const buildLineOffsets = (lines: string[]) => {
  const offsets: number[] = new Array(lines.length);
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    offsets[i] = offset;
    offset += lines[i].length + 1;
  }
  return offsets;
};

const InlineCompletionPreviewLayerComponent = forwardRef<
  HTMLDivElement,
  InlineCompletionPreviewLayerProps
>(
  (
    { content, suggestion, cursorOffset, cursorLine, fontSize, fontFamily, lineHeight, tabSize },
    ref,
  ) => {
    const previewContent = useMemo(() => {
      if (!suggestion) return content;
      return content.slice(0, cursorOffset) + suggestion + content.slice(cursorOffset);
    }, [content, suggestion, cursorOffset]);

    const previewLines = useMemo(() => previewContent.split("\n"), [previewContent]);
    const lineOffsets = useMemo(() => buildLineOffsets(previewLines), [previewLines]);

    const insertStart = cursorOffset;
    const insertEnd = cursorOffset + suggestion.length;
    const startLine = Math.min(Math.max(cursorLine, 0), previewLines.length - 1);

    const renderedLines = useMemo(() => {
      const result = [];
      for (let i = startLine; i < previewLines.length; i++) {
        const line = previewLines[i];
        const lineStart = lineOffsets[i];
        const lineEnd = lineStart + line.length;
        const ghostStart = Math.max(lineStart, insertStart);
        const ghostEnd = Math.min(lineEnd, insertEnd);

        if (ghostStart >= ghostEnd) {
          result.push(
            <div key={`preview-line-${i}`} className="inline-completion-preview-line">
              {line || "\u00A0"}
            </div>,
          );
          continue;
        }

        const prefix = line.slice(0, ghostStart - lineStart);
        const ghost = line.slice(ghostStart - lineStart, ghostEnd - lineStart);
        const suffix = line.slice(ghostEnd - lineStart);

        result.push(
          <div key={`preview-line-${i}`} className="inline-completion-preview-line">
            {prefix || null}
            <span className="inline-completion-preview-ghost">{ghost || "\u00A0"}</span>
            {suffix || null}
          </div>,
        );
      }
      return result;
    }, [previewLines, lineOffsets, insertStart, insertEnd, startLine]);

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
