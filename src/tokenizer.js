(function exposeTokenizer(root) {
  "use strict";

  const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;
  const RESOURCE_WORDS = new Set([
    "aac",
    "ass",
    "avc",
    "bdrip",
    "bdremux",
    "flac",
    "fin",
    "hevc",
    "hdr",
    "mkv",
    "mp4",
    "opus",
    "web-dl",
    "webrip",
    "x264",
    "x265"
  ]);

  const STRUCTURE_CHARS = new Set([
    "/",
    "|",
    "_",
    ":",
    "：",
    "[",
    "]",
    "(",
    ")",
    "【",
    "】",
    "（",
    "）",
    "{",
    "}",
    "?",
    "&",
    "=",
    "#"
  ]);

  const PUNCTUATION_CHARS = new Set([
    "!",
    "！",
    "?",
    "？",
    ".",
    "。",
    ",",
    "，",
    ";",
    "；",
    "、",
    "~",
    "～",
    "+",
    "*",
    "\\"
  ]);

  function tokenize(input) {
    const text = String(input ?? "");
    if (!text) {
      return [];
    }

    const segments = [];
    let lastIndex = 0;

    for (const match of text.matchAll(URL_PATTERN)) {
      const url = trimTrailingUrlPunctuation(match[0]);
      const index = match.index ?? 0;
      const urlEnd = index + url.length;

      if (index > lastIndex) {
        segments.push(...tokenizePlainText(text.slice(lastIndex, index)));
      }

      segments.push(...tokenizeUrl(url));

      if (urlEnd < index + match[0].length) {
        segments.push(...tokenizePlainText(match[0].slice(url.length)));
      }

      lastIndex = index + match[0].length;
    }

    if (lastIndex < text.length) {
      segments.push(...tokenizePlainText(text.slice(lastIndex)));
    }

    return mergeAdjacentSpaces(segments);
  }

  function trimTrailingUrlPunctuation(url) {
    let end = url.length;
    while (end > 0 && /[)\]】）。，,;；!?！？]/.test(url[end - 1])) {
      end -= 1;
    }
    return url.slice(0, end);
  }

  function tokenizeUrl(url) {
    const match = url.match(/^(https?):\/\/([^/?#]+)([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/i);
    if (!match) {
      return tokenizePlainText(url);
    }

    const [, protocol, host, path = "", query, hash] = match;
    const segments = [
      token(protocol, "url"),
      token(":", "structure"),
      token("/", "structure"),
      token("/", "structure"),
      token(host, "url")
    ];

    if (path) {
      const parts = path.split("/");
      for (let index = 1; index < parts.length; index += 1) {
        segments.push(token("/", "structure"));
        if (parts[index]) {
          segments.push(...tokenizePlainText(parts[index]));
        }
      }
    }

    if (query !== undefined) {
      segments.push(token("?", "structure"));
      query.split("&").forEach((pair, pairIndex) => {
        if (pairIndex > 0) {
          segments.push(token("&", "structure"));
        }

        const equalIndex = pair.indexOf("=");
        if (equalIndex === -1) {
          segments.push(...tokenizePlainText(decodeUrlPart(pair)));
          return;
        }

        const key = pair.slice(0, equalIndex);
        const value = pair.slice(equalIndex + 1);
        if (key) {
          segments.push(...tokenizePlainText(decodeUrlPart(key)));
        }
        segments.push(token("=", "structure"));
        if (value) {
          segments.push(...tokenizePlainText(decodeUrlPart(value)));
        }
      });
    }

    if (hash !== undefined) {
      segments.push(token("#", "structure"));
      if (hash) {
        segments.push(...tokenizePlainText(decodeUrlPart(hash)));
      }
    }

    return segments;
  }

  function decodeUrlPart(value) {
    try {
      return decodeURIComponent(value.replace(/\+/g, " "));
    } catch (error) {
      return value;
    }
  }

  function tokenizePlainText(text) {
    const segments = [];
    let index = 0;

    while (index < text.length) {
      const char = text[index];

      if (isWhitespace(char)) {
        const next = consumeWhile(text, index, isWhitespace);
        segments.push(space(text.slice(index, next)));
        index = next;
        continue;
      }

      if (isCjk(char)) {
        const next = consumeWhile(text, index, isCjk);
        segments.push(token(text.slice(index, next), "cjk"));
        index = next;
        continue;
      }

      if (isAsciiLetter(char)) {
        const result = consumeLatinPhrase(text, index);
        segments.push(...result.segments);
        index = result.nextIndex;
        continue;
      }

      if (isDigit(char)) {
        const next = consumeNumberLike(text, index);
        segments.push(token(text.slice(index, next), "word"));
        index = next;
        continue;
      }

      if (STRUCTURE_CHARS.has(char)) {
        segments.push(token(char, "structure"));
        index += 1;
        continue;
      }

      if (char === "-" && shouldKeepHyphen(text, index)) {
        const next = consumeHyphenated(text, index);
        segments.push(token(text.slice(index, next), "word"));
        index = next;
        continue;
      }

      segments.push(token(char, PUNCTUATION_CHARS.has(char) ? "punctuation" : "symbol"));
      index += 1;
    }

    return segments;
  }

  function consumeLatinPhrase(text, start) {
    const words = [];
    let index = start;

    while (index < text.length) {
      const wordStart = index;
      index = consumeWordLike(text, index);
      words.push(text.slice(wordStart, index));

      const spaceStart = index;
      const spaceEnd = consumeHorizontalSpaces(text, index);
      const nextChar = text[spaceEnd];

      if (spaceEnd === spaceStart || !isAsciiLetter(nextChar)) {
        index = spaceStart;
        break;
      }

      if (isResourceToken(words[0]) || isResourceToken(text.slice(spaceEnd, consumeWordLike(text, spaceEnd)))) {
        index = spaceStart;
        break;
      }

      index = spaceEnd;
    }

    if (words.length === 1) {
      return {
        nextIndex: index,
        segments: [token(words[0], "word")]
      };
    }

    return {
      nextIndex: index,
      segments: [token(text.slice(start, index), "word")]
    };
  }

  function consumeWordLike(text, start) {
    let index = start;
    while (index < text.length) {
      const char = text[index];
      if (isAsciiLetter(char) || isDigit(char)) {
        index += 1;
        continue;
      }
      if ((char === "-" || char === "'") && shouldKeepHyphen(text, index)) {
        index += 1;
        continue;
      }
      break;
    }
    return index;
  }

  function consumeNumberLike(text, start) {
    let index = start;
    while (index < text.length) {
      const char = text[index];
      if (isAsciiLetter(char) || isDigit(char) || char === "." || (char === "-" && shouldKeepHyphen(text, index))) {
        index += 1;
        continue;
      }
      break;
    }
    return index;
  }

  function consumeHyphenated(text, start) {
    let index = start;
    while (index < text.length && (isAsciiLetter(text[index]) || isDigit(text[index]) || text[index] === "-")) {
      index += 1;
    }
    return index;
  }

  function shouldKeepHyphen(text, index) {
    return isAlphaNumeric(text[index - 1]) && isAlphaNumeric(text[index + 1]);
  }

  function isResourceToken(word) {
    const normalized = word.toLowerCase();
    return RESOURCE_WORDS.has(normalized) || /^[0-9]+p$/i.test(word) || /^[0-9]+-bit$/i.test(word) || /^[A-Z0-9]{2,}$/.test(word);
  }

  function mergeAdjacentSpaces(segments) {
    const merged = [];
    for (const segment of segments) {
      const previous = merged[merged.length - 1];
      if (segment.type === "space" && previous?.type === "space") {
        previous.value += segment.value;
      } else {
        merged.push(segment);
      }
    }
    return merged;
  }

  function consumeWhile(text, start, predicate) {
    let index = start;
    while (index < text.length && predicate(text[index])) {
      index += 1;
    }
    return index;
  }

  function consumeHorizontalSpaces(text, start) {
    let index = start;
    while (index < text.length && (text[index] === " " || text[index] === "\t")) {
      index += 1;
    }
    return index;
  }

  function isWhitespace(char) {
    return /\s/.test(char);
  }

  function isCjk(char) {
    return /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff]/.test(char);
  }

  function isAsciiLetter(char) {
    return !!char && /[A-Za-z]/.test(char);
  }

  function isDigit(char) {
    return !!char && /[0-9]/.test(char);
  }

  function isAlphaNumeric(char) {
    return isAsciiLetter(char) || isDigit(char);
  }

  function token(value, kind) {
    return {
      type: "token",
      kind,
      value,
      copyText: String(value).trim()
    };
  }

  function space(value) {
    return {
      type: "space",
      value
    };
  }

  root.SegmentationCopyTokenizer = { tokenize };
})(typeof globalThis !== "undefined" ? globalThis : window);
