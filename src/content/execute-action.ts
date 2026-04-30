import {
  getRegisteredElement,
  isRegisteredElementUsable,
} from "./element-registry";
import {
  detectRiskLevel,
  isElementVisible,
  isSensitiveField,
} from "./risk-detector";
import type { AgentAction, AgentActionResult } from "@/shared/types";

const createResult = (
  action: AgentAction,
  status: AgentActionResult["status"],
  message: string,
  output?: unknown,
): AgentActionResult => ({
  actionId: action.id,
  status,
  message,
  output,
});

export const highlightElement = (elementId: string, durationMs = 1600) => {
  const element = getRegisteredElement(elementId);
  if (!element || !isElementVisible(element)) {
    return false;
  }

  const htmlElement = element as HTMLElement;
  const previousOutline = htmlElement.style.outline;
  const previousOutlineOffset = htmlElement.style.outlineOffset;
  const previousTransition = htmlElement.style.transition;

  htmlElement.scrollIntoView({
    behavior: "smooth",
    block: "center",
    inline: "center",
  });
  htmlElement.style.transition = "outline 120ms ease";
  htmlElement.style.outline = "3px solid #2563eb";
  htmlElement.style.outlineOffset = "3px";

  window.setTimeout(() => {
    htmlElement.style.outline = previousOutline;
    htmlElement.style.outlineOffset = previousOutlineOffset;
    htmlElement.style.transition = previousTransition;
  }, durationMs);

  return true;
};

const resolveTarget = (action: AgentAction) => {
  const elementId = action.target?.elementId;
  if (!elementId || !isRegisteredElementUsable(elementId)) {
    return null;
  }

  return getRegisteredElement(elementId);
};

const isDisabledElement = (element: Element) => {
  if (
    element instanceof HTMLButtonElement ||
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    return element.disabled;
  }

  return element.getAttribute("aria-disabled") === "true";
};

const clickElement = (element: Element) => {
  const htmlElement = element as HTMLElement;

  htmlElement.scrollIntoView({
    behavior: "smooth",
    block: "center",
    inline: "center",
  });

  if (typeof htmlElement.focus === "function") {
    htmlElement.focus({ preventScroll: true });
  }

  htmlElement.click();
};

export const executeAction = async (
  action: AgentAction,
): Promise<AgentActionResult> => {
  if (action.riskLevel === "high") {
    return createResult(action, "blocked", "高风险动作已被本地策略阻断。");
  }

  if (
    action.toolName === "read_page" ||
    action.toolName === "summarize_selection" ||
    action.toolName === "extract_table"
  ) {
    return createResult(
      action,
      "succeeded",
      "该动作由 Agent 计划层完成，无需修改页面。",
    );
  }

  if (action.toolName === "copy_result") {
    const text = action.input?.text || action.input?.value || "";
    await navigator.clipboard.writeText(text);
    return createResult(action, "succeeded", "结果已复制到剪贴板。");
  }

  if (action.toolName === "scroll_page") {
    const element = resolveTarget(action);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      window.scrollBy({
        top: Math.round(window.innerHeight * 0.7),
        behavior: "smooth",
      });
    }
    return createResult(action, "succeeded", "页面已滚动。");
  }

  const element = resolveTarget(action);
  if (!element || !isElementVisible(element)) {
    return createResult(action, "failed", "目标元素已失效或不可见。");
  }

  if (isDisabledElement(element)) {
    return createResult(
      action,
      "failed",
      "目标元素处于禁用状态，无法点击或填写。",
    );
  }

  const detectedRisk = detectRiskLevel(element);
  if (detectedRisk === "high" || isSensitiveField(element)) {
    return createResult(
      action,
      "blocked",
      "目标元素被识别为敏感或高风险控件，已阻断。",
    );
  }

  if (action.toolName === "highlight_element") {
    return highlightElement(action.target?.elementId || "")
      ? createResult(action, "succeeded", "目标元素已高亮。")
      : createResult(action, "failed", "目标元素无法高亮。");
  }

  if (action.toolName === "click_element") {
    clickElement(element);
    return createResult(action, "succeeded", "已点击目标元素。");
  }

  if (action.toolName === "fill_input") {
    const value = action.input?.value ?? "";
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    ) {
      element.value = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return createResult(action, "succeeded", "已填写目标输入框。");
    }

    if (element.getAttribute("contenteditable") === "true") {
      element.textContent = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      return createResult(action, "succeeded", "已填写可编辑区域。");
    }

    return createResult(action, "failed", "目标元素不是可填写控件。");
  }

  return createResult(action, "blocked", "未知或未启用的工具动作。");
};
