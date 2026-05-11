import { pruneElementRegistry, registerElement } from "./element-registry";
import {
  detectRiskLevel,
  getElementLabel,
  isElementVisible,
  isSensitiveField,
} from "./risk-detector";
import type {
  InteractiveElement,
  PageContext,
  PageHeading,
  PageTableSummary,
} from "@/shared/types";

const MAX_TEXT_LENGTH = 5000;
const MAX_ELEMENTS = 80;
const MAX_TABLES = 5;

const collectVisibleText = () => {
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        const text = node.textContent?.replace(/\s+/g, " ").trim();

        if (!parent || !text) {
          return NodeFilter.FILTER_REJECT;
        }

        const tagName = parent.tagName.toLowerCase();
        if (["script", "style", "noscript", "template"].includes(tagName)) {
          return NodeFilter.FILTER_REJECT;
        }

        if (!isElementVisible(parent)) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  const parts: string[] = [];
  let length = 0;
  let current = walker.nextNode();

  while (current && length < MAX_TEXT_LENGTH) {
    const text = current.textContent?.replace(/\s+/g, " ").trim();
    if (text) {
      parts.push(text);
      length += text.length;
    }
    current = walker.nextNode();
  }

  return parts.join(" ").slice(0, MAX_TEXT_LENGTH);
};

const collectHeadings = (): PageHeading[] => {
  return Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"))
    .filter(isElementVisible)
    .slice(0, 30)
    .map((heading) => ({
      level: Number(heading.tagName.slice(1)),
      text:
        heading.textContent?.replace(/\s+/g, " ").trim().slice(0, 160) || "",
    }))
    .filter((heading) => heading.text.length > 0);
};

const collectTables = (): PageTableSummary[] => {
  return Array.from(document.querySelectorAll("table"))
    .filter(isElementVisible)
    .slice(0, MAX_TABLES)
    .map((table, index) => {
      const rows = Array.from(table.querySelectorAll("tr")).slice(0, 5);
      const preview = rows.map((row) =>
        Array.from(row.querySelectorAll("th,td"))
          .slice(0, 5)
          .map(
            (cell) =>
              cell.textContent?.replace(/\s+/g, " ").trim().slice(0, 80) || "",
          ),
      );

      return {
        id: `table_${index + 1}`,
        rowCount: table.querySelectorAll("tr").length,
        columnCount: preview[0]?.length ?? 0,
        caption: table
          .querySelector("caption")
          ?.textContent?.replace(/\s+/g, " ")
          .trim()
          .slice(0, 120),
        preview,
      };
    });
};

const getRole = (element: Element) => {
  const ariaRole = element.getAttribute("role");
  if (ariaRole) {
    return ariaRole;
  }

  if (element instanceof HTMLButtonElement) return "button";
  if (element instanceof HTMLAnchorElement) return "link";
  if (element instanceof HTMLInputElement) return element.type || "input";
  if (element instanceof HTMLTextAreaElement) return "textarea";
  if (element instanceof HTMLSelectElement) return "select";
  if (element.getAttribute("contenteditable") === "true") return "textbox";

  return element.tagName.toLowerCase();
};

const collectInteractiveElements = (): InteractiveElement[] => {
  const selector = [
    "a[href]",
    "button",
    "input",
    "textarea",
    "select",
    "[role='button']",
    "[role='link']",
    "[role='checkbox']",
    "[role='textbox']",
    "[contenteditable='true']",
  ].join(",");

  return Array.from(document.querySelectorAll(selector))
    .filter(isElementVisible)
    .slice(0, MAX_ELEMENTS)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const inputElement = element as HTMLInputElement | HTMLTextAreaElement;
      const sensitive = isSensitiveField(element);
      const riskLevel = detectRiskLevel(element);

      return {
        id: registerElement(element),
        tagName: element.tagName.toLowerCase(),
        role: getRole(element),
        label: getElementLabel(element),
        valuePreview: sensitive ? undefined : inputElement.value?.slice(0, 80),
        inputType:
          element instanceof HTMLInputElement ? element.type : undefined,
        placeholder:
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement
            ? element.placeholder
            : undefined,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        riskLevel,
        disabled: Boolean(
          (element as HTMLInputElement | HTMLButtonElement | HTMLSelectElement)
            .disabled,
        ),
      };
    });
};

export const collectPageContext = (): PageContext => {
  pruneElementRegistry();

  return {
    url: window.location.href,
    origin: window.location.origin,
    title: document.title,
    selectedText: window.getSelection()?.toString().trim().slice(0, 2000) || "",
    visibleTextSummary: collectVisibleText(),
    headings: collectHeadings(),
    tables: collectTables(),
    interactiveElements: collectInteractiveElements(),
    collectedAt: new Date().toISOString(),
  };
};
