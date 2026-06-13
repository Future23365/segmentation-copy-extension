const CONTEXT_MENU_ID = "segmentation-copy-open";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: "拆分并复制片段",
      contexts: ["page", "selection", "link"]
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !tab?.id) {
    return;
  }

  chrome.tabs.sendMessage(
    tab.id,
    {
      type: "SEGMENTATION_COPY_OPEN_FROM_CONTEXT_MENU",
      selectionText: info.selectionText || "",
      linkUrl: info.linkUrl || ""
    },
    () => {
      if (chrome.runtime.lastError) {
        // Some pages, such as chrome:// URLs, do not allow content scripts.
      }
    }
  );
});
