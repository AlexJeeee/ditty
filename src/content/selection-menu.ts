import type { SelectionMenuAction } from "@/shared/extension-messages";

const MENU_ID = "chrome-ai-agent-selection-menu";
const MAX_SELECTION_LENGTH = 5000;
const BUTTONS: Array<{ action: SelectionMenuAction; label: string; title: string }> = [
  { action: "translate", label: "翻译", title: "翻译选中文本" },
  { action: "explain", label: "解释", title: "解释选中文本" },
  { action: "add_to_chat", label: "添加到对话", title: "把选中文本加入侧边栏对话" }
];

type SelectionMenuWindow = Window & {
  __chromeAiAgentSelectionMenuSetup?: boolean;
};

let host: HTMLDivElement | null = null;
let menu: HTMLDivElement | null = null;
let selectedText = "";
let hideTimer: number | undefined;

function createMenu() {
  if (host && menu) {
    return;
  }

  host = document.createElement("div");
  host.id = MENU_ID;
  host.style.position = "fixed";
  host.style.left = "0";
  host.style.top = "0";
  host.style.zIndex = "2147483647";
  host.style.pointerEvents = "none";

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    .selection-menu {
      display: flex;
      align-items: center;
      gap: 4px;
      border: 1px solid rgba(21, 30, 48, 0.12);
      border-radius: 8px;
      padding: 5px;
      background: rgba(255, 255, 255, 0.98);
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.22);
      color: #172033;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      pointer-events: auto;
      transform: translate(-9999px, -9999px);
      transition: opacity 120ms ease, transform 120ms ease;
      opacity: 0;
    }

    .selection-menu[data-open="true"] {
      opacity: 1;
    }

    button {
      min-height: 30px;
      border: 0;
      border-radius: 6px;
      padding: 0 9px;
      background: transparent;
      color: #1f2a44;
      font: inherit;
      font-size: 12px;
      font-weight: 650;
      white-space: nowrap;
      cursor: pointer;
    }

    button:hover {
      background: #eef4ff;
      color: #1748b5;
    }

    button:active {
      background: #dbe8ff;
    }
  `;

  menu = document.createElement("div");
  menu.className = "selection-menu";
  menu.setAttribute("role", "toolbar");
  menu.setAttribute("aria-label", "选中文本操作");

  for (const item of BUTTONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.label;
    button.title = item.title;
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => invokeSelectionAction(item.action));
    menu.append(button);
  }

  shadow.append(style, menu);
  document.documentElement.append(host);
}

function getSelectionInfo() {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const text = selection.toString().trim().replace(/\s+/g, " ");
  if (!text) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
  const rect = rects[rects.length - 1] ?? range.getBoundingClientRect();

  if (!rect || rect.width === 0 || rect.height === 0) {
    return null;
  }

  return {
    text: text.slice(0, MAX_SELECTION_LENGTH),
    rect
  };
}

function positionMenu(rect: DOMRect) {
  if (!menu) {
    return;
  }

  const spacing = 8;
  const menuRect = menu.getBoundingClientRect();
  const menuWidth = menuRect.width || 220;
  const menuHeight = menuRect.height || 42;
  const left = Math.min(Math.max(rect.left + rect.width / 2 - menuWidth / 2, spacing), window.innerWidth - menuWidth - spacing);
  const preferredTop = rect.bottom + spacing;
  const top =
    preferredTop + menuHeight + spacing > window.innerHeight
      ? Math.max(rect.top - menuHeight - spacing, spacing)
      : preferredTop;

  menu.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

function showSelectionMenu() {
  const info = getSelectionInfo();

  if (!info) {
    hideSelectionMenu();
    return;
  }

  createMenu();
  selectedText = info.text;

  window.clearTimeout(hideTimer);
  window.requestAnimationFrame(() => {
    positionMenu(info.rect);
    menu?.setAttribute("data-open", "true");
  });
}

function hideSelectionMenu() {
  selectedText = "";
  window.clearTimeout(hideTimer);

  if (!menu) {
    return;
  }

  menu.removeAttribute("data-open");
  menu.style.transform = "translate(-9999px, -9999px)";
}

async function invokeSelectionAction(action: SelectionMenuAction) {
  const text = selectedText || getSelectionInfo()?.text;

  if (!text) {
    hideSelectionMenu();
    return;
  }

  hideSelectionMenu();

  await chrome.runtime.sendMessage({
    type: "selection_action:invoke",
    payload: {
      id: `selection_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      action,
      selectedText: text,
      pageTitle: document.title,
      pageUrl: window.location.href,
      requestedAt: new Date().toISOString()
    }
  });
}

function scheduleSelectionCheck() {
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(showSelectionMenu, 80);
}

export function setupSelectionMenu() {
  const currentWindow = window as SelectionMenuWindow;
  if (currentWindow.__chromeAiAgentSelectionMenuSetup) {
    return;
  }

  currentWindow.__chromeAiAgentSelectionMenuSetup = true;

  document.addEventListener("selectionchange", scheduleSelectionCheck);
  document.addEventListener("mouseup", scheduleSelectionCheck);
  document.addEventListener("keyup", (event) => {
    if (event.key.startsWith("Arrow") || event.key === "Shift" || event.key === "Control" || event.key === "Meta") {
      scheduleSelectionCheck();
    }
  });
  window.addEventListener("scroll", hideSelectionMenu, true);
  window.addEventListener("resize", hideSelectionMenu);
}
