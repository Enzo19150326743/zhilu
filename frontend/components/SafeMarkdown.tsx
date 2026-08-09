import type { ReactNode } from "react";

interface SafeMarkdownProps {
  markdown: string;
}

type MarkdownBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string }
  | { type: "unordered-list"; items: string[] }
  | { type: "ordered-list"; items: string[] };

function parseMarkdown(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraphLines: string[] = [];

  const flushParagraph = () => {
    const text = paragraphLines.join(" ").trim();
    if (text) {
      blocks.push({ type: "paragraph", text });
    }
    paragraphLines = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      flushParagraph();
      continue;
    }

    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(line);
    if (headingMatch) {
      flushParagraph();
      blocks.push({
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
        type: "heading"
      });
      continue;
    }

    if (line.startsWith(">")) {
      flushParagraph();
      blocks.push({ type: "quote", text: line.replace(/^>\s?/, "") });
      continue;
    }

    const unorderedMatch = /^[-*+]\s+(.+)$/.exec(line);
    if (unorderedMatch) {
      flushParagraph();
      const items = [unorderedMatch[1].trim()];
      while (index + 1 < lines.length) {
        const nextMatch = /^[-*+]\s+(.+)$/.exec(lines[index + 1].trim());
        if (!nextMatch) {
          break;
        }
        items.push(nextMatch[1].trim());
        index += 1;
      }
      blocks.push({ items, type: "unordered-list" });
      continue;
    }

    const orderedMatch = /^\d+[.)]\s+(.+)$/.exec(line);
    if (orderedMatch) {
      flushParagraph();
      const items = [orderedMatch[1].trim()];
      while (index + 1 < lines.length) {
        const nextMatch = /^\d+[.)]\s+(.+)$/.exec(lines[index + 1].trim());
        if (!nextMatch) {
          break;
        }
        items.push(nextMatch[1].trim());
        index += 1;
      }
      blocks.push({ items, type: "ordered-list" });
      continue;
    }

    paragraphLines.push(line);
  }

  flushParagraph();
  return blocks;
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const strongPattern = /\*\*(.+?)\*\*/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = strongPattern.exec(text)) !== null) {
    if (match.index > cursor) {
      nodes.push(text.slice(cursor, match.index));
    }
    nodes.push(
      <strong
        className="font-semibold text-[var(--ink)]"
        key={`strong-${match.index}`}
      >
        {match[1]}
      </strong>
    );
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes.length > 0 ? nodes : [text];
}

function renderHeading(level: number, text: string): ReactNode {
  if (level <= 2) {
    return (
      <h3 className="font-editorial mt-7 text-xl font-semibold text-[var(--ink)] first:mt-0">
        {renderInlineMarkdown(text)}
      </h3>
    );
  }

  return (
    <h4 className="mt-5 text-sm font-semibold text-[var(--ink)]">
      {renderInlineMarkdown(text)}
    </h4>
  );
}

export function SafeMarkdown({ markdown }: SafeMarkdownProps) {
  const blocks = parseMarkdown(markdown);

  return (
    <div className="text-sm leading-7 text-[var(--ink-soft)]">
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        if (block.type === "heading") {
          return <div key={key}>{renderHeading(block.level, block.text)}</div>;
        }
        if (block.type === "quote") {
          return (
            <blockquote
              className="my-4 border-l-2 border-[var(--accent)] bg-[var(--paper-deep)]/55 px-4 py-3 text-[var(--ink-soft)]"
              key={key}
            >
              {renderInlineMarkdown(block.text)}
            </blockquote>
          );
        }
        if (block.type === "unordered-list") {
          return (
            <ul className="my-3 list-disc space-y-1.5 pl-5" key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={`${item}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
              ))}
            </ul>
          );
        }
        if (block.type === "ordered-list") {
          return (
            <ol className="my-3 list-decimal space-y-1.5 pl-5" key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={`${item}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
              ))}
            </ol>
          );
        }

        return (
          <p className="my-3 text-pretty" key={key}>
            {renderInlineMarkdown(block.text)}
          </p>
        );
      })}
    </div>
  );
}
