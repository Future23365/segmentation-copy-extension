(function initializePopup() {
  "use strict";

  const textarea = document.getElementById("sourceText");
  const tokenCanvas = document.getElementById("tokenCanvas");
  const sourceHint = document.getElementById("sourceHint");
  const feedbackText = document.getElementById("feedbackText");
  const popup = document.querySelector(".sc-popup");
  const COPY_CLOSE_DELAY = 780;
  let copiedTimer = null;

  textarea.addEventListener("input", () => {
    sourceHint.textContent = "手动输入";
    renderTokens(textarea.value);
  });

  hydrateFromActiveSelection();
  renderTokens(textarea.value);

  function hydrateFromActiveSelection() {
    if (!globalThis.chrome?.tabs?.query || !globalThis.chrome?.tabs?.sendMessage) {
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab?.id) {
        return;
      }

      chrome.tabs.sendMessage(tab.id, { type: "SEGMENTATION_COPY_GET_SELECTION" }, (response) => {
        if (chrome.runtime.lastError || !response?.text) {
          return;
        }

        textarea.value = response.text;
        sourceHint.textContent = "当前选中文本";
        renderTokens(response.text);
      });
    });
  }

  function renderTokens(text) {
    tokenCanvas.innerHTML = "";
    const source = String(text ?? "").trim();

    if (!source) {
      const empty = document.createElement("div");
      empty.className = "sc-empty-message sc-empty-message--popup";
      empty.textContent = "输入文本后会显示可复制片段。";
      tokenCanvas.append(empty);
      return;
    }

    const segments = window.SegmentationCopyTokenizer.tokenize(source);
    tokenCanvas.append(...segments.map(renderSegment));
  }

  function renderSegment(segment) {
    if (segment.type === "space") {
      return document.createTextNode(segment.value);
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = `sc-token sc-token--${segment.kind}`;
    button.textContent = segment.value;
    button.title = `复制 ${segment.copyText}`;
    button.addEventListener("click", () => copyToken(button, segment.copyText));
    return button;
  }

  async function copyToken(button, text) {
    if (!text) {
      return;
    }

    const ok = await window.SegmentationCopyClipboard.copyText(text);
    button.classList.toggle("sc-token--copied", ok);
    feedbackText.textContent = ok ? `已复制：${text}` : "复制失败，请手动复制";

    window.clearTimeout(copiedTimer);
    if (ok) {
      beginCopiedClose(button);
      return;
    }

    copiedTimer = window.setTimeout(() => {
      button.classList.remove("sc-token--copied");
      feedbackText.textContent = "点击片段即可复制";
    }, 1400);
  }

  function beginCopiedClose(button) {
    popup?.classList.add("sc-panel--copy-closing");
    button.classList.add("sc-token--linger");
    copiedTimer = window.setTimeout(() => window.close(), COPY_CLOSE_DELAY);
  }
})();
