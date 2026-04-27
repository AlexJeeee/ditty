import { HIGH_RISK_LABEL_PATTERN, SENSITIVE_FIELD_PATTERN } from "@/shared/constants";
import type { ActionRiskLevel } from "@/shared/types";

const getElementText = (element: Element) =>
  [
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.getAttribute("placeholder"),
    element.getAttribute("name"),
    element.getAttribute("id"),
    element.textContent
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

export function isElementVisible(element: Element) {
  const htmlElement = element as HTMLElement;
  const style = window.getComputedStyle(htmlElement);
  const rect = htmlElement.getBoundingClientRect();

  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number(style.opacity) !== 0 &&
    rect.width > 0 &&
    rect.height > 0
  );
}

export function isSensitiveField(element: Element) {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
    return false;
  }

  const input = element as HTMLInputElement | HTMLTextAreaElement;
  const attributes = [
    input.type,
    input.name,
    input.id,
    input.autocomplete,
    input.placeholder,
    input.getAttribute("aria-label")
  ]
    .filter(Boolean)
    .join(" ");

  return input.type === "password" || SENSITIVE_FIELD_PATTERN.test(attributes);
}

export function detectRiskLevel(element: Element): ActionRiskLevel {
  if (isSensitiveField(element)) {
    return "high";
  }

  const text = getElementText(element);
  if (HIGH_RISK_LABEL_PATTERN.test(text)) {
    return "high";
  }

  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    element.getAttribute("contenteditable") === "true"
  ) {
    return "medium";
  }

  if (element instanceof HTMLButtonElement || element instanceof HTMLAnchorElement || element.getAttribute("role")) {
    return "medium";
  }

  return "low";
}

export function getElementLabel(element: Element) {
  const labelledBy = element.getAttribute("aria-labelledby");
  const labelledText = labelledBy
    ?.split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent?.trim())
    .filter(Boolean)
    .join(" ");

  if (labelledText) {
    return labelledText;
  }

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    const explicitLabel = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`) : null;
    const wrappedLabel = element.closest("label");
    const label = explicitLabel?.textContent || wrappedLabel?.textContent;

    if (label?.trim()) {
      return label.trim();
    }
  }

  const text = getElementText(element);
  return text.replace(/\s+/g, " ").slice(0, 120) || element.tagName.toLowerCase();
}
