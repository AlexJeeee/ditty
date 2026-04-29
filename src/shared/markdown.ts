import DOMPurify from "dompurify";
import { marked } from "marked";

export interface MarkdownSection {
  type: "text" | "think";
  content: string;
}

const THINK_START_RE = /<think\b[^>]*>/gi;
const THINK_END_RE = /<\/think>/gi;

marked.setOptions({
  async: false,
  breaks: true,
  gfm: true,
});

export const renderMarkdown = (content: string) => {
  const html = marked.parse(content, {
    async: false,
    breaks: true,
    gfm: true,
  });

  return DOMPurify.sanitize(html);
};

export const splitThinkSections = (content: string): MarkdownSection[] => {
  const sections: MarkdownSection[] = [];
  let cursor = 0;

  while (cursor < content.length) {
    THINK_START_RE.lastIndex = cursor;
    const startMatch = THINK_START_RE.exec(content);

    if (!startMatch) {
      sections.push({
        type: "text",
        content: content.slice(cursor),
      });
      break;
    }

    if (startMatch.index > cursor) {
      sections.push({
        type: "text",
        content: content.slice(cursor, startMatch.index),
      });
    }

    THINK_END_RE.lastIndex = THINK_START_RE.lastIndex;
    const endMatch = THINK_END_RE.exec(content);
    const thinkStart = THINK_START_RE.lastIndex;
    const thinkEnd = endMatch?.index ?? content.length;

    sections.push({
      type: "think",
      content: content.slice(thinkStart, thinkEnd),
    });

    if (!endMatch) {
      break;
    }

    cursor = THINK_END_RE.lastIndex;
  }

  return sections.filter((section) => section.content.trim().length > 0);
};
