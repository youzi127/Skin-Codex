((cssText, artDataUrl, rawConfig, componentsConfig, experienceConfig) => {
  const STATE_KEY = "__CODEX_DREAM_SKIN_STATE__";
  const STYLE_ID = "codex-dream-skin-style";
  const CHROME_ID = "codex-dream-skin-chrome";
  const ROOT_CLASSES = [
    "codex-dream-skin",
    "dream-theme-light",
    "dream-theme-dark",
    "dream-art-wide",
    "dream-art-standard",
    "dream-focus-left",
    "dream-focus-center",
    "dream-focus-right",
    "dream-safe-left",
    "dream-safe-center",
    "dream-safe-right",
    "dream-safe-none",
    "dream-task-ambient",
    "dream-task-banner",
    "dream-task-off",
    "skin-codex-experience",
    "skin-codex-control-feedback-quiet",
    "skin-codex-control-feedback-responsive",
    "skin-codex-control-feedback-expressive",
  ];
  const ROOT_PROPERTIES = [
    "--dream-art",
    "--dream-art-position",
    "--dream-focus-x",
    "--dream-focus-y",
    "--dream-accent",
    "--dream-accent-ink",
    "--dream-image-luma",
  ];
  const HOME_UTILITY_CLASS = "dream-home-utility";
  const BPLUS_HOME_ID = "skin-codex-bplus-home";
  const BPLUS_TASK_ID = "skin-codex-bplus-task";
  const THEME_CHROME_ID = "skin-codex-theme-chrome";
  const THEME_STICKER_ID = "skin-codex-theme-sticker";
  const COMPONENT_CLASSES = [
    "skin-codex-shell", "skin-codex-sidebar", "skin-codex-sidebar-item",
    "skin-codex-sidebar-item-active", "skin-codex-route", "skin-codex-home",
    "skin-codex-chat", "skin-codex-home-cards", "skin-codex-home-card",
    "skin-codex-composer", "skin-codex-message", "skin-codex-message-user",
    "skin-codex-message-assistant", "skin-codex-message-content", "skin-codex-code-block", "skin-codex-inline-code", "skin-codex-dialog",
    "skin-codex-menu", "skin-codex-header", "skin-codex-thread", "skin-codex-turn",
    "skin-codex-tool-card", "skin-codex-diff-card", "skin-codex-send-button",
    "skin-codex-composer-action", "skin-codex-attachment-button",
    "skin-codex-access-selector", "skin-codex-model-selector",
    "skin-codex-header-button", "skin-codex-settings-button",
    "skin-codex-quote", "skin-codex-table", "skin-codex-callout",
    "skin-codex-command-output", "skin-codex-tool-result", "skin-codex-file-reference",
    "skin-codex-control",
    "skin-codex-surface-plain", "skin-codex-surface-soft", "skin-codex-surface-raised",
    "skin-codex-density-compact", "skin-codex-density-comfortable", "skin-codex-density-spacious",
    "skin-codex-theme-chrome", "skin-codex-theme-chrome-copy", "skin-codex-theme-chrome-icon",
    "skin-codex-theme-chrome-title", "skin-codex-theme-chrome-subtitle", "skin-codex-theme-chrome-badge",
    "skin-codex-sidebar-icon", "skin-codex-theme-sticker", "skin-codex-theme-sticker-image",
    "skin-codex-theme-sticker-caption",
  ];
  const installToken = {};
  let samplingNativeShell = false;
  let observer = null;
  window.__CODEX_DREAM_SKIN_DISABLED__ = false;

  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, Number(value)));
  const luminance = (red, green, blue) => {
    const linear = [red, green, blue].map((value) => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    });
    return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
  };
  const defaultProfile = {
    appearance: "dark",
    accent: [108, 131, 142],
    focusX: .5,
    focusY: .5,
    aspect: 1.6,
    luma: .32,
    safeArea: "center",
  };

  const normalizeConfig = (value) => {
    const config = value && typeof value === "object" ? value : {};
    const art = config.art && typeof config.art === "object" ? config.art : {};
    const hasNumber = (candidate) =>
      (typeof candidate === "number" || (typeof candidate === "string" && candidate.trim() !== "")) &&
      Number.isFinite(Number(candidate));
    const requestedAccent = typeof config?.palette?.accent === "string"
      ? config.palette.accent.trim()
      : "";
    const safeAccent = /^(?:#[\da-f]{3,8}|(?:rgb|hsl|oklch|oklab)\([^;{}]{1,96}\))$/i.test(requestedAccent)
      ? requestedAccent
      : null;
    const appearance = ["auto", "light", "dark"].includes(config.appearance)
      ? config.appearance
      : "auto";
    const safeArea = ["auto", "left", "right", "center", "none"].includes(art.safeArea)
      ? art.safeArea
      : "auto";
    const taskMode = ["auto", "ambient", "banner", "off"].includes(art.taskMode)
      ? art.taskMode
      : "auto";
    const metadataRatio = Number(config?.artMetadata?.ratio);
    return {
      appearance,
      safeArea,
      taskMode,
      focusX: hasNumber(art.focusX) ? clamp(art.focusX) : null,
      focusY: hasNumber(art.focusY) ? clamp(art.focusY) : null,
      accent: safeAccent,
      initialAspect: Number.isFinite(metadataRatio) && metadataRatio > 0 ? metadataRatio : null,
    };
  };

  const normalizeExperience = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== 1) return null;
    const rawContent = value.content;
    if (!rawContent || typeof rawContent !== "object" || Array.isArray(rawContent)) return null;
    const allowedContent = new Set([
      "codeBlock", "inlineCode", "quote", "table", "callout", "commandOutput", "toolResult", "fileReference",
    ]);
    const allowedSurface = new Set(["plain", "soft", "raised"]);
    const allowedDensity = new Set(["compact", "comfortable", "spacious"]);
    const content = {};
    for (const [key, entry] of Object.entries(rawContent)) {
      if (!allowedContent.has(key) || !entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const normalized = {};
      if (allowedSurface.has(entry.surface)) normalized.surface = entry.surface;
      if (allowedDensity.has(entry.density)) normalized.density = entry.density;
      if (normalized.surface || normalized.density) content[key] = normalized;
    }
    const feedback = ["quiet", "responsive", "expressive"].includes(value?.controls?.feedback)
      ? value.controls.feedback
      : "responsive";
    return { content, feedback };
  };

  const previous = window[STATE_KEY];
  if (previous?.observer) previous.observer.disconnect();
  if (previous?.timer) clearInterval(previous.timer);
  if (previous?.scheduler?.timeout) clearTimeout(previous.scheduler.timeout);
  if (previous?.artUrl) URL.revokeObjectURL(previous.artUrl);
  const artUrl = (() => {
    const comma = artDataUrl.indexOf(",");
    const binary = atob(artDataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const mime = /^data:([^;,]+)/.exec(artDataUrl)?.[1] || "image/png";
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  })();
  const config = normalizeConfig(rawConfig);
  const experience = normalizeExperience(experienceConfig);
  let profile = {
    ...defaultProfile,
    aspect: config.initialAspect ?? defaultProfile.aspect,
  };
  const existingStyle = document.getElementById(STYLE_ID);
  if (existingStyle) {
    existingStyle.textContent = cssText;
    existingStyle.dataset.dreamVersion = "3";
  }

  const analyzeArt = () => new Promise((resolve) => {
    if (typeof Image !== "function") {
      resolve(defaultProfile);
      return;
    }
    const image = new Image();
    image.onload = () => {
      try {
        const width = 48;
        const height = Math.max(12, Math.round(width * image.naturalHeight / image.naturalWidth));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext?.("2d", { willReadFrequently: true });
        if (!context) throw new Error("Canvas is unavailable");
        context.drawImage(image, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height).data;
        let count = 0;
        let totalRed = 0;
        let totalGreen = 0;
        let totalBlue = 0;
        let totalBrightness = 0;
        const samples = [];
        const sampleMap = new Array(width * height);
        for (let offset = 0; offset < pixels.length; offset += 4) {
          if (pixels[offset + 3] < 96) continue;
          const red = pixels[offset];
          const green = pixels[offset + 1];
          const blue = pixels[offset + 2];
          const light = (.2126 * red + .7152 * green + .0722 * blue) / 255;
          const sample = { red, green, blue, light, index: offset / 4 };
          samples.push(sample);
          sampleMap[sample.index] = sample;
          totalRed += red;
          totalGreen += green;
          totalBlue += blue;
          totalBrightness += light;
          count += 1;
        }
        if (!count) throw new Error("Image contains no opaque pixels");
        const average = [totalRed / count, totalGreen / count, totalBlue / count];
        const averageBrightness = totalBrightness / count;
        const information = (start, end) => {
          let total = 0;
          let totalSquared = 0;
          let edges = 0;
          let edgeCount = 0;
          let sampleCount = 0;
          for (let y = 0; y < height; y += 1) {
            for (let x = start; x < end; x += 1) {
              const sample = sampleMap[y * width + x];
              if (!sample) continue;
              total += sample.light;
              totalSquared += sample.light * sample.light;
              sampleCount += 1;
              const previousSample = x > start ? sampleMap[y * width + x - 1] : null;
              const above = y > 0 ? sampleMap[(y - 1) * width + x] : null;
              if (previousSample) { edges += Math.abs(sample.light - previousSample.light); edgeCount += 1; }
              if (above) { edges += Math.abs(sample.light - above.light); edgeCount += 1; }
            }
          }
          const mean = sampleCount ? total / sampleCount : 0;
          const variance = sampleCount ? Math.max(0, totalSquared / sampleCount - mean * mean) : 1;
          return Math.sqrt(variance) * .58 + (edgeCount ? edges / edgeCount : 1) * .42;
        };
        const zoneWidth = Math.max(1, Math.floor(width * .38));
        const leftInformation = information(0, zoneWidth);
        const rightInformation = information(width - zoneWidth, width);
        let safeArea = "center";
        if (leftInformation < rightInformation * .86) safeArea = "left";
        else if (rightInformation < leftInformation * .86) safeArea = "right";
        let focusWeight = 0;
        let focusX = 0;
        let focusY = 0;
        let accentWeight = 0;
        let accent = [0, 0, 0];
        for (const sample of samples) {
          const x = sample.index % width;
          const y = Math.floor(sample.index / width);
          const difference = Math.sqrt(
            (sample.red - average[0]) ** 2 +
            (sample.green - average[1]) ** 2 +
            (sample.blue - average[2]) ** 2,
          ) / 441.7;
          const saliency = .03 + difference ** 1.35;
          focusX += (x / Math.max(1, width - 1)) * saliency;
          focusY += (y / Math.max(1, height - 1)) * saliency;
          focusWeight += saliency;
          const max = Math.max(sample.red, sample.green, sample.blue);
          const min = Math.min(sample.red, sample.green, sample.blue);
          const saturation = max ? (max - min) / max : 0;
          const usableLight = 1 - Math.min(1, Math.abs(sample.light - .46) / .54);
          const weight = saturation ** 2 * (.15 + usableLight);
          accent[0] += sample.red * weight;
          accent[1] += sample.green * weight;
          accent[2] += sample.blue * weight;
          accentWeight += weight;
        }
        const resolvedAccent = accentWeight > 1
          ? accent.map((channel) => Math.round(channel / accentWeight))
          : average.map((channel) => Math.round(channel));
        let resolvedFocusX = clamp(focusX / focusWeight);
        if (safeArea === "left") resolvedFocusX = Math.max(.64, resolvedFocusX);
        if (safeArea === "right") resolvedFocusX = Math.min(.36, resolvedFocusX);
        resolve({
          appearance: averageBrightness >= .58 ? "light" : "dark",
          accent: resolvedAccent,
          focusX: resolvedFocusX,
          focusY: clamp(focusY / focusWeight),
          aspect: image.naturalWidth / Math.max(1, image.naturalHeight),
          luma: clamp(averageBrightness),
          safeArea,
        });
      } catch {
        resolve(defaultProfile);
      }
    };
    image.onerror = () => resolve(defaultProfile);
    image.src = artUrl;
  });

  const detectShellAppearance = () => {
    const root = document.documentElement;
    const body = document.body;
    const classes = `${root?.className || ""} ${body?.className || ""}`
      .toLowerCase()
      .replace(/\bdream-theme-(?:dark|light)\b/g, "");
    if (/\b(dark|electron-dark|theme-dark|appearance-dark)\b/.test(classes)) return "dark";
    if (/\b(light|electron-light|theme-light|appearance-light)\b/.test(classes)) return "light";

    const dataTheme = (
      root?.getAttribute?.("data-theme") ||
      root?.getAttribute?.("data-appearance") ||
      root?.getAttribute?.("data-color-mode") ||
      body?.getAttribute?.("data-theme") ||
      body?.getAttribute?.("data-appearance") ||
      ""
    ).toLowerCase();
    if (dataTheme.includes("dark")) return "dark";
    if (dataTheme.includes("light")) return "light";

    try {
      const hadSkin = root?.classList?.contains?.("codex-dream-skin");
      const savedSkinClasses = hadSkin
        ? ROOT_CLASSES.filter((className) => root.classList.contains(className))
        : [];
      samplingNativeShell = true;
      if (hadSkin) root.classList.remove(...ROOT_CLASSES);
      try {
        const colorScheme = getComputedStyle(root).colorScheme || "";
        if (colorScheme.includes("dark") && !colorScheme.includes("light")) return "dark";
        if (colorScheme.includes("light") && !colorScheme.includes("dark")) return "light";
      } finally {
        if (hadSkin) root.classList.add(...savedSkinClasses);
        observer?.takeRecords?.();
        samplingNativeShell = false;
      }
    } catch {
      samplingNativeShell = false;
    }
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch {}
    return "light";
  };

  const clearSkinDom = () => {
    const root = document.documentElement;
    root?.classList.remove(...ROOT_CLASSES);
    for (const property of ROOT_PROPERTIES) root?.style.removeProperty(property);
    document.querySelectorAll(".dream-home").forEach((node) => node.classList.remove("dream-home"));
    document.querySelectorAll(".dream-task").forEach((node) => node.classList.remove("dream-task"));
    document.querySelectorAll(".dream-home-shell").forEach((node) => node.classList.remove("dream-home-shell"));
    document.querySelectorAll(`.${HOME_UTILITY_CLASS}`).forEach((node) => node.classList.remove(HOME_UTILITY_CLASS));
    for (const className of COMPONENT_CLASSES) {
      document.querySelectorAll(`.${className}`).forEach((node) => node.classList.remove(className));
    }
    document.getElementById(BPLUS_HOME_ID)?.remove();
    document.getElementById(BPLUS_TASK_ID)?.remove();
    document.getElementById(THEME_CHROME_ID)?.remove();
    document.getElementById(THEME_STICKER_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(CHROME_ID)?.remove();
  };

  const syncClass = (className, candidates) => {
    const next = new Set([...candidates].filter(Boolean));
    for (const node of document.querySelectorAll(`.${className}`)) {
      if (!next.has(node)) node.classList.remove(className);
    }
    for (const node of next) node.classList.add(className);
  };

  const syncExperienceVariants = (key, candidates) => {
    const entry = experience?.content?.[key] ?? null;
    const nodes = [...candidates].filter(Boolean);
    for (const node of nodes) {
      node.classList.remove(
        "skin-codex-surface-plain", "skin-codex-surface-soft", "skin-codex-surface-raised",
        "skin-codex-density-compact", "skin-codex-density-comfortable", "skin-codex-density-spacious",
      );
      if (entry?.surface) node.classList.add(`skin-codex-surface-${entry.surface}`);
      if (entry?.density) node.classList.add(`skin-codex-density-${entry.density}`);
    }
  };

  const mapComponents = (shellMain, home, routes) => {
    document.querySelectorAll([
      ".skin-codex-code-block", ".skin-codex-inline-code", ".skin-codex-quote", ".skin-codex-table",
      ".skin-codex-callout", ".skin-codex-command-output", ".skin-codex-tool-result", ".skin-codex-file-reference",
    ].join(", ")).forEach((node) => node.classList.remove(
      "skin-codex-surface-plain", "skin-codex-surface-soft", "skin-codex-surface-raised",
      "skin-codex-density-compact", "skin-codex-density-comfortable", "skin-codex-density-spacious",
    ));
    const sidebar = document.querySelector(".app-shell-left-panel");
    syncClass("skin-codex-shell", [shellMain]);
    syncClass("skin-codex-sidebar", [sidebar]);
    const activeSidebarItems = sidebar?.querySelectorAll?.(
      '[aria-current="page"], [aria-selected="true"], [data-state="active"], [data-state="selected"]',
    ) ?? [];
    const activeSidebarSet = new Set(activeSidebarItems);
    const sidebarItems = [...(sidebar?.querySelectorAll?.('button, a, [role="button"]') ?? [])]
      .filter((node) => activeSidebarSet.has(node) || (node.innerText || node.textContent || "").trim());
    syncClass("skin-codex-sidebar-item", sidebarItems);
    syncClass("skin-codex-sidebar-item-active", activeSidebarItems);

    syncClass("skin-codex-route", routes);
    syncClass("skin-codex-home", home ? [home] : []);
    syncClass("skin-codex-chat", [...routes].filter((route) => route !== home));
    const composers = [...document.querySelectorAll(".composer-surface-chrome")];
    syncClass("skin-codex-composer", composers);
    const headers = [...document.querySelectorAll("header.app-header-tint")];
    syncClass("skin-codex-header", headers);
    syncClass("skin-codex-header-button", headers.flatMap(
      (header) => [...(header.querySelectorAll?.("button") ?? [])],
    ));
    syncClass("skin-codex-thread", document.querySelectorAll(".thread-scroll-container"));

    const semanticMessages = [...document.querySelectorAll("[data-message-author-role]")];
    const modernUsers = [...document.querySelectorAll('[data-content-search-unit-key$=":user"]')];
    const modernAssistants = [...document.querySelectorAll('[data-content-search-unit-key$=":assistant"]')];
    const turns = [...document.querySelectorAll("[data-turn-key]")];
    const conversation = document.querySelector('[data-thread-find-target="conversation"]');
    const messages = [...new Set([
      ...semanticMessages,
      ...modernUsers,
      ...modernAssistants,
      ...(semanticMessages.length || modernUsers.length || modernAssistants.length
        ? []
        : (conversation ? [...conversation.children] : [])),
    ])];
    syncClass("skin-codex-turn", turns);
    syncClass("skin-codex-message", messages);
    syncClass("skin-codex-message-content", messages.flatMap((node) =>
      [...(node.querySelectorAll?.('[data-selected-text-overlay-target]') ?? [])],
    ));
    syncClass("skin-codex-message-user", [...semanticMessages.filter(
      (node) => node.getAttribute?.("data-message-author-role") === "user",
    ), ...modernUsers]);
    syncClass("skin-codex-message-assistant", [...semanticMessages.filter(
      (node) => node.getAttribute?.("data-message-author-role") === "assistant",
    ), ...modernAssistants]);
    syncClass("skin-codex-code-block", document.querySelectorAll("pre"));
    syncClass("skin-codex-inline-code", document.querySelectorAll("code:not(pre code)"));
    const quotes = [...document.querySelectorAll("blockquote")];
    const tables = [...document.querySelectorAll("table")];
    const callouts = [...document.querySelectorAll('[role="note"], [role="alert"], [data-testid="callout"]')];
    const commandOutput = [...document.querySelectorAll('[data-testid="exec-shell-body"] pre, [data-testid="command-output"]')];
    const toolResults = [...document.querySelectorAll('[data-testid="exec-shell-body"], [data-testid="tool-result"]')];
    const fileReferences = [...document.querySelectorAll(
      '[data-testid="file-reference"], [data-testid="attachment"], [data-testid="file-attachment"], [data-file-path]',
    )];
    syncClass("skin-codex-quote", quotes);
    syncClass("skin-codex-table", tables);
    syncClass("skin-codex-callout", callouts);
    syncClass("skin-codex-command-output", commandOutput);
    syncClass("skin-codex-tool-result", toolResults);
    syncClass("skin-codex-file-reference", fileReferences);
    syncExperienceVariants("codeBlock", document.querySelectorAll("pre"));
    syncExperienceVariants("inlineCode", document.querySelectorAll("code:not(pre code)"));
    syncExperienceVariants("quote", quotes);
    syncExperienceVariants("table", tables);
    syncExperienceVariants("callout", callouts);
    syncExperienceVariants("commandOutput", commandOutput);
    syncExperienceVariants("toolResult", toolResults);
    syncExperienceVariants("fileReference", fileReferences);
    syncClass("skin-codex-dialog", document.querySelectorAll('[role="dialog"]'));
    syncClass("skin-codex-menu", document.querySelectorAll('[role="menu"]'));
    syncClass("skin-codex-tool-card", document.querySelectorAll('[data-testid="exec-shell-body"]'));
    const diffCards = [...document.querySelectorAll(".group\\/turn-diff-header")]
      .map((node) => node.parentElement || node);
    syncClass("skin-codex-diff-card", diffCards);
    const composerButtons = composers.flatMap((composer) =>
      [...(composer.querySelectorAll?.("button") ?? [])]
        .filter((button) => button.getClientRects?.().length !== 0));
    syncClass("skin-codex-composer-action", composerButtons);
    const buttonLabel = (button) => [
      button.getAttribute?.("aria-label"),
      button.getAttribute?.("title"),
      button.innerText,
      button.textContent,
    ].filter(Boolean).join(" ").trim();
    const sendButtons = composers.map((composer) => {
      const buttons = [...(composer.querySelectorAll?.("button") ?? [])]
        .filter((button) => button.getClientRects?.().length !== 0);
      return buttons.find((button) => /(?:发送|停止|send|stop)/i.test(buttonLabel(button)))
        ?? buttons.at(-1)
        ?? null;
    });
    syncClass("skin-codex-send-button", sendButtons);
    const attachmentButtons = composerButtons.filter(
      (button) => /(?:添加文件|附件|attach|add file)/i.test(buttonLabel(button)),
    );
    syncClass("skin-codex-attachment-button", attachmentButtons);
    const selectorCandidates = composerButtons.filter((button) =>
      !sendButtons.includes(button) && !attachmentButtons.includes(button));
    const modelSelectors = composers.map((composer) => {
      const candidates = selectorCandidates.filter((button) => composer.contains?.(button) !== false);
      return candidates.at(-1) ?? null;
    });
    syncClass("skin-codex-model-selector", modelSelectors);
    const accessSelectors = composers.map((composer) => {
      const candidates = selectorCandidates.filter(
        (button) => composer.contains?.(button) !== false && !modelSelectors.includes(button),
      );
      return candidates.at(-1) ?? null;
    });
    syncClass("skin-codex-access-selector", accessSelectors);
    const settingsButtons = [...document.querySelectorAll("button")].filter(
      (button) => /(?:设置|settings|preferences)/i.test(buttonLabel(button)),
    );
    syncClass("skin-codex-settings-button", settingsButtons);

    const cardContainer = home?.querySelector?.(".group\\/home-suggestions") ?? null;
    syncClass("skin-codex-home-cards", cardContainer ? [cardContainer] : []);
    syncClass("skin-codex-home-card", cardContainer?.querySelectorAll?.("button") ?? []);
    const controls = experience ? [...new Set([
      ...sidebarItems, ...headers.flatMap((header) => [...(header.querySelectorAll?.("button") ?? [])]),
      ...composerButtons, ...settingsButtons,
      ...(cardContainer?.querySelectorAll?.("button") ?? []),
    ])] : [];
    syncClass("skin-codex-control", controls);
  };

  const addText = (parent, tagName, className, text) => {
    if (!text) return null;
    const node = document.createElement(tagName);
    node.classList.add(className);
    node.textContent = text;
    parent.appendChild(node);
    return node;
  };

  const renderThemeChrome = (chromeHost, routeName) => {
    const chromeConfig = componentsConfig?.schemaVersion === 1 ? componentsConfig.chrome : null;
    const existing = document.getElementById(THEME_CHROME_ID);
    if (!chromeHost || !chromeConfig || chromeConfig.route !== routeName) { existing?.remove(); return; }
    const revision = componentsConfig?.revision || [chromeConfig.route, chromeConfig.title, chromeConfig.subtitle, chromeConfig.badge, chromeConfig.icon].join("|");
    if (existing?.parentElement === chromeHost && existing.dataset.skinRevision === revision) return;
    existing?.remove();
    const container = document.createElement("section");
    container.id = THEME_CHROME_ID;
    container.classList.add("skin-codex-theme-chrome");
    container.dataset.skinRevision = revision;
    if (chromeConfig.icon) {
      const icon = document.createElement("img");
      icon.classList.add("skin-codex-theme-chrome-icon");
      icon.src = chromeConfig.icon;
      icon.alt = "";
      container.appendChild(icon);
    }
    const copy = document.createElement("div");
    copy.classList.add("skin-codex-theme-chrome-copy");
    addText(copy, "strong", "skin-codex-theme-chrome-title", chromeConfig.title);
    addText(copy, "span", "skin-codex-theme-chrome-subtitle", chromeConfig.subtitle);
    container.appendChild(copy);
    addText(container, "span", "skin-codex-theme-chrome-badge", chromeConfig.badge);
    chromeHost.appendChild(container);
  };

  const renderSidebarDecorations = (sidebar) => {
    const sidebarConfig = componentsConfig?.schemaVersion === 1 ? componentsConfig.sidebar : null;
    const items = [...(sidebar?.querySelectorAll?.('button, a, [role="button"]') ?? [])];
    for (const item of items) item.querySelector?.(`.${"skin-codex-sidebar-icon"}`)?.remove?.();
    if (!sidebarConfig) return;
    for (const item of items) {
      const title = (item.innerText || item.textContent || "").trim();
      const matched = (sidebarConfig.matches ?? []).find((entry) => entry.title === title);
      const iconUrl = matched?.icon || (/^(?:新建任务|new task)$/i.test(title) ? sidebarConfig.newTaskIcon : sidebarConfig.defaultIcon);
      if (!iconUrl) continue;
      const icon = document.createElement("img");
      icon.classList.add("skin-codex-sidebar-icon");
      icon.src = iconUrl;
      icon.alt = "";
      icon.setAttribute("aria-hidden", "true");
      item.prepend?.(icon);
    }
  };

  const renderThemeSticker = (route, routeName) => {
    const stickerConfig = componentsConfig?.schemaVersion === 1 ? componentsConfig.sticker : null;
    const existing = document.getElementById(THEME_STICKER_ID);
    if (!route || !stickerConfig || stickerConfig.route !== routeName) { existing?.remove(); return; }
    const revision = componentsConfig?.revision || [stickerConfig.route, stickerConfig.anchor, stickerConfig.size, stickerConfig.caption, stickerConfig.image].join("|");
    if (existing?.parentElement === route && existing.dataset.skinRevision === revision) return;
    existing?.remove();
    const container = document.createElement("aside");
    container.id = THEME_STICKER_ID;
    container.classList.add("skin-codex-theme-sticker", `skin-codex-theme-sticker-${routeName}`, `skin-codex-theme-sticker-${stickerConfig.anchor}`, `skin-codex-theme-sticker-${stickerConfig.size}`);
    container.dataset.skinRevision = revision;
    const image = document.createElement("img");
    image.classList.add("skin-codex-theme-sticker-image");
    image.src = stickerConfig.image;
    image.alt = "";
    container.appendChild(image);
    addText(container, "span", "skin-codex-theme-sticker-caption", stickerConfig.caption);
    route.appendChild(container);
  };

  const runComponentAction = (action, nativeCards) => {
    if (!action || typeof action !== "object") return;
    const composer = document.querySelector(".composer-surface-chrome");
    if (action.type === "focus-composer") {
      composer?.querySelector?.('[contenteditable="true"], textarea')?.focus?.();
      return;
    }
    if (action.type === "insert-prompt") {
      const editor = composer?.querySelector?.('[contenteditable="true"], textarea');
      if (!editor) return;
      editor.focus?.();
      if (editor.isContentEditable) editor.textContent = action.value || "";
      else editor.value = action.value || "";
      try { editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: action.value || "" })); } catch {}
      return;
    }
    if (action.type === "native-suggestion") nativeCards[action.index]?.click?.();
  };

  const renderBPlusHome = (home) => {
    const configHome = componentsConfig?.schemaVersion === 1 ? componentsConfig.home : null;
    const existing = document.getElementById(BPLUS_HOME_ID);
    if (!home || !configHome) {
      existing?.remove();
      return;
    }
    const revision = componentsConfig?.revision || [
      configHome.title,
      configHome.status,
      ...(configHome.cards ?? []).map((card) => card.title),
    ].join("|");
    if (existing?.parentElement === home && existing.dataset.skinRevision === revision) return;
    existing?.remove();

    const nativeContainer = home.querySelector?.(".group\\/home-suggestions") ?? null;
    const nativeCards = [...(nativeContainer?.querySelectorAll?.("button") ?? [])];
    const container = document.createElement("section");
    container.id = BPLUS_HOME_ID;
    container.classList.add("skin-codex-bplus");
    container.dataset.skinRevision = revision;

    const hero = document.createElement("div");
    hero.classList.add("skin-codex-bplus-hero");
    if (configHome.heroImage) hero.style.backgroundImage = `url("${configHome.heroImage}")`;
    const copy = document.createElement("div");
    copy.classList.add("skin-codex-bplus-hero-copy");
    addText(copy, "p", "skin-codex-bplus-eyebrow", configHome.eyebrow);
    addText(copy, "h1", "skin-codex-bplus-title", configHome.title);
    addText(copy, "p", "skin-codex-bplus-subtitle", configHome.subtitle);
    hero.appendChild(copy);
    addText(hero, "span", "skin-codex-bplus-status", configHome.status);
    container.appendChild(hero);

    const cards = document.createElement("div");
    cards.classList.add("skin-codex-bplus-action-grid");
    for (const [index, cardConfig] of (configHome.cards ?? []).entries()) {
      const card = document.createElement("button");
      card.type = "button";
      card.classList.add("skin-codex-bplus-action-card", `skin-codex-bplus-action-card-${index + 1}`);
      if (cardConfig.icon) {
        const icon = document.createElement("img");
        icon.classList.add("skin-codex-bplus-card-icon");
        icon.src = cardConfig.icon;
        icon.alt = "";
        card.appendChild(icon);
      }
      const cardCopy = document.createElement("span");
      cardCopy.classList.add("skin-codex-bplus-card-copy");
      addText(cardCopy, "strong", "skin-codex-bplus-card-title", cardConfig.title);
      addText(cardCopy, "span", "skin-codex-bplus-card-description", cardConfig.description);
      card.appendChild(cardCopy);
      card.addEventListener("click", () => runComponentAction(cardConfig.action, nativeCards));
      cards.appendChild(card);
    }
    container.appendChild(cards);

    if (configHome.note) {
      const note = document.createElement("aside");
      note.classList.add("skin-codex-bplus-note");
      addText(note, "strong", "skin-codex-bplus-note-title", configHome.note.title);
      for (const line of configHome.note.lines ?? []) addText(note, "span", "skin-codex-bplus-note-line", line);
      container.appendChild(note);
    }
    home.prepend(container);
  };

  const renderBPlusTask = (taskRoute) => {
    const configTask = componentsConfig?.schemaVersion === 1 ? componentsConfig.task : null;
    const existing = document.getElementById(BPLUS_TASK_ID);
    if (!taskRoute || !configTask) {
      existing?.remove();
      return;
    }
    const revision = componentsConfig?.revision || [
      configTask.eyebrow,
      configTask.title,
      configTask.subtitle,
      configTask.status,
    ].join("|");
    if (existing?.parentElement === taskRoute && existing.dataset.skinRevision === revision) return;
    existing?.remove();

    const container = document.createElement("section");
    container.id = BPLUS_TASK_ID;
    container.classList.add("skin-codex-bplus-task");
    container.dataset.skinRevision = revision;
    if (configTask.heroImage) container.style.backgroundImage = `url("${configTask.heroImage}")`;
    const copy = document.createElement("div");
    copy.classList.add("skin-codex-bplus-task-copy");
    addText(copy, "span", "skin-codex-bplus-task-eyebrow", configTask.eyebrow);
    addText(copy, "strong", "skin-codex-bplus-task-title", configTask.title);
    addText(copy, "span", "skin-codex-bplus-task-subtitle", configTask.subtitle);
    container.appendChild(copy);
    addText(container, "span", "skin-codex-bplus-task-status", configTask.status);
    taskRoute.prepend(container);
  };

  const applyProfile = (root) => {
    const focusX = config.focusX ?? profile.focusX;
    const focusY = config.focusY ?? profile.focusY;
    const appearance = config.appearance === "auto" ? detectShellAppearance() : config.appearance;
    const focus = focusX < .4 ? "left" : focusX > .6 ? "right" : "center";
    const safeArea = config.safeArea === "auto" ? (profile.safeArea ||
      (focus === "left" ? "right" : focus === "right" ? "left" : "center")) : config.safeArea;
    const taskMode = config.taskMode === "auto"
      ? profile.aspect >= 2.25 ? "banner" : "ambient"
      : config.taskMode;
    const accent = config.accent || `rgb(${profile.accent.join(" ")})`;
    const accentInk = luminance(...profile.accent) > .42 ? "rgb(26 24 28)" : "rgb(250 248 251)";
    root.classList.toggle("dream-theme-light", appearance === "light");
    root.classList.toggle("dream-theme-dark", appearance === "dark");
    root.classList.toggle("dream-art-wide", profile.aspect >= 1.75);
    root.classList.toggle("dream-art-standard", profile.aspect < 1.75);
    for (const value of ["left", "center", "right"]) {
      root.classList.toggle(`dream-focus-${value}`, focus === value);
    }
    for (const value of ["left", "center", "right", "none"]) {
      root.classList.toggle(`dream-safe-${value}`, safeArea === value);
    }
    for (const value of ["ambient", "banner", "off"]) {
      root.classList.toggle(`dream-task-${value}`, taskMode === value);
    }
    root.style.setProperty("--dream-art", `url("${artUrl}")`);
    root.style.setProperty("--dream-art-position", `${Math.round(focusX * 100)}% ${Math.round(focusY * 100)}%`);
    root.style.setProperty("--dream-focus-x", String(focusX));
    root.style.setProperty("--dream-focus-y", String(focusY));
    root.style.setProperty("--dream-accent", accent);
    root.style.setProperty("--dream-accent-ink", accentInk);
    root.style.setProperty("--dream-image-luma", profile.luma.toFixed(3));
  };

  const ensure = () => {
    if (window.__CODEX_DREAM_SKIN_DISABLED__) return;
    const root = document.documentElement;
    if (!root || !document.body) return;

    const shellMain = document.querySelector("main.main-surface");
    const codexMarker = document.querySelector(
      ".app-shell-left-panel, .composer-surface-chrome, [role='main'], .app-shell-main-content-frame, .app-shell-main-content-top-fade, [data-tab-id]",
    );
    if (!shellMain || !codexMarker) {
      clearSkinDom();
      return;
    }

    root.classList.add("codex-dream-skin");
    applyProfile(root);
    root.classList.toggle("skin-codex-experience", Boolean(experience));
    root.classList.toggle("skin-codex-control-feedback-quiet", experience?.feedback === "quiet");
    root.classList.toggle("skin-codex-control-feedback-responsive", experience?.feedback === "responsive");
    root.classList.toggle("skin-codex-control-feedback-expressive", experience?.feedback === "expressive");

    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || root).appendChild(style);
    }
    if (style.dataset.dreamVersion !== "3") {
      style.textContent = cssText;
      style.dataset.dreamVersion = "3";
    }

    const home = document.querySelector('[role="main"]:has([data-testid="home-icon"])');
    const semanticRoutes = [...document.querySelectorAll('[role="main"]')];
    const fallbackRoute = semanticRoutes.length ? null : document.querySelector(".app-shell-main-content-frame");
    const routes = fallbackRoute ? [fallbackRoute] : semanticRoutes;
    const taskRoutes = routes.filter((candidate) => candidate !== home);
    syncClass("dream-home", home ? [home] : []);
    syncClass("dream-task", taskRoutes);
    const utilityBars = new Set(home ? home.querySelectorAll('[class*="_homeUtilityBar_"]') : []);
    for (const candidate of document.querySelectorAll(`.${HOME_UTILITY_CLASS}`)) {
      if (!utilityBars.has(candidate)) candidate.classList.remove(HOME_UTILITY_CLASS);
    }
    for (const candidate of utilityBars) candidate.classList.add(HOME_UTILITY_CLASS);
    shellMain.classList.toggle("dream-home-shell", Boolean(home));
    mapComponents(shellMain, home, routes);
    renderSidebarDecorations(document.querySelector(".app-shell-left-panel"));
    renderBPlusHome(home);
    renderBPlusTask(taskRoutes[0] ?? null);

    let chrome = document.getElementById(CHROME_ID);
    if (!chrome || chrome.parentElement !== document.body) {
      chrome?.remove();
      chrome = document.createElement("div");
      chrome.id = CHROME_ID;
      chrome.setAttribute("aria-hidden", "true");
      document.body.appendChild(chrome);
    }
    chrome.classList.toggle("dream-home-shell", Boolean(home));
    renderThemeChrome(chrome, home ? "home" : "chat");
    renderThemeSticker(home ?? taskRoutes[0] ?? null, home ? "home" : "chat");
  };

  const cleanup = () => {
    const state = window[STATE_KEY];
    if (state?.installToken !== installToken) return false;
    window.__CODEX_DREAM_SKIN_DISABLED__ = true;
    clearSkinDom();
    state?.observer?.disconnect();
    if (state?.timer) clearInterval(state.timer);
    if (state?.scheduler?.timeout) clearTimeout(state.scheduler.timeout);
    if (state?.artUrl) URL.revokeObjectURL(state.artUrl);
    delete window[STATE_KEY];
    return true;
  };

  const scheduler = { timeout: null };
  const scheduleEnsure = () => {
    if (scheduler.timeout) clearTimeout(scheduler.timeout);
    scheduler.timeout = setTimeout(() => {
      scheduler.timeout = null;
      ensure();
    }, 180);
  };
  observer = new MutationObserver(() => {
    if (samplingNativeShell) return;
    scheduleEnsure();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "data-theme", "data-appearance", "data-color-mode"],
  });
  const timer = setInterval(ensure, 5000);
  window[STATE_KEY] = {
    ensure, cleanup, observer, timer, scheduler, artUrl, profile, config, experience, installToken, version: "1.4.0",
  };
  ensure();
  analyzeArt().then((result) => {
    const state = window[STATE_KEY];
    if (state?.installToken !== installToken || window.__CODEX_DREAM_SKIN_DISABLED__) return;
    profile = result;
    state.profile = result;
    ensure();
  });
  return { installed: true, version: "1.4.0", adaptive: true, experience: Boolean(experience) };
})(__DREAM_CSS_JSON__, __DREAM_ART_JSON__, __DREAM_THEME_JSON__, __DREAM_COMPONENTS_JSON__, __DREAM_EXPERIENCE_JSON__)
