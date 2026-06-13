(function initializeContentScript() {
  "use strict";

  const MAX_TEXT_BLOCK_LENGTH = 1000;
  const COPY_CLOSE_DELAY = 780;
  const PANEL_ID = "segmentation-copy-panel-root";
  const TEXT_CONTAINER_SELECTOR = [
    "a",
    "[role='link']",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "li",
    "td",
    "th",
    "span",
    "button",
    "div"
  ].join(",");

  let lastContext = null;
  let copiedTimer = null;

  document.addEventListener(
    "contextmenu",
    (event) => {
      lastContext = readContext(event);
    },
    true
  );

  document.addEventListener("pointerdown", handleOutsidePointerDown, true);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "SEGMENTATION_COPY_OPEN_FROM_CONTEXT_MENU") {
      openFromContextMenu(message);
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "SEGMENTATION_COPY_GET_SELECTION") {
      sendResponse({ text: getSelectionText() });
      return false;
    }

    return false;
  });

  function handleOutsidePointerDown(event) {
    const panel = document.querySelector(`#${PANEL_ID} .sc-panel`);
    if (!panel) {
      return;
    }

    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    if (panel.contains(event.target) || path.includes(panel)) {
      return;
    }

    removePanel();
  }

  function readContext(event) {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    const block = target ? findCurrentTextBlock(target) : { text: "", rejectedTooLong: false };
    const link = target?.closest?.("a,[role='link']");
    const rawLinkText = normalizeText(getElementText(link));
    const linkText = rawLinkText.length <= MAX_TEXT_BLOCK_LENGTH ? rawLinkText : "";

    return {
      x: event.clientX,
      y: event.clientY,
      selectionText: getSelectionText(),
      blockText: block.text,
      blockRejectedTooLong: block.rejectedTooLong || rawLinkText.length > MAX_TEXT_BLOCK_LENGTH,
      linkText,
      linkHref: getLinkHref(link),
      timestamp: Date.now()
    };
  }

  function openFromContextMenu(message) {
    const context = lastContext || {
      x: window.innerWidth / 2,
      y: 80,
      selectionText: "",
      blockText: "",
      blockRejectedTooLong: false,
      linkText: "",
      linkHref: message.linkUrl || ""
    };

    const selectionText = normalizeText(message.selectionText || context.selectionText);
    const linkText = normalizeText(context.linkText);
    const blockText = normalizeText(context.blockText);
    const linkHref = normalizeText(message.linkUrl || context.linkHref);

    if (selectionText) {
      renderPanel({ text: selectionText, source: "选中文本", x: context.x, y: context.y });
      return;
    }

    if (blockText) {
      const source = linkText && blockText === linkText ? "链接文本" : "当前文本块";
      renderPanel({ text: blockText, source, x: context.x, y: context.y, alternativeText: linkHref });
      return;
    }

    if (linkText) {
      renderPanel({ text: linkText, source: "链接文本", x: context.x, y: context.y, alternativeText: linkHref });
      return;
    }

    if (linkHref) {
      renderPanel({ text: linkHref, source: "链接地址", x: context.x, y: context.y });
      return;
    }

    if (context.blockRejectedTooLong) {
      renderMessagePanel({
        x: context.x,
        y: context.y,
        message: "当前文本块超过 1000 字，请手动框选需要拆分的部分。"
      });
      return;
    }

    renderMessagePanel({
      x: context.x,
      y: context.y,
      message: "未找到可拆分文本，请先框选文字或右键独立文本块。"
    });
  }

  function findCurrentTextBlock(startElement) {
    let element = startElement;

    while (element && element !== document.body && element !== document.documentElement) {
      if (element.matches?.(TEXT_CONTAINER_SELECTOR)) {
        const text = normalizeText(getElementText(element));
        if (text) {
          if (text.length > MAX_TEXT_BLOCK_LENGTH) {
            return { text: "", rejectedTooLong: true };
          }
          return { text, rejectedTooLong: false };
        }
      }

      element = element.parentElement;
    }

    return { text: "", rejectedTooLong: false };
  }

  function renderPanel({ text, source, x, y, alternativeText = "" }) {
    const root = ensureRoot();
    root.innerHTML = "";

    const panel = document.createElement("section");
    panel.className = "sc-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "文字拆分复制");

    const header = document.createElement("header");
    header.className = "sc-panel__header";

    const title = document.createElement("div");
    title.className = "sc-panel__title";
    title.textContent = "文字拆分复制";

    const closeButton = document.createElement("button");
    closeButton.className = "sc-icon-button";
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "关闭");
    closeButton.title = "关闭";
    closeButton.textContent = "×";
    closeButton.addEventListener("click", removePanel);

    header.append(title, closeButton);

    const sourceLine = document.createElement("div");
    sourceLine.className = "sc-source";
    sourceLine.textContent = source;

    const body = document.createElement("div");
    body.className = "sc-token-canvas";
    body.append(...renderSegments(window.SegmentationCopyTokenizer.tokenize(text)));

    if (alternativeText) {
      const fallbackButton = document.createElement("button");
      fallbackButton.type = "button";
      fallbackButton.className = "sc-link-source";
      fallbackButton.textContent = "切换到链接地址";
      fallbackButton.addEventListener("click", () => {
        renderPanel({ text: alternativeText, source: "链接地址", x, y });
      });
      sourceLine.append(fallbackButton);
    }

    const footer = document.createElement("footer");
    footer.className = "sc-panel__footer";
    footer.innerHTML = '<span class="sc-info-icon">i</span><span data-sc-feedback>点击片段即可复制</span>';

    panel.append(header, sourceLine, body, footer);
    root.append(panel);
    positionPanel(panel, x, y);
  }

  function renderMessagePanel({ x, y, message }) {
    const root = ensureRoot();
    root.innerHTML = "";

    const panel = document.createElement("section");
    panel.className = "sc-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "文字拆分复制");

    const header = document.createElement("header");
    header.className = "sc-panel__header";

    const title = document.createElement("div");
    title.className = "sc-panel__title";
    title.textContent = "文字拆分复制";

    const closeButton = document.createElement("button");
    closeButton.className = "sc-icon-button";
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "关闭");
    closeButton.title = "关闭";
    closeButton.textContent = "×";
    closeButton.addEventListener("click", removePanel);

    header.append(title, closeButton);

    const body = document.createElement("div");
    body.className = "sc-empty-message";
    body.textContent = message;

    panel.append(header, body);
    root.append(panel);
    positionPanel(panel, x, y);
  }

  function renderSegments(segments) {
    return segments.map((segment) => {
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
    });
  }

  async function copyToken(button, text) {
    if (!text) {
      return;
    }

    const ok = await window.SegmentationCopyClipboard.copyText(text);
    const panel = button.closest(".sc-panel");
    const feedback = panel?.querySelector("[data-sc-feedback]");

    button.classList.toggle("sc-token--copied", ok);
    if (feedback) {
      feedback.textContent = ok ? `已复制：${text}` : "复制失败，请手动复制";
    }

    window.clearTimeout(copiedTimer);
    if (ok) {
      beginCopiedClose(panel, button);
      return;
    }

    copiedTimer = window.setTimeout(() => {
      button.classList.remove("sc-token--copied");
      if (feedback) {
        feedback.textContent = "点击片段即可复制";
      }
    }, 1400);
  }

  function beginCopiedClose(panel, button) {
    if (!panel) {
      copiedTimer = window.setTimeout(removePanel, COPY_CLOSE_DELAY);
      return;
    }

    panel.classList.add("sc-panel--copy-closing");
    button.classList.add("sc-token--linger");
    copiedTimer = window.setTimeout(removePanel, COPY_CLOSE_DELAY);
  }

  function ensureRoot() {
    let root = document.getElementById(PANEL_ID);
    if (!root) {
      root = document.createElement("div");
      root.id = PANEL_ID;
      document.documentElement.appendChild(root);
    }
    return root;
  }

  function removePanel() {
    window.clearTimeout(copiedTimer);
    copiedTimer = null;
    document.getElementById(PANEL_ID)?.remove();
  }

  function positionPanel(panel, x, y) {
    const margin = 12;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const rect = panel.getBoundingClientRect();
    const left = Math.min(Math.max(margin, x + 12), viewportWidth - rect.width - margin);
    const top = Math.min(Math.max(margin, y + 12), viewportHeight - rect.height - margin);

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function getSelectionText() {
    return normalizeText(window.getSelection?.().toString() || "");
  }

  function getElementText(element) {
    if (!element) {
      return "";
    }
    return element.innerText || element.textContent || "";
  }

  function getLinkHref(element) {
    if (!element) {
      return "";
    }
    if (element instanceof HTMLAnchorElement) {
      return element.href || "";
    }
    return element.getAttribute?.("href") || "";
  }

  function normalizeText(text) {
    return String(text ?? "").replace(/\u00a0/g, " ").trim();
  }
})();
