/**
 * Returns the currently active tab in the focused window.
 */
export const getActiveTab = async (): Promise<chrome.tabs.Tab | undefined> => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
};

/**
 * Returns true if the extension may inject content scripts into the given tab URL.
 * Chrome internal pages and extension pages are not accessible.
 */
export const isTabUrlAccessible = (url: string): boolean => {
  return !url.startsWith("chrome://") && !url.startsWith("chrome-extension://");
};
