type BookmarkletOptions = {
  appOrigin: string;
  sessionId: string;
};

function bookmarkletRuntime({ appOrigin, sessionId }: BookmarkletOptions) {
  const script = `
(() => {
  const APP_ORIGIN = ${JSON.stringify(appOrigin)};
  const SESSION_ID = ${JSON.stringify(sessionId)};
  const OVERLAY_ID = "__spilledcinema_overlay__";
  const OUTLINE_ID = "__spilledcinema_outline__";
  const FRAME_MARKER = "__spilledcinema_frame_listener__";
  const state = {
    currentTarget: null,
    currentWindow: window,
    listeners: [],
  };

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.style.position = "fixed";
  overlay.style.right = "24px";
  overlay.style.bottom = "24px";
  overlay.style.zIndex = "2147483647";
  overlay.style.padding = "12px 16px";
  overlay.style.borderRadius = "16px";
  overlay.style.background = "rgba(7, 10, 19, 0.92)";
  overlay.style.color = "#f4efe1";
  overlay.style.fontFamily = "system-ui, sans-serif";
  overlay.style.fontSize = "14px";
  overlay.style.boxShadow = "0 12px 40px rgba(0,0,0,0.35)";
  overlay.textContent = "SpilledCinema: hover the player and click to capture. Same-origin iframes are supported.";
  document.body.appendChild(overlay);

  const outline = document.createElement("div");
  outline.id = OUTLINE_ID;
  outline.style.position = "fixed";
  outline.style.zIndex = "2147483646";
  outline.style.pointerEvents = "none";
  outline.style.border = "2px solid #fb923c";
  outline.style.borderRadius = "18px";
  outline.style.background = "rgba(251, 146, 60, 0.12)";
  document.body.appendChild(outline);

  const showMessage = (message) => {
    overlay.textContent = message;
  };

  const resolveAbsolute = (url, pageUrl) => {
    try {
      return new URL(url, pageUrl).toString();
    } catch {
      return url;
    }
  };

  const detectKind = (url, mimeType) => {
    const value = (url || "").toLowerCase();
    const mime = (mimeType || "").toLowerCase();
    if (value.includes(".m3u8") || mime.includes("mpegurl")) return "hls";
    if (value.includes(".webm") || mime.includes("video/webm")) return "direct_webm";
    if (value.includes(".mp4") || mime.includes("video/mp4")) return "direct_mp4";
    if (
      value.includes("/sources/") ||
      /(?:^|\.)(svetserialu\.to|filemoon\.[a-z]+|vidmoly\.[a-z]+|streamtape\.[a-z]+|mixdrop\.[a-z]+)/i.test(
        value,
      )
    ) {
      return "embed";
    }
    return "unknown";
  };

  const uniqueByUrl = (items) => {
    const seen = new Set();
    return items.filter((item) => {
      if (!item?.url || seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
  };

  const removeExisting = () => {
    document.getElementById(OVERLAY_ID)?.remove();
    document.getElementById(OUTLINE_ID)?.remove();
    state.listeners.forEach(({ win, type, handler }) => {
      win.document.removeEventListener(type, handler, true);
      win[FRAME_MARKER] = false;
    });
    window.removeEventListener("keydown", onKeyDown, true);
  };

  const getFrameChain = (sourceWindow) => {
    const chain = [];
    let currentWindow = sourceWindow;
    while (currentWindow && currentWindow !== window) {
      const parentWindow = currentWindow.parent;
      if (!parentWindow || parentWindow === currentWindow) {
        break;
      }

      let frameElement = null;
      try {
        frameElement = currentWindow.frameElement;
      } catch {
        break;
      }

      if (!(frameElement instanceof Element)) {
        break;
      }

      chain.push(frameElement);
      currentWindow = parentWindow;
    }

    return chain.reverse();
  };

  const toTopViewportRect = (target, sourceWindow) => {
    let rect = target.getBoundingClientRect();
    let left = rect.left;
    let top = rect.top;

    getFrameChain(sourceWindow).forEach((frameElement) => {
      const frameRect = frameElement.getBoundingClientRect();
      left += frameRect.left;
      top += frameRect.top;
    });

    return {
      left,
      top,
      width: rect.width,
      height: rect.height,
    };
  };

  const findNearestVideo = (start) => {
    if (!start) return null;
    if (start.tagName?.toLowerCase() === "video") return start;
    const child = start.querySelector?.("video");
    if (child) return child;
    let node = start.parentElement;
    while (node) {
      if (node.tagName?.toLowerCase() === "video") return node;
      const nested = node.querySelector?.("video");
      if (nested) return nested;
      node = node.parentElement;
    }
    return null;
  };

  const getAreaScore = (element) => {
    const rect = element?.getBoundingClientRect?.();
    if (!rect) return 0;
    return Math.min(rect.width * rect.height, 250000) / 1000;
  };

  const scoreCandidate = (element) => {
    if (!(element instanceof Element)) return -1;

    const tag = element.tagName.toLowerCase();
    let score = 0;
    if (tag === "video") score += 120;
    if (tag === "iframe") score += 85;
    if (element.querySelector?.("video")) score += 95;
    if (element.querySelector?.("iframe")) score += 55;
    if (element.closest?.("video")) score += 70;
    if (element.closest?.("iframe")) score += 45;

    const role = element.getAttribute("role") || "";
    const className = typeof element.className === "string" ? element.className.toLowerCase() : "";
    const id = (element.id || "").toLowerCase();
    const label = [role, className, id, element.getAttribute("aria-label") || ""].join(" ").toLowerCase();
    if (/player|video|media|stream|embed/.test(label)) score += 25;
    if (/ad|banner|popup|overlay|modal/.test(label)) score -= 40;

    score += getAreaScore(element);
    return score;
  };

  const collectCandidateChain = (element) => {
    const candidates = [];
    let current = element;
    while (current && current instanceof Element) {
      candidates.push(current);
      current = current.parentElement;
    }
    return candidates;
  };

  const pickBestTarget = (sourceWindow, seedTarget, pointX, pointY) => {
    const doc = sourceWindow.document;
    const stack = typeof pointX === "number" && typeof pointY === "number"
      ? doc.elementsFromPoint(pointX, pointY)
      : seedTarget
        ? [seedTarget]
        : [];

    const seen = new Set();
    const pool = [];

    stack.forEach((element) => {
      collectCandidateChain(element).forEach((candidate) => {
        if (!candidate || seen.has(candidate)) return;
        seen.add(candidate);
        pool.push(candidate);
      });
    });

    if (seedTarget) {
      collectCandidateChain(seedTarget).forEach((candidate) => {
        if (!candidate || seen.has(candidate)) return;
        seen.add(candidate);
        pool.push(candidate);
      });
    }

    return pool.sort((left, right) => scoreCandidate(right) - scoreCandidate(left))[0] || seedTarget;
  };

  const extractTracks = (video, pageUrl) => {
    const nodes = Array.from(video?.querySelectorAll?.("track[src]") || []);
    return uniqueByUrl(nodes.map((track) => ({
      url: resolveAbsolute(track.getAttribute("src"), pageUrl),
      label: track.label || undefined,
      srclang: track.srclang || undefined,
      kind: track.kind || undefined,
      default: track.default || false,
    })));
  };

  const extractTitle = (target, video, sourceDocument) => {
    const candidates = [
      sourceDocument.title,
      target?.getAttribute?.("aria-label"),
      video?.getAttribute?.("title"),
      video?.closest?.("[aria-label]")?.getAttribute?.("aria-label"),
      sourceDocument.querySelector("meta[property='og:title']")?.content,
      sourceDocument.querySelector("h1")?.textContent,
    ];
    return candidates.find((value) => value && value.trim())?.trim();
  };

  const extractPoster = (target, video, sourceDocument, pageUrl) => {
    const poster = video?.getAttribute?.("poster");
    if (poster) return resolveAbsolute(poster, pageUrl);
    const ogImage = sourceDocument.querySelector("meta[property='og:image']")?.content;
    if (ogImage) return resolveAbsolute(ogImage, pageUrl);
    const image =
      target?.querySelector?.("img") ||
      target?.closest?.("img") ||
      sourceDocument.querySelector("img[src]");
    const src = image?.getAttribute?.("src");
    return src ? resolveAbsolute(src, pageUrl) : undefined;
  };

  const extractMediaCandidates = (video, pageUrl) => {
    const candidates = [];
    const pushCandidate = (url, mimeType, originHint) => {
      if (!url) return;
      candidates.push({
        url: resolveAbsolute(url, pageUrl),
        mimeType: mimeType || undefined,
        kind: detectKind(url, mimeType),
        originHint,
      });
    };

    pushCandidate(video?.currentSrc, video?.currentType, "currentSrc");
    pushCandidate(video?.src, video?.getAttribute?.("type"), "src");
    Array.from(video?.querySelectorAll?.("source[src]") || []).forEach((source) => {
      pushCandidate(source.getAttribute("src"), source.getAttribute("type"), "source");
    });

    const dataAttrs = ["src", "url", "video", "stream", "hls"];
    const scanNode =
      video?.closest?.("[data-config],[data-player],[data-video-id]") || video?.parentElement;
    if (scanNode?.attributes) {
      Array.from(scanNode.attributes).forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        if (dataAttrs.some((part) => name.includes(part)) && attribute.value) {
          pushCandidate(attribute.value, undefined, "data-attribute");
        }
      });
    }

    return uniqueByUrl(candidates);
  };

  const scanDocumentForMediaUrls = (sourceDocument, pageUrl) => {
    const candidates = [];
    const pushCandidate = (url, originHint) => {
      if (!url) return;
      candidates.push({
        url: resolveAbsolute(url, pageUrl),
        mimeType: undefined,
        kind: detectKind(url),
        originHint,
      });
    };

    Array.from(sourceDocument.querySelectorAll("script")).forEach((script) => {
      const content = script.textContent || "";
      const matches = content.match(/https?:[^"'\\s]+\\.(m3u8|mp4|webm)(\\?[^"'\\s]*)?/gi) || [];
      matches.forEach((match) => pushCandidate(match, "script-text"));
    });

    return uniqueByUrl(candidates);
  };

  const decodeBase64 = (value) => {
    try {
      return window.atob(value);
    } catch {
      return null;
    }
  };

  const extractBombujCandidatesFromFragment = (rootNode, pageUrl) => {
    const candidates = [];
    const pushCandidate = (url, originHint) => {
      if (!url) return;
      candidates.push({
        url: resolveAbsolute(url, pageUrl),
        mimeType: undefined,
        kind: "embed",
        originHint,
      });
    };

    const blocks = Array.from(rootNode.querySelectorAll?.(".dropdownlink") || []);
    const registerLinks = (container, languageHint) => {
      Array.from(container.querySelectorAll?.("li[link]") || []).forEach((item) => {
        const rawLink = item.getAttribute("link");
        const providerLabel =
          item.querySelector?.("a")?.textContent?.trim().toLowerCase() ||
          item.getAttribute("data-player")?.trim().toLowerCase() ||
          "player";
        const hint = languageHint
          ? "bombuj:" + providerLabel + ":" + languageHint.toLowerCase()
          : "bombuj:" + providerLabel;
        pushCandidate(rawLink, hint);
      });
    };

    if (blocks.length > 0) {
      blocks.forEach((block) => {
        const language =
          block.querySelector?.("img[src*='cflag']")?.parentElement?.textContent?.trim() ||
          block.textContent?.trim() ||
          "";
        const content = block.nextElementSibling instanceof Element ? block.nextElementSibling : block.parentElement;
        if (content) {
          registerLinks(content, language);
        }
      });
    }

    registerLinks(rootNode, "");
    return uniqueByUrl(candidates);
  };

  const extractBombujAjaxConfig = (sourceDocument) => {
    const scripts = Array.from(sourceDocument.querySelectorAll("script"));
    for (const script of scripts) {
      const content = script.textContent || "";
      if (!/prehravace_ajax\.php/i.test(content)) continue;

      const dataMatch = content.match(/data:\s*\{([\s\S]*?)\}\s*,\s*success\s*:/i);
      if (!dataMatch?.[1]) continue;

      const params = new URLSearchParams();
      for (const match of dataMatch[1].matchAll(/([a-z_]+)\s*:\s*'([^']*)'/gi)) {
        params.set(match[1], match[2]);
      }

      if ([...params.keys()].length > 0) {
        return params;
      }
    }

    return null;
  };

  const extractPageProviderCandidates = async (sourceDocument, pageUrl) => {
    const hostname = (() => {
      try {
        return new URL(pageUrl).hostname.toLowerCase();
      } catch {
        return "";
      }
    })();

    const candidates = [];
    const pushCandidate = (url, originHint) => {
      if (!url) return;
      candidates.push({
        url: resolveAbsolute(url, pageUrl),
        mimeType: undefined,
        kind: "embed",
        originHint,
      });
    };

    if (hostname.endsWith("svetserialu.to") || hostname.endsWith("svetserialov.to") || hostname.endsWith("svetserialu.io")) {
      Array.from(sourceDocument.querySelectorAll(".source_link[data-iframe]")).forEach((link) => {
        const encoded = link.getAttribute("data-iframe");
        const decoded = encoded ? decodeBase64(encoded) : null;
        const provider =
          Array.from(link.classList).find((token) => token !== "source_link") || "source-link";
        pushCandidate(decoded, "svetserialu:" + provider);
      });

      Array.from(sourceDocument.querySelectorAll(".tabshe[data-iframe-url]")).forEach((node) => {
        pushCandidate(node.getAttribute("data-iframe-url"), "svetserialu:source-list");
      });

      Array.from(sourceDocument.querySelectorAll("iframe[src]")).forEach((frame) => {
        const frameSrc = frame.getAttribute("src");
        if (!frameSrc || frameSrc === "about:blank") {
          return;
        }

        pushCandidate(frameSrc, "svetserialu:active-iframe");
      });
    }

    if (hostname.endsWith("bombuj.si")) {
      const direct = extractBombujCandidatesFromFragment(sourceDocument, pageUrl);
      direct.forEach((candidate) => candidates.push(candidate));

      if (direct.length === 0) {
        const ajaxParams = extractBombujAjaxConfig(sourceDocument);
        if (ajaxParams) {
          try {
            const ajaxUrl = new URL("prehravace_ajax.php", pageUrl);
            ajaxUrl.search = ajaxParams.toString();

            const response = await fetch(ajaxUrl.toString(), {
              headers: {
                "X-Requested-With": "XMLHttpRequest",
              },
              credentials: "include",
            });

            if (response.ok) {
              const html = await response.text();
              const parser = new DOMParser();
              const ajaxDocument = parser.parseFromString(html, "text/html");
              extractBombujCandidatesFromFragment(ajaxDocument, pageUrl).forEach((candidate) => {
                candidates.push(candidate);
              });
            }
          } catch {
            // Fail-open: the picker can still submit any other candidates found on the page.
          }
        }
      }
    }

    return uniqueByUrl(candidates);
  };

  const findPlayableInDocument = (sourceWindow, visited = new Set()) => {
    if (!sourceWindow || visited.has(sourceWindow)) {
      return null;
    }

    visited.add(sourceWindow);

    const sourceDocument = sourceWindow.document;
    const videos = Array.from(sourceDocument.querySelectorAll("video"));
    const bestVideo = videos.find((video) => {
      const candidates = extractMediaCandidates(video, sourceWindow.location.href);
      return candidates.length > 0;
    });

    if (bestVideo) {
      return { target: bestVideo, sourceWindow };
    }

    const frameElements = Array.from(sourceDocument.querySelectorAll("iframe"));
    for (const frameElement of frameElements) {
      try {
        const childWindow = frameElement.contentWindow;
        if (!childWindow?.document) {
          continue;
        }

        const nested = findPlayableInDocument(childWindow, visited);
        if (nested) {
          return nested;
        }
      } catch {
        // Cross-origin nested frame.
      }
    }

    const docCandidates = scanDocumentForMediaUrls(sourceDocument, sourceWindow.location.href);
    if (docCandidates.length > 0) {
      return { target: sourceDocument.body || sourceDocument.documentElement, sourceWindow };
    }

    return null;
  };

  const tryFramePayload = (frame) => {
    const parentCandidatesPromise = extractPageProviderCandidates(document, window.location.href);
    const buildFallbackPayload = (parentCandidates, notes) => ({
      sessionId: SESSION_ID,
      pageUrl: window.location.href,
      pageTitle: document.title,
      clickedElementTag: "iframe",
      posterUrl: undefined,
      mediaCandidates: parentCandidates,
      subtitleTracks: [],
      notes,
    });
    try {
      const frameWindow = frame.contentWindow;
      const frameDocument = frame.contentDocument;
      if (!frameWindow || !frameDocument) {
        return parentCandidatesPromise.then((parentCandidates) =>
          buildFallbackPayload(
            parentCandidates,
            parentCandidates.length > 0
              ? "The iframe is cross-origin, but source links were extracted from the parent page."
              : "This iframe could not be inspected. Cross-origin iframe content is not accessible to a bookmarklet.",
          ),
        );
      }

      const nestedPlayable = findPlayableInDocument(frameWindow);
      if (!nestedPlayable) {
        return parentCandidatesPromise.then((parentCandidates) => ({
          sessionId: SESSION_ID,
          pageUrl: frameWindow.location.href,
          pageTitle: frameDocument.title || document.title,
          clickedElementTag: "iframe",
          posterUrl: undefined,
          mediaCandidates: parentCandidates,
          subtitleTracks: [],
          notes: parentCandidates.length > 0
            ? "No direct HTML5 video was found inside the iframe, but source links were extracted from the parent page."
            : "Iframe was accessible, but no direct HTML5 video element was found inside it.",
        }));
      }

      return buildPayload(nestedPlayable.target, nestedPlayable.sourceWindow);
    } catch {
      return parentCandidatesPromise.then((parentCandidates) =>
        buildFallbackPayload(
          parentCandidates,
          parentCandidates.length > 0
            ? "This iframe is cross-origin, so its DOM is blocked, but source links were extracted from the parent page."
            : "This iframe is cross-origin, so its DOM and player internals are blocked by the browser.",
        ),
      );
    }
  };

  const buildPayload = async (target, sourceWindow, eventPoint) => {
    const sourceDocument = sourceWindow.document;
    const pageUrl = sourceWindow.location.href;
    const selectedTarget = pickBestTarget(
      sourceWindow,
      target,
      eventPoint?.clientX,
      eventPoint?.clientY,
    );

    if (selectedTarget?.tagName?.toLowerCase() === "iframe") {
      return tryFramePayload(selectedTarget);
    }

    const video = findNearestVideo(selectedTarget);
    const providerCandidates = await extractPageProviderCandidates(sourceDocument, pageUrl);
    const mediaCandidates = uniqueByUrl([
      ...extractMediaCandidates(video, pageUrl),
      ...scanDocumentForMediaUrls(sourceDocument, pageUrl),
      ...providerCandidates,
    ]);
    const subtitleTracks = extractTracks(video, pageUrl);

    return {
      sessionId: SESSION_ID,
      pageUrl,
      pageTitle: extractTitle(selectedTarget, video, sourceDocument),
      clickedElementTag: selectedTarget?.tagName?.toLowerCase(),
      posterUrl: extractPoster(selectedTarget, video, sourceDocument, pageUrl),
      mediaCandidates,
      subtitleTracks,
      detectedDurationSeconds: Number.isFinite(video?.duration) ? video.duration : undefined,
      notes: video
        ? undefined
        : "No nearby HTML5 video element was found. This page may use an unsupported player, a blocked iframe, or a protected stream.",
    };
  };

  async function submitPayload(payload) {
    const response = await fetch(APP_ORIGIN + "/api/capture/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "omit",
      mode: "cors",
    });

    if (!response.ok) {
      throw new Error("Capture upload failed");
    }

    return response.json();
  }

  const updateOutline = (target, sourceWindow) => {
    if (!target) return;
    const rect = toTopViewportRect(target, sourceWindow);
    outline.style.left = rect.left + "px";
    outline.style.top = rect.top + "px";
    outline.style.width = rect.width + "px";
    outline.style.height = rect.height + "px";
  };

  const handleMove = (sourceWindow, event) => {
    const target = event.target instanceof Element ? event.target : null;
    state.currentTarget = target;
    state.currentWindow = sourceWindow;
    if (!target) return;
    updateOutline(
      pickBestTarget(sourceWindow, target, event.clientX, event.clientY),
      sourceWindow,
    );
  };

  const handleClick = async (sourceWindow, event) => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.target instanceof Element ? event.target : state.currentTarget;
    showMessage("SpilledCinema: extracting media...");
    try {
      const payload = await buildPayload(target, sourceWindow, {
        clientX: event.clientX,
        clientY: event.clientY,
      });
      await submitPayload(payload);
      showMessage("Capture sent. Opening review screen...");
      setTimeout(() => {
        window.open(APP_ORIGIN + "/capture/" + SESSION_ID, "_blank", "noopener,noreferrer");
        removeExisting();
      }, 500);
    } catch (error) {
      console.error(error);
      showMessage("Capture failed. This page may block extraction or use an unsupported player.");
    }
  };

  const attachListeners = (targetWindow) => {
    if (!targetWindow || targetWindow[FRAME_MARKER]) {
      return;
    }

    const moveHandler = (event) => handleMove(targetWindow, event);
    const clickHandler = (event) => {
      void handleClick(targetWindow, event);
    };

    targetWindow.document.addEventListener("mousemove", moveHandler, true);
    targetWindow.document.addEventListener("click", clickHandler, true);
    targetWindow[FRAME_MARKER] = true;

    state.listeners.push(
      { win: targetWindow, type: "mousemove", handler: moveHandler },
      { win: targetWindow, type: "click", handler: clickHandler },
    );

    Array.from(targetWindow.document.querySelectorAll("iframe")).forEach((frame) => {
      try {
        if (frame.contentWindow?.document) {
          attachListeners(frame.contentWindow);
        }
      } catch {
        // Cross-origin iframe. We can only select the iframe element itself from the parent document.
      }
    });
  };

  function onKeyDown(event) {
    if (event.key === "Escape") {
      removeExisting();
    }
  }

  attachListeners(window);
  window.addEventListener("keydown", onKeyDown, true);
})();
`;

  return `javascript:${encodeURIComponent(script)}`;
}

export function createBookmarkletHref(options: BookmarkletOptions) {
  return bookmarkletRuntime(options);
}

export function createBookmarkletInstructions(payload: {
  sourcePageUrl: string;
  bookmarkletHref: string;
}) {
  return {
    ...payload,
    installSteps: [
      "Drag the bookmarklet button into your bookmarks bar.",
      "Open the source page in a new tab.",
      "Click the bookmarklet, then click the player area. Same-origin iframe players can be selected from inside the frame.",
      "If the player lives in a cross-origin iframe, SpilledCinema can only detect the iframe shell and will report that browser access is blocked.",
      "SpilledCinema will open the review page after the capture uploads.",
    ],
  };
}
