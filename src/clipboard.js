(function exposeClipboard(root) {
  "use strict";

  async function copyText(text) {
    const value = String(text ?? "");

    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch (error) {
        // Fall through to execCommand for pages where Clipboard API is blocked.
      }
    }

    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.opacity = "0";
    document.documentElement.appendChild(textarea);
    textarea.select();

    try {
      return document.execCommand("copy");
    } finally {
      textarea.remove();
    }
  }

  root.SegmentationCopyClipboard = { copyText };
})(typeof globalThis !== "undefined" ? globalThis : window);
