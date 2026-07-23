import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readImageMetadata } from "./image-metadata.mjs";

const scriptPath = typeof __filename === "string" ? __filename : fileURLToPath(import.meta.url);
const here = path.dirname(scriptPath);
const root = path.resolve(here, "..");
const SKIN_VERSION = "1.4.0";
const MAX_ART_BYTES = 16 * 1024 * 1024;
const MAX_THEME_CSS_BYTES = 512 * 1024;
const MAX_THEME_COMPONENTS_BYTES = 64 * 1024;
const MAX_THEME_EXPERIENCE_BYTES = 12 * 1024;
const MAX_THEME_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_THEME_ASSETS_BYTES = 24 * 1024 * 1024;
const STRONG_THEME_AUDIT_MS = 30000;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const BROWSER_ID_PATTERN = /^[A-Za-z0-9._-]{1,200}$/;
const THEME_ASSET_MIME_TYPES = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);
const CSS_URL_PATTERN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")]*))\s*\)/gi;
const EXPERIENCE_CONTENT_KEYS = new Set([
  "codeBlock", "inlineCode", "quote", "table", "callout", "commandOutput", "toolResult", "fileReference",
]);
const EXPERIENCE_ENTRY_KEYS = new Set(["surface", "density"]);
const EXPERIENCE_ROOT_KEYS = new Set(["schemaVersion", "content", "controls"]);
const EXPERIENCE_CONTROL_KEYS = new Set(["feedback"]);
const EXPERIENCE_SURFACES = new Set(["plain", "soft", "raised"]);
const EXPERIENCE_DENSITIES = new Set(["compact", "comfortable", "spacious"]);
const EXPERIENCE_FEEDBACK = new Set(["quiet", "responsive", "expressive"]);

class CdpIdentityMismatchError extends Error {}

function parseArgs(argv) {
  const options = {
    port: 9335,
    mode: "watch",
    timeoutMs: 30000,
    screenshot: null,
    reload: false,
    browserId: null,
    themeDir: path.join(root, "assets"),
    pauseFile: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port") options.port = Number(argv[++i]);
    else if (arg === "--once") options.mode = "once";
    else if (arg === "--watch") options.mode = "watch";
    else if (arg === "--verify") options.mode = "verify";
    else if (arg === "--remove") options.mode = "remove";
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++i]);
    else if (arg === "--browser-id") options.browserId = argv[++i];
    else if (arg === "--theme-dir") options.themeDir = path.resolve(argv[++i]);
    else if (arg === "--pause-file") options.pauseFile = path.resolve(argv[++i]);
    else if (arg === "--screenshot") options.screenshot = path.resolve(argv[++i]);
    else if (arg === "--reload") options.reload = true;
    else if (arg === "--self-test") options.mode = "self-test";
    else if (arg === "--check-payload") options.mode = "check-payload";
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) {
    throw new Error(`Invalid port: ${options.port}`);
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 250 || options.timeoutMs > 120000) {
    throw new Error(`Invalid timeout: ${options.timeoutMs}`);
  }
  if (options.browserId !== null && !BROWSER_ID_PATTERN.test(options.browserId)) {
    throw new Error(`Invalid browser ID: ${options.browserId}`);
  }
  if (["watch", "once", "verify", "remove"].includes(options.mode) && !options.browserId) {
    throw new Error(`--browser-id is required in ${options.mode} mode`);
  }
  return options;
}

function validatedDebuggerUrl(target, port) {
  const url = new URL(target.webSocketDebuggerUrl);
  const pathIsValid = /^\/devtools\/(?:page|browser)\/[A-Za-z0-9._-]{1,200}$/.test(url.pathname);
  if (url.protocol !== "ws:" || !LOOPBACK_HOSTS.has(url.hostname) || Number(url.port) !== port ||
      url.username || url.password || url.search || url.hash || !pathIsValid) {
    throw new Error("Rejected a CDP WebSocket URL outside the allowed loopback endpoint shape");
  }
  return url.href;
}

function browserIdFromVersion(version, port) {
  const url = validatedDebuggerUrl(version, port);
  const parsed = new URL(url);
  const match = parsed.pathname.match(/^\/devtools\/browser\/([A-Za-z0-9._-]{1,200})$/);
  if (!match || parsed.search || parsed.hash || !BROWSER_ID_PATTERN.test(match[1])) {
    throw new Error("Rejected an invalid CDP browser identity URL");
  }
  return match[1];
}

function isValidCdpPageTarget(item, port) {
  if (item?.type !== "page" || !item.url?.startsWith("app://") || typeof item.id !== "string" ||
      !BROWSER_ID_PATTERN.test(item.id) || !item.webSocketDebuggerUrl) return false;
  try {
    const debuggerUrl = new URL(validatedDebuggerUrl(item, port));
    return debuggerUrl.pathname === `/devtools/page/${item.id}`;
  } catch {
    return false;
  }
}

class CdpSession {
  constructor(target, port) {
    this.target = target;
    this.ws = new WebSocket(validatedDebuggerUrl(target, port));
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;
  }

  async open() {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        try { this.ws.close(); } catch {}
        reject(new Error("CDP WebSocket open timed out"));
      }, 5000);
      this.ws.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
      this.ws.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("CDP WebSocket open failed")); }, { once: true });
    });
    this.ws.addEventListener("message", (event) => this.onMessage(event));
    this.ws.addEventListener("error", () => this.close());
    this.ws.addEventListener("close", () => {
      this.closed = true;
      for (const waiter of this.pending.values()) {
        clearTimeout(waiter.timeout);
        waiter.reject(new Error("CDP socket closed"));
      }
      this.pending.clear();
    });
    await this.send("Runtime.enable");
    await this.send("Page.enable");
    return this;
  }

  onMessage(event) {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      this.close();
      return;
    }
    if (message.id) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      clearTimeout(waiter.timeout);
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`${message.error.message} (${message.error.code})`));
      else waiter.resolve(message.result);
      return;
    }
    for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {});
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error("CDP session is closed"));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 10000);
      this.pending.set(id, { resolve, reject, timeout });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: false,
    });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
      throw new Error(`Renderer evaluation failed: ${detail}`);
    }
    return result.result?.value;
  }

  close() {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error("CDP session closed"));
    }
    this.pending.clear();
    if (!this.closed) {
      try { this.ws.close(); } catch {}
    }
    this.closed = true;
  }
}

class BrowserIdentityAnchor {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.closed = false;
    this.ws.addEventListener("close", () => { this.closed = true; });
    this.ws.addEventListener("error", () => {
      this.closed = true;
      try { this.ws.close(); } catch {}
    });
  }

  async open() {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.close();
        reject(new Error("CDP browser identity WebSocket open timed out"));
      }, 5000);
      this.ws.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
      this.ws.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("CDP browser identity WebSocket open failed"));
      }, { once: true });
      this.ws.addEventListener("close", () => {
        clearTimeout(timeout);
        reject(new Error("CDP browser identity WebSocket closed during startup"));
      }, { once: true });
    });
    if (this.closed) throw new Error("CDP browser identity WebSocket is already closed");
    return this;
  }

  close() {
    if (!this.closed) {
      try { this.ws.close(); } catch {}
    }
    this.closed = true;
  }
}

async function fetchCdpJson(port, resource) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}${resource}`, {
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function listAppTargets(port, expectedBrowserId = null) {
  const targets = await fetchCdpJson(port, "/json/list");
  if (!Array.isArray(targets)) throw new Error("CDP target list is not an array");
  if (expectedBrowserId) {
    const version = await fetchCdpJson(port, "/json/version");
    const actualBrowserId = browserIdFromVersion(version, port);
    if (actualBrowserId !== expectedBrowserId) {
      throw new CdpIdentityMismatchError(
        `CDP browser identity changed from ${expectedBrowserId} to ${actualBrowserId}`,
      );
    }
  }
  return targets.filter((item) => isValidCdpPageTarget(item, port));
}

async function connectBrowserIdentityAnchor(port, expectedBrowserId) {
  const version = await fetchCdpJson(port, "/json/version");
  const actualBrowserId = browserIdFromVersion(version, port);
  if (actualBrowserId !== expectedBrowserId) {
    throw new CdpIdentityMismatchError(
      `CDP browser identity changed from ${expectedBrowserId} to ${actualBrowserId}`,
    );
  }
  return new BrowserIdentityAnchor(validatedDebuggerUrl(version, port)).open();
}

const THEME_CHOICES = {
  appearance: new Set(["auto", "light", "dark"]),
  safeArea: new Set(["auto", "left", "right", "center", "none"]),
  taskMode: new Set(["auto", "ambient", "banner", "off"]),
};

function normalizedUnit(value, name) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new Error(`${name} must be null or a number between 0 and 1`);
  }
  return number;
}

function normalizedChoice(value, name, choices, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (!choices.has(value)) throw new Error(`${name} has an unsupported value: ${value}`);
  return value;
}

function normalizedText(value, name, fallback, maxLength = 120) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string" || value.length > maxLength || /[\u0000-\u001f]/.test(value)) {
    throw new Error(`${name} must be a short single-line string`);
  }
  return value;
}

function pathStaysInside(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function decodeCssUrlToken(value) {
  const trimmed = value.trim();
  if (!trimmed || /[\u0000-\u001f]/.test(trimmed)) {
    throw new Error("Theme CSS contains an invalid url() token");
  }
  if (/^(?:https?:|data:|file:|javascript:|\/\/|#)/i.test(trimmed)) {
    throw new Error("Theme CSS cannot reference external, inline, script, or fragment URLs");
  }
  try {
    return decodeURIComponent(trimmed.replace(/\\(["'()\\\s])/g, "$1"));
  } catch {
    throw new Error("Theme CSS contains an invalid encoded url() token");
  }
}

async function inlineThemeCssAssetUrls(cssText, cssDir, themeDir) {
  let cursor = 0;
  let output = "";
  let assetCount = 0;
  let assetBytesTotal = 0;
  const sourceStamps = [];
  CSS_URL_PATTERN.lastIndex = 0;
  let match;
  while ((match = CSS_URL_PATTERN.exec(cssText)) !== null) {
    const rawUrl = match[1] ?? match[2] ?? match[3] ?? "";
    const relativeAsset = decodeCssUrlToken(rawUrl);
    if (path.isAbsolute(relativeAsset)) {
      throw new Error("Theme CSS asset path must be relative");
    }
    const assetPath = path.resolve(cssDir, relativeAsset);
    if (!pathStaysInside(themeDir, assetPath)) {
      throw new Error("Theme CSS asset path escaped the theme directory");
    }
    const realAssetPath = await fs.realpath(assetPath);
    if (!pathStaysInside(themeDir, realAssetPath)) {
      throw new Error("Theme CSS asset path escaped through a link or junction");
    }
    const extension = path.extname(realAssetPath).toLowerCase();
    const mime = THEME_ASSET_MIME_TYPES.get(extension);
    if (!mime) {
      throw new Error(`Unsupported theme CSS asset format: ${extension || "missing"}`);
    }
    const stat = await fs.stat(realAssetPath);
    if (!stat.isFile()) throw new Error("Theme CSS asset is not a file");
    if (stat.size < 1) throw new Error("Theme CSS asset cannot be empty");
    if (stat.size > MAX_THEME_ASSET_BYTES) {
      throw new Error(`Theme CSS asset exceeds the ${MAX_THEME_ASSET_BYTES / 1024 / 1024} MB per-file limit`);
    }
    assetBytesTotal += stat.size;
    if (assetBytesTotal > MAX_THEME_ASSETS_BYTES) {
      throw new Error(`Theme CSS assets exceed the ${MAX_THEME_ASSETS_BYTES / 1024 / 1024} MB total limit`);
    }
    const assetBytes = await fs.readFile(realAssetPath);
    if (!readImageMetadata(assetBytes, extension)) {
      throw new Error("Theme CSS asset metadata is invalid or exceeds the 16384px / 50MP safety limit");
    }
    sourceStamps.push(`${realAssetPath}:${stat.size}:${stat.mtimeMs}`);
    output += cssText.slice(cursor, match.index);
    output += `url("data:${mime};base64,${assetBytes.toString("base64")}")`;
    cursor = CSS_URL_PATTERN.lastIndex;
    assetCount += 1;
  }
  output += cssText.slice(cursor);
  return { cssText: output, assetCount, assetBytesTotal, sourceStamp: sourceStamps.join("|") };
}

async function fileExists(filePath) {
  if (!filePath) return false;
  try {
    return (await fs.stat(filePath)).isFile();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function loadThemeCss(themeDir, theme) {
  let cssRelativePath = theme?.style && typeof theme.style === "object" && !Array.isArray(theme.style)
    ? normalizedText(theme.style.css, "style.css", "", 240)
    : "";
  if (!cssRelativePath && await fileExists(path.join(themeDir, "theme.css"))) {
    theme.style = { ...(theme.style ?? {}), css: "theme.css" };
    cssRelativePath = "theme.css";
  }
  if (!cssRelativePath) {
    return { hasThemeCss: false, cssText: "", cssPath: null, assetCount: 0, assetBytesTotal: 0, sourceStamp: "" };
  }
  if (path.isAbsolute(cssRelativePath)) throw new Error("Theme CSS path must be relative");
  const cssPath = path.resolve(themeDir, cssRelativePath);
  if (!pathStaysInside(themeDir, cssPath)) throw new Error("Theme CSS path escaped the theme directory");
  const realCssPath = await fs.realpath(cssPath);
  if (!pathStaysInside(themeDir, realCssPath)) throw new Error("Theme CSS path escaped through a link or junction");
  if (path.extname(realCssPath).toLowerCase() !== ".css") throw new Error("Theme CSS must be a .css file");
  const cssStat = await fs.stat(realCssPath);
  if (!cssStat.isFile()) throw new Error("Theme CSS is not a file");
  if (cssStat.size < 1) throw new Error("Theme CSS cannot be empty");
  if (cssStat.size > MAX_THEME_CSS_BYTES) {
    throw new Error(`Theme CSS exceeds the ${MAX_THEME_CSS_BYTES / 1024} KB limit`);
  }
  const rawCss = await fs.readFile(realCssPath, "utf8");
  if (/@import\s/i.test(rawCss)) {
    throw new Error("Theme CSS cannot use @import");
  }
  if (/(?:https?:|data:|file:|javascript:|\/\/)/i.test(rawCss.replace(CSS_URL_PATTERN, ""))) {
    throw new Error("Theme CSS cannot reference external URLs");
  }
  const inlined = await inlineThemeCssAssetUrls(rawCss, path.dirname(realCssPath), themeDir);
  theme.style = { ...(theme.style ?? {}), css: "theme.css" };
  return {
    hasThemeCss: true,
    cssText: `\n/* skin-codex-theme-css:${theme.id} */\n${inlined.cssText}`,
    cssPath: realCssPath,
    assetCount: inlined.assetCount,
    assetBytesTotal: inlined.assetBytesTotal,
    sourceStamp: `${realCssPath}:${cssStat.size}:${cssStat.mtimeMs}:${inlined.sourceStamp}`,
  };
}

async function inlineComponentImage(themeDir, value, name) {
  const relativePath = normalizedText(value, name, "", 240);
  if (!relativePath) return { dataUrl: "", sourceStamp: "" };
  if (path.isAbsolute(relativePath) || !/^assets[\\/]/i.test(relativePath)) {
    throw new Error(`${name} must be a relative path inside assets`);
  }
  const assetPath = path.resolve(themeDir, relativePath);
  const assetsRoot = path.resolve(themeDir, "assets");
  if (!pathStaysInside(assetsRoot, assetPath)) throw new Error(`${name} escaped the assets directory`);
  const realAssetPath = await fs.realpath(assetPath);
  if (!pathStaysInside(assetsRoot, realAssetPath)) throw new Error(`${name} escaped through a link or junction`);
  const extension = path.extname(realAssetPath).toLowerCase();
  const mime = THEME_ASSET_MIME_TYPES.get(extension);
  if (!mime) throw new Error(`${name} uses an unsupported image format`);
  const stat = await fs.stat(realAssetPath);
  if (!stat.isFile() || stat.size < 1 || stat.size > MAX_THEME_ASSET_BYTES) {
    throw new Error(`${name} must be an image no larger than ${MAX_THEME_ASSET_BYTES / 1024 / 1024} MB`);
  }
  const bytes = await fs.readFile(realAssetPath);
  if (!readImageMetadata(bytes, extension)) {
    throw new Error(`${name} metadata is invalid or exceeds the 16384px / 50MP safety limit`);
  }
  return {
    dataUrl: `data:${mime};base64,${bytes.toString("base64")}`,
    sourceStamp: `${realAssetPath}:${stat.size}:${stat.mtimeMs}`,
  };
}

function componentText(value, name, fallback, maxLength) {
  return normalizedText(value, `components.${name}`, fallback, maxLength);
}

function assertKnownObjectKeys(value, allowedKeys, name) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new Error(`${name} has an unknown key: ${key}`);
  }
}

function normalizeExperienceEntry(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  assertKnownObjectKeys(value, EXPERIENCE_ENTRY_KEYS, name);
  const entry = {};
  if (value.surface !== undefined) {
    if (typeof value.surface !== "string" || !EXPERIENCE_SURFACES.has(value.surface)) {
      throw new Error(`${name}.surface must be one of: plain, soft, raised`);
    }
    entry.surface = value.surface;
  }
  if (value.density !== undefined) {
    if (typeof value.density !== "string" || !EXPERIENCE_DENSITIES.has(value.density)) {
      throw new Error(`${name}.density must be one of: compact, comfortable, spacious`);
    }
    entry.density = value.density;
  }
  if (!entry.surface && !entry.density) throw new Error(`${name} must declare surface or density`);
  return entry;
}

async function loadThemeExperience(themeDir, theme) {
  if (theme?.experience === undefined) {
    return { hasExperience: false, experience: null, experiencePath: null, sourceStamp: "" };
  }
  if (!theme.experience || typeof theme.experience !== "object" || Array.isArray(theme.experience)) {
    throw new Error("Theme experience must be an object with a file");
  }
  const relativePath = normalizedText(theme.experience.file, "experience.file", "", 240);
  if (!relativePath) throw new Error("Theme experience.file is required");
  if (path.isAbsolute(relativePath)) throw new Error("Theme experience path must be relative");
  const experiencePath = path.resolve(themeDir, relativePath);
  if (!pathStaysInside(themeDir, experiencePath)) {
    throw new Error("Theme experience path escaped the theme directory");
  }
  const realExperiencePath = await fs.realpath(experiencePath);
  if (!pathStaysInside(themeDir, realExperiencePath)) {
    throw new Error("Theme experience path escaped through a link or junction");
  }
  if (path.extname(realExperiencePath).toLowerCase() !== ".json") {
    throw new Error("Theme experience must be a JSON file");
  }
  const stat = await fs.stat(realExperiencePath);
  if (!stat.isFile() || stat.size < 2 || stat.size > MAX_THEME_EXPERIENCE_BYTES) {
    throw new Error("Theme experience must be between 2 bytes and 12 KB");
  }
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(realExperiencePath, "utf8"));
  } catch {
    throw new Error("Theme experience contains invalid JSON");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.schemaVersion !== 1) {
    throw new Error("Theme experience must be a schemaVersion 1 object");
  }
  assertKnownObjectKeys(raw, EXPERIENCE_ROOT_KEYS, "Theme experience");
  if (!raw.content || typeof raw.content !== "object" || Array.isArray(raw.content)) {
    throw new Error("Theme experience.content must be an object");
  }
  assertKnownObjectKeys(raw.content, EXPERIENCE_CONTENT_KEYS, "Theme experience.content");
  const content = {};
  for (const [key, value] of Object.entries(raw.content)) {
    content[key] = normalizeExperienceEntry(value, `experience.content.${key}`);
  }
  const controls = raw.controls === undefined ? {} : raw.controls;
  if (!controls || typeof controls !== "object" || Array.isArray(controls)) {
    throw new Error("Theme experience.controls must be an object");
  }
  assertKnownObjectKeys(controls, EXPERIENCE_CONTROL_KEYS, "Theme experience.controls");
  const feedback = controls.feedback === undefined ? "responsive" : controls.feedback;
  if (typeof feedback !== "string" || !EXPERIENCE_FEEDBACK.has(feedback)) {
    throw new Error("experience.controls.feedback must be one of: quiet, responsive, expressive");
  }
  theme.experience = { file: "experience.json" };
  return {
    hasExperience: true,
    experiencePath: realExperiencePath,
    experience: { schemaVersion: 1, content, controls: { feedback } },
    sourceStamp: `${realExperiencePath}:${stat.size}:${stat.mtimeMs}`,
  };
}

async function loadThemeComponents(themeDir, theme) {
  let relativePath = theme?.components && typeof theme.components === "object" && !Array.isArray(theme.components)
    ? normalizedText(theme.components.file, "components.file", "", 240)
    : "";
  if (!relativePath && await fileExists(path.join(themeDir, "components.json"))) {
    relativePath = "components.json";
  }
  if (!relativePath) {
    return { hasComponents: false, components: null, componentsPath: null, sourceStamp: "" };
  }
  if (path.isAbsolute(relativePath)) throw new Error("Theme components path must be relative");
  const componentsPath = path.resolve(themeDir, relativePath);
  if (!pathStaysInside(themeDir, componentsPath)) throw new Error("Theme components path escaped the theme directory");
  const realComponentsPath = await fs.realpath(componentsPath);
  if (!pathStaysInside(themeDir, realComponentsPath)) {
    throw new Error("Theme components path escaped through a link or junction");
  }
  if (path.extname(realComponentsPath).toLowerCase() !== ".json") {
    throw new Error("Theme components must be a JSON file");
  }
  const stat = await fs.stat(realComponentsPath);
  if (!stat.isFile() || stat.size < 2 || stat.size > MAX_THEME_COMPONENTS_BYTES) {
    throw new Error("Theme components must be between 2 bytes and 64 KB");
  }
  const raw = JSON.parse(await fs.readFile(realComponentsPath, "utf8"));
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.schemaVersion !== 1 ||
      !raw.home || typeof raw.home !== "object" || Array.isArray(raw.home)) {
    throw new Error("Theme components must be a schemaVersion 1 object with a home section");
  }
  const cards = raw.home.cards === undefined ? [] : raw.home.cards;
  if (!Array.isArray(cards) || cards.length > 4) {
    throw new Error("components.home.cards must be an array with at most four cards");
  }
  const imageStamps = [];
  const hero = await inlineComponentImage(themeDir, raw.home.heroImage, "components.home.heroImage");
  if (hero.sourceStamp) imageStamps.push(hero.sourceStamp);
  const normalizedCards = [];
  for (const [index, card] of cards.entries()) {
    if (!card || typeof card !== "object" || Array.isArray(card)) {
      throw new Error(`components.home.cards[${index}] must be an object`);
    }
    if (!card.action || typeof card.action !== "object" || Array.isArray(card.action)) {
      throw new Error(`components.home.cards[${index}].action must be an object`);
    }
    const type = componentText(card.action.type, `home.cards[${index}].action.type`, null, 32);
    if (!new Set(["focus-composer", "insert-prompt", "native-suggestion"]).has(type)) {
      throw new Error(`components.home.cards[${index}].action is not whitelisted`);
    }
    const action = { type };
    if (type === "insert-prompt") {
      action.value = componentText(card.action.value, `home.cards[${index}].action.value`, null, 1000);
      if (!action.value?.trim()) throw new Error(`components.home.cards[${index}].action.value is required`);
    }
    if (type === "native-suggestion") {
      const nativeIndex = Number(card.action.index);
      if (!Number.isInteger(nativeIndex) || nativeIndex < 0 || nativeIndex > 3) {
        throw new Error(`components.home.cards[${index}].action.index must be between 0 and 3`);
      }
      action.index = nativeIndex;
    }
    const icon = await inlineComponentImage(themeDir, card.icon, `components.home.cards[${index}].icon`);
    if (icon.sourceStamp) imageStamps.push(icon.sourceStamp);
    const title = componentText(card.title, `home.cards[${index}].title`, null, 60);
    if (!title?.trim()) throw new Error(`components.home.cards[${index}].title is required`);
    normalizedCards.push({
      title,
      description: componentText(card.description, `home.cards[${index}].description`, "", 120),
      icon: icon.dataUrl,
      action,
    });
  }
  let note = null;
  if (raw.home.note !== undefined && raw.home.note !== null) {
    if (typeof raw.home.note !== "object" || Array.isArray(raw.home.note)) {
      throw new Error("components.home.note must be an object");
    }
    const lines = raw.home.note.lines === undefined ? [] : raw.home.note.lines;
    if (!Array.isArray(lines) || lines.length > 4) {
      throw new Error("components.home.note.lines must be an array with at most four lines");
    }
    note = {
      title: componentText(raw.home.note.title, "home.note.title", "", 60),
      lines: lines.map((line, index) => {
        const value = componentText(line, `home.note.lines[${index}]`, null, 80);
        if (!value?.trim()) throw new Error(`components.home.note.lines[${index}] is required`);
        return value;
      }),
    };
  }
  let task = null;
  if (raw.task !== undefined && raw.task !== null) {
    if (typeof raw.task !== "object" || Array.isArray(raw.task)) {
      throw new Error("components.task must be an object");
    }
    const taskHero = await inlineComponentImage(themeDir, raw.task.heroImage, "components.task.heroImage");
    if (taskHero.sourceStamp) imageStamps.push(taskHero.sourceStamp);
    const taskTitle = componentText(raw.task.title, "task.title", null, 100);
    if (!taskTitle?.trim()) throw new Error("components.task.title is required");
    task = {
      eyebrow: componentText(raw.task.eyebrow, "task.eyebrow", "", 60),
      title: taskTitle,
      subtitle: componentText(raw.task.subtitle, "task.subtitle", "", 180),
      heroImage: taskHero.dataUrl,
      status: componentText(raw.task.status, "task.status", "", 60),
    };
  }
  let chrome = null;
  if (raw.chrome !== undefined && raw.chrome !== null) {
    if (!raw.chrome || typeof raw.chrome !== "object" || Array.isArray(raw.chrome)) {
      throw new Error("components.chrome must be an object");
    }
    assertKnownObjectKeys(raw.chrome, new Set(["route", "title", "subtitle", "badge", "icon"]), "components.chrome");
    const route = componentText(raw.chrome.route, "chrome.route", "home", 16);
    if (!new Set(["home", "chat"]).has(route)) {
      throw new Error("components.chrome.route must be one of: home, chat");
    }
    const title = componentText(raw.chrome.title, "chrome.title", null, 80);
    if (!title?.trim()) throw new Error("components.chrome.title is required");
    const icon = await inlineComponentImage(themeDir, raw.chrome.icon, "components.chrome.icon");
    if (icon.sourceStamp) imageStamps.push(icon.sourceStamp);
    chrome = {
      route,
      title,
      subtitle: componentText(raw.chrome.subtitle, "chrome.subtitle", "", 120),
      badge: componentText(raw.chrome.badge, "chrome.badge", "", 48),
      icon: icon.dataUrl,
    };
  }
  let sidebar = null;
  if (raw.sidebar !== undefined && raw.sidebar !== null) {
    if (!raw.sidebar || typeof raw.sidebar !== "object" || Array.isArray(raw.sidebar)) {
      throw new Error("components.sidebar must be an object");
    }
    assertKnownObjectKeys(raw.sidebar, new Set(["defaultIcon", "newTaskIcon", "matches"]), "components.sidebar");
    const defaultIcon = await inlineComponentImage(themeDir, raw.sidebar.defaultIcon, "components.sidebar.defaultIcon");
    const newTaskIcon = await inlineComponentImage(themeDir, raw.sidebar.newTaskIcon, "components.sidebar.newTaskIcon");
    if (defaultIcon.sourceStamp) imageStamps.push(defaultIcon.sourceStamp);
    if (newTaskIcon.sourceStamp) imageStamps.push(newTaskIcon.sourceStamp);
    const matches = raw.sidebar.matches === undefined ? [] : raw.sidebar.matches;
    if (!Array.isArray(matches) || matches.length > 12) {
      throw new Error("components.sidebar.matches must be an array with at most twelve entries");
    }
    const normalizedMatches = [];
    for (const [index, match] of matches.entries()) {
      if (!match || typeof match !== "object" || Array.isArray(match)) {
        throw new Error(`components.sidebar.matches[${index}] must be an object`);
      }
      assertKnownObjectKeys(match, new Set(["title", "icon"]), `components.sidebar.matches[${index}]`);
      const title = componentText(match.title, `sidebar.matches[${index}].title`, null, 160);
      if (!title?.trim()) throw new Error(`components.sidebar.matches[${index}].title is required`);
      const icon = await inlineComponentImage(themeDir, match.icon, `components.sidebar.matches[${index}].icon`);
      if (!icon.dataUrl) throw new Error(`components.sidebar.matches[${index}].icon is required`);
      if (icon.sourceStamp) imageStamps.push(icon.sourceStamp);
      normalizedMatches.push({ title, icon: icon.dataUrl });
    }
    sidebar = { defaultIcon: defaultIcon.dataUrl, newTaskIcon: newTaskIcon.dataUrl, matches: normalizedMatches };
  }
  let sticker = null;
  if (raw.sticker !== undefined && raw.sticker !== null) {
    if (!raw.sticker || typeof raw.sticker !== "object" || Array.isArray(raw.sticker)) {
      throw new Error("components.sticker must be an object");
    }
    assertKnownObjectKeys(raw.sticker, new Set(["route", "anchor", "size", "image", "caption"]), "components.sticker");
    const route = componentText(raw.sticker.route, "sticker.route", null, 16);
    if (!new Set(["home", "chat"]).has(route)) {
      throw new Error("components.sticker.route must be one of: home, chat");
    }
    const anchor = componentText(raw.sticker.anchor, "sticker.anchor", null, 24);
    if (!new Set(["top-start", "top-end", "bottom-start", "bottom-end"]).has(anchor)) {
      throw new Error("components.sticker.anchor must be one of: top-start, top-end, bottom-start, bottom-end");
    }
    const size = componentText(raw.sticker.size, "sticker.size", "medium", 12);
    if (!new Set(["small", "medium", "large"]).has(size)) {
      throw new Error("components.sticker.size must be one of: small, medium, large");
    }
    const image = await inlineComponentImage(themeDir, raw.sticker.image, "components.sticker.image");
    if (!image.dataUrl) throw new Error("components.sticker.image is required");
    if (image.sourceStamp) imageStamps.push(image.sourceStamp);
    sticker = {
      route,
      anchor,
      size,
      image: image.dataUrl,
      caption: componentText(raw.sticker.caption, "sticker.caption", "", 100),
    };
  }
  const title = componentText(raw.home.title, "home.title", null, 100);
  if (!title?.trim()) throw new Error("components.home.title is required");
  theme.components = { file: "components.json" };
  const normalizedComponents = {
    schemaVersion: 1,
    home: {
      eyebrow: componentText(raw.home.eyebrow, "home.eyebrow", "", 60),
      title,
      subtitle: componentText(raw.home.subtitle, "home.subtitle", "", 180),
      heroImage: hero.dataUrl,
      status: componentText(raw.home.status, "home.status", "", 60),
      cards: normalizedCards,
      note,
    },
    task,
    chrome,
    sidebar,
    sticker,
  };
  normalizedComponents.revision = createHash("sha256")
    .update(JSON.stringify(normalizedComponents), "utf8")
    .digest("hex")
    .slice(0, 16);
  return {
    hasComponents: true,
    componentsPath: realComponentsPath,
    components: normalizedComponents,
    sourceStamp: `${realComponentsPath}:${stat.size}:${stat.mtimeMs}:${imageStamps.join("|")}`,
  };
}

async function loadTheme(themeDir) {
  const realThemeDir = await fs.realpath(themeDir);
  const themePath = path.join(realThemeDir, "theme.json");
  const themeText = await fs.readFile(themePath, "utf8");
  const raw = JSON.parse(themeText);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Theme root must be an object");
  }
  const image = normalizedText(raw.image, "image", null, 240);
  if (!image || path.isAbsolute(image)) throw new Error("Theme image must be a relative path");
  const imagePath = path.resolve(realThemeDir, image);
  const relativeImage = path.relative(realThemeDir, imagePath);
  if (!relativeImage || relativeImage.startsWith("..") || path.isAbsolute(relativeImage)) {
    throw new Error("Theme image must remain inside the selected theme directory");
  }
  const extension = path.extname(imagePath).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp"].includes(extension)) {
    throw new Error(`Unsupported theme image format: ${extension || "missing"}`);
  }
  const realImagePath = await fs.realpath(imagePath);
  const realRelativeImage = path.relative(realThemeDir, realImagePath);
  if (!realRelativeImage || realRelativeImage.startsWith("..") || path.isAbsolute(realRelativeImage)) {
    throw new Error("Theme image cannot escape through a link or junction");
  }
  const art = raw.art && typeof raw.art === "object" && !Array.isArray(raw.art) ? raw.art : {};
  const palette = raw.palette && typeof raw.palette === "object" && !Array.isArray(raw.palette)
    ? raw.palette : {};
  const style = raw.style && typeof raw.style === "object" && !Array.isArray(raw.style) ? raw.style : {};
  const components = raw.components && typeof raw.components === "object" && !Array.isArray(raw.components)
    ? raw.components : {};
  if (raw.experience !== undefined && (!raw.experience || typeof raw.experience !== "object" || Array.isArray(raw.experience))) {
    throw new Error("Theme experience must be an object with a file");
  }
  const experience = raw.experience ?? null;
  const theme = {
    id: normalizedText(raw.id, "id", "custom", 80),
    name: normalizedText(raw.name, "name", "Codex Dream Skin", 120),
    image,
    appearance: normalizedChoice(raw.appearance, "appearance", THEME_CHOICES.appearance, "auto"),
    art: {
      focusX: normalizedUnit(art.focusX, "art.focusX"),
      focusY: normalizedUnit(art.focusY, "art.focusY"),
      safeArea: normalizedChoice(art.safeArea, "art.safeArea", THEME_CHOICES.safeArea, "auto"),
      taskMode: normalizedChoice(art.taskMode, "art.taskMode", THEME_CHOICES.taskMode, "auto"),
    },
    palette: {},
  };
  const cssPath = normalizedText(style.css, "style.css", "", 240);
  if (cssPath) theme.style = { css: cssPath };
  const componentsPath = normalizedText(components.file, "components.file", "", 240);
  if (componentsPath) theme.components = { file: componentsPath };
  if (experience) {
    const experiencePath = normalizedText(experience.file, "experience.file", "", 240);
    if (!experiencePath) throw new Error("Theme experience.file is required");
    theme.experience = { file: experiencePath };
  }
  if (typeof palette.accent === "string" && palette.accent.trim()) {
    const accent = palette.accent.trim();
    if (!/^(?:#[\da-f]{3,8}|(?:rgb|hsl|oklch|oklab)\([^;{}]{1,96}\))$/i.test(accent)) {
      throw new Error("palette.accent is not a supported CSS color");
    }
    theme.palette.accent = accent;
  }
  const [themeStat, imageStat] = await Promise.all([fs.stat(themePath), fs.stat(realImagePath)]);
  if (!imageStat.isFile()) throw new Error("Theme image is not a file");
  if (imageStat.size < 1) throw new Error("Theme image cannot be empty");
  if (imageStat.size > MAX_ART_BYTES) {
    throw new Error(`Theme image exceeds the ${MAX_ART_BYTES / 1024 / 1024} MB limit`);
  }
  const imageBytes = await fs.readFile(realImagePath);
  if (imageBytes.length < 1 || imageBytes.length > MAX_ART_BYTES) {
    throw new Error(`Theme image must be between 1 byte and ${MAX_ART_BYTES / 1024 / 1024} MB`);
  }
  const artMetadata = readImageMetadata(imageBytes, extension);
  if (!artMetadata) {
    throw new Error("Theme image metadata is invalid or exceeds the 16384px / 50MP safety limit");
  }
  const themeCss = await loadThemeCss(realThemeDir, theme);
  const themeComponents = await loadThemeComponents(realThemeDir, theme);
  const themeExperience = await loadThemeExperience(realThemeDir, theme);
  theme.artMetadata = artMetadata;
  const fingerprint = createHash("sha256")
    .update(themeText, "utf8")
    .update("\0")
    .update(imageBytes)
    .update("\0")
    .update(themeCss.cssText, "utf8")
    .update("\0")
    .update(JSON.stringify(themeComponents.components), "utf8")
    .update("\0")
    .update(JSON.stringify(themeExperience.experience), "utf8")
    .digest("hex");
  return {
    theme,
    themePath,
    imagePath: realImagePath,
    imageBytes,
    hasThemeCss: themeCss.hasThemeCss,
    themeCssText: themeCss.cssText,
    themeCssPath: themeCss.cssPath,
    themeCssAssetCount: themeCss.assetCount,
    themeCssAssetBytes: themeCss.assetBytesTotal,
    hasComponents: themeComponents.hasComponents,
    components: themeComponents.components,
    componentsPath: themeComponents.componentsPath,
    hasExperience: themeExperience.hasExperience,
    experience: themeExperience.experience,
    experiencePath: themeExperience.experiencePath,
    fingerprint,
    sourceStamp: `${themeStat.size}:${themeStat.mtimeMs}:${imageStat.size}:${imageStat.mtimeMs}:${themeCss.sourceStamp}:${themeComponents.sourceStamp}:${themeExperience.sourceStamp}`,
  };
}

async function loadPayload(themeDir = path.join(root, "assets"), candidateTheme = null) {
  const loadedTheme = candidateTheme ?? await loadTheme(themeDir);
  const [css, template] = await Promise.all([
    fs.readFile(path.join(root, "assets", "dream-skin.css"), "utf8"),
    fs.readFile(path.join(root, "assets", "renderer-inject.js"), "utf8"),
  ]);
  const combinedCss = loadedTheme.themeCssText ? `${css}\n${loadedTheme.themeCssText}` : css;
  const extension = path.extname(loadedTheme.imagePath).toLowerCase();
  const mime = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg"
    : extension === ".webp" ? "image/webp" : "image/png";
  const artDataUrl = `data:${mime};base64,${loadedTheme.imageBytes.toString("base64")}`;
  const payload = template
    .replace("__DREAM_CSS_JSON__", JSON.stringify(combinedCss))
    .replace("__DREAM_ART_JSON__", JSON.stringify(artDataUrl))
    .replace("__DREAM_THEME_JSON__", JSON.stringify(loadedTheme.theme))
    .replace("__DREAM_COMPONENTS_JSON__", JSON.stringify(loadedTheme.components))
    .replace("__DREAM_EXPERIENCE_JSON__", JSON.stringify(loadedTheme.experience));
  const { imageBytes: _imageBytes, ...themeState } = loadedTheme;
  return { ...themeState, payload };
}

async function readThemeSourceStamp(loadedTheme) {
  const [themeStat, imageStat] = await Promise.all([
    fs.stat(loadedTheme.themePath),
    fs.stat(loadedTheme.imagePath),
  ]);
  let cssStamp = "";
  if (loadedTheme.themeCssPath) {
    try {
      const cssStat = await fs.stat(loadedTheme.themeCssPath);
      cssStamp = `${loadedTheme.themeCssPath}:${cssStat.size}:${cssStat.mtimeMs}`;
    } catch {
      cssStamp = "missing-css";
    }
  }
  let componentsStamp = "";
  if (loadedTheme.componentsPath) {
    try {
      const componentsStat = await fs.stat(loadedTheme.componentsPath);
      componentsStamp = `${loadedTheme.componentsPath}:${componentsStat.size}:${componentsStat.mtimeMs}`;
    } catch {
      componentsStamp = "missing-components";
    }
  }
  let experienceStamp = "";
  if (loadedTheme.experiencePath) {
    try {
      const experienceStat = await fs.stat(loadedTheme.experiencePath);
      experienceStamp = `${loadedTheme.experiencePath}:${experienceStat.size}:${experienceStat.mtimeMs}`;
    } catch {
      experienceStamp = "missing-experience";
    }
  }
  return `${themeStat.size}:${themeStat.mtimeMs}:${imageStat.size}:${imageStat.mtimeMs}:${cssStamp}:${componentsStamp}:${experienceStamp}`;
}

async function probeSession(session) {
  return session.evaluate(`(() => {
    const markers = {
      shell: Boolean(document.querySelector('main.main-surface')),
      sidebar: Boolean(document.querySelector('.app-shell-left-panel')),
      composer: Boolean(document.querySelector('.composer-surface-chrome')),
      main: Boolean(document.querySelector('[role="main"]')),
      appShell: Boolean(document.querySelector('.app-shell-main-content-frame, .app-shell-main-content-top-fade, [data-tab-id]')),
    };
    return {
      markers,
      codex: location.protocol === 'app:' && markers.shell &&
        (markers.sidebar || markers.composer || markers.main || markers.appShell),
    };
  })()`);
}

async function waitForCodexProbe(session, timeoutMs = 1800) {
  const deadline = Date.now() + timeoutMs;
  let probe = null;
  while (Date.now() < deadline) {
    try {
      probe = await probeSession(session);
      if (probe?.codex) return probe;
    } catch {
      // The renderer may be between documents while the early payload waits.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return probe;
}

async function connectTarget(target, port) {
  return new CdpSession(target, port).open();
}

async function connectCodexTargets(port, timeoutMs, expectedBrowserId) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const targets = await listAppTargets(port, expectedBrowserId);
      const connected = [];
      for (const target of targets) {
        let session;
        try {
          session = await connectTarget(target, port);
          const probe = await probeSession(session);
          if (probe?.codex) connected.push({ target, session, probe });
          else session.close();
        } catch (error) {
          session?.close();
          lastError = error;
        }
      }
      if (connected.length) return connected;
      lastError = new Error("No page matched the expected Codex shell markers");
    } catch (error) {
      if (error instanceof CdpIdentityMismatchError) throw error;
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`No verified Codex renderer on 127.0.0.1:${port}: ${lastError?.message ?? "timed out"}`);
}

async function applyToSession(session, payload) {
  return session.evaluate(payload);
}

export function earlyPayloadFor(payload, revision) {
  return `(() => {
    const generationKey = "__CODEX_DREAM_SKIN_EARLY_GENERATION__";
    const appliedKey = "__CODEX_DREAM_SKIN_EARLY_APPLIED__";
    const generation = ${JSON.stringify(revision)};
    window[generationKey] = generation;
    let observer = null;
    let timeout = null;
    const stop = () => {
      observer?.disconnect();
      observer = null;
      if (timeout) clearTimeout(timeout);
      timeout = null;
    };
    const install = () => {
      if (window[generationKey] !== generation) { stop(); return true; }
      const root = document.documentElement;
      if (!root || !document.body) return false;
      const shell = document.querySelector('main.main-surface');
      const codexMarker = document.querySelector(
        '.app-shell-left-panel, .composer-surface-chrome, [role="main"], .app-shell-main-content-frame, .app-shell-main-content-top-fade, [data-tab-id]',
      );
      if (!shell || !codexMarker) return false;
      stop();
      ${payload};
      window[appliedKey] = generation;
      return true;
    };
    if (install()) return;
    if (typeof MutationObserver === "function" && document.documentElement) {
      observer = new MutationObserver(install);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
    timeout = setTimeout(stop, 10000);
  })()`;
}

async function registerEarlyPayload(session, payload, revision) {
  const result = await session.send("Page.addScriptToEvaluateOnNewDocument", {
    source: earlyPayloadFor(payload, revision),
  });
  return result.identifier ?? null;
}

async function removeEarlyPayload(session, identifier) {
  if (!identifier || session.closed) return;
  await session.send("Page.removeScriptToEvaluateOnNewDocument", { identifier }).catch(() => {});
}

async function removeFromSession(session) {
  return session.evaluate(`(() => {
    window.__CODEX_DREAM_SKIN_DISABLED__ = true;
    const state = window.__CODEX_DREAM_SKIN_STATE__;
    if (state?.cleanup) return state.cleanup();
    document.documentElement?.classList.remove(
      'codex-dream-skin', 'dream-theme-light', 'dream-theme-dark',
      'dream-art-wide', 'dream-art-standard', 'dream-focus-left',
      'dream-focus-center', 'dream-focus-right', 'dream-safe-left',
      'dream-safe-center', 'dream-safe-right', 'dream-safe-none',
      'dream-task-ambient', 'dream-task-banner', 'dream-task-off'
    );
    for (const property of [
      '--dream-art', '--dream-art-position', '--dream-focus-x', '--dream-focus-y',
      '--dream-accent', '--dream-accent-ink', '--dream-image-luma'
    ]) document.documentElement?.style.removeProperty(property);
    document.querySelectorAll('.dream-home').forEach((node) => node.classList.remove('dream-home'));
    document.querySelectorAll('.dream-task').forEach((node) => node.classList.remove('dream-task'));
    document.querySelectorAll('.dream-home-shell').forEach((node) => node.classList.remove('dream-home-shell'));
    for (const className of [
      'skin-codex-shell', 'skin-codex-sidebar', 'skin-codex-sidebar-item',
      'skin-codex-sidebar-item-active', 'skin-codex-route', 'skin-codex-home',
      'skin-codex-chat', 'skin-codex-home-cards', 'skin-codex-home-card',
      'skin-codex-composer', 'skin-codex-message', 'skin-codex-message-user',
      'skin-codex-message-assistant', 'skin-codex-code-block', 'skin-codex-dialog',
      'skin-codex-menu', 'skin-codex-header', 'skin-codex-thread', 'skin-codex-turn',
      'skin-codex-tool-card', 'skin-codex-diff-card', 'skin-codex-send-button',
      'skin-codex-composer-action', 'skin-codex-attachment-button',
      'skin-codex-access-selector', 'skin-codex-model-selector',
      'skin-codex-header-button', 'skin-codex-settings-button'
    ]) document.querySelectorAll('.' + className).forEach((node) => node.classList.remove(className));
    document.querySelector('.skin-codex-bplus')?.remove();
    document.querySelector('.skin-codex-bplus-task')?.remove();
    document.getElementById('codex-dream-skin-style')?.remove();
    document.getElementById('codex-dream-skin-chrome')?.remove();
    delete window.__CODEX_DREAM_SKIN_STATE__;
    return true;
  })()`);
}

async function verifyRemovedSession(session) {
  return session.evaluate(`(() =>
    !document.documentElement.classList.contains('codex-dream-skin') &&
    !document.documentElement.style.getPropertyValue('--dream-art') &&
    !document.querySelector('.dream-home') &&
    !document.querySelector('.dream-task') &&
    !document.querySelector('.dream-home-shell') &&
    !document.querySelector('.skin-codex-bplus') &&
    !document.querySelector('.skin-codex-bplus-task') &&
    !document.getElementById('codex-dream-skin-style') &&
    !document.getElementById('codex-dream-skin-chrome') &&
    !window.__CODEX_DREAM_SKIN_STATE__
  )()`);
}

async function verifySession(session) {
  return session.evaluate(`(() => {
    const box = (node) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    };
    const home = document.querySelector('.dream-home');
    const suggestions = home?.querySelector('.group\\\\/home-suggestions') ?? null;
    const cards = suggestions ? [...suggestions.querySelectorAll('button')].map(box) : [];
    const bPlus = document.querySelector('.skin-codex-bplus');
    const bPlusTask = document.querySelector('.skin-codex-bplus-task');
    const bPlusCards = [...document.querySelectorAll('.skin-codex-bplus-action-card')].map(box);
    const shell = document.querySelector('main.main-surface');
    const routeMain = document.querySelector('[role="main"]');
    const result = {
      installed: document.documentElement.classList.contains('codex-dream-skin'),
      version: window.__CODEX_DREAM_SKIN_STATE__?.version ?? null,
      expectedVersion: ${JSON.stringify(SKIN_VERSION)},
      stylePresent: Boolean(document.getElementById('codex-dream-skin-style')),
      chromePresent: Boolean(document.getElementById('codex-dream-skin-chrome')),
      chromePointerEvents: getComputedStyle(document.getElementById('codex-dream-skin-chrome') || document.body).pointerEvents,
      homePresent: Boolean(home),
      suggestionsPresent: Boolean(suggestions),
      bPlusPresent: Boolean(bPlus),
      bPlusTaskPresent: Boolean(bPlusTask),
      hero: box(home?.firstElementChild?.firstElementChild?.firstElementChild),
      cards,
      bPlusHero: box(document.querySelector('.skin-codex-bplus-hero')),
      bPlusTask: box(bPlusTask),
      bPlusCards,
      shell: box(shell),
      routeMain: box(routeMain),
      thread: box(document.querySelector('.skin-codex-thread')),
      composer: box(document.querySelector('.composer-surface-chrome')),
      sidebar: box(document.querySelector('.app-shell-left-panel')),
      viewport: { width: innerWidth, height: innerHeight },
      documentOverflow: {
        x: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        y: document.documentElement.scrollHeight > document.documentElement.clientHeight,
      },
    };
    result.composerVisible = !result.composer || (
      result.composer.y >= 0 &&
      result.composer.y + result.composer.height <= result.viewport.height + 1
    );
    result.taskClearOfThread = !result.bPlusTask || !result.thread ||
      result.bPlusTask.y + result.bPlusTask.height <= result.thread.y + 1;
    result.pass = result.installed && result.version === result.expectedVersion &&
      result.stylePresent && result.chromePresent &&
      result.chromePointerEvents === 'none' && Boolean(result.shell) &&
      (Boolean(result.composer) || Boolean(result.routeMain) || Boolean(result.sidebar)) &&
      result.composerVisible &&
      result.taskClearOfThread &&
      (!result.bPlusTaskPresent || (Boolean(result.bPlusTask) && result.bPlusTask.height >= 44)) &&
      (!result.homePresent || (result.bPlusPresent
        ? Boolean(result.bPlusHero) && result.bPlusCards.length >= 1 && result.bPlusCards.length <= 4
        : Boolean(result.hero) &&
          (!result.suggestionsPresent || (result.cards.length >= 2 && result.cards.length <= 4))));
    return result;
  })()`);
}

async function waitForVerifiedSession(session, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastResult;
  let lastError;
  while (Date.now() < deadline) {
    try {
      lastResult = await verifySession(session);
      lastError = null;
      if (lastResult.pass) return lastResult;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!lastResult && lastError) throw lastError;
  return lastResult;
}

async function capture(session, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await session.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await session.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  const viewport = await session.evaluate("({ width: innerWidth, height: innerHeight })");
  await session.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: Math.round(viewport.width * 0.64),
    y: Math.round(viewport.height * 0.62),
    button: "none",
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const result = await session.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await fs.writeFile(outputPath, Buffer.from(result.data, "base64"));
}

async function runOneShot(options) {
  const connected = await connectCodexTargets(options.port, options.timeoutMs, options.browserId);
  const loadedPayload = (options.mode === "once" || options.reload)
    ? await loadPayload(options.themeDir) : null;
  const payload = loadedPayload?.payload ?? null;
  const results = [];
  let screenshotCaptured = false;
  try {
    for (const { target, session, probe } of connected) {
      try {
        if (options.mode === "remove") await removeFromSession(session);
        else if (options.mode === "once") await applyToSession(session, payload);
        if (options.mode === "once") {
          await new Promise((resolve) => setTimeout(resolve, 850));
        }
        if (options.reload) {
          await session.send("Page.reload", { ignoreCache: true });
          await new Promise((resolve) => setTimeout(resolve, 1600));
          if (options.mode !== "remove") await applyToSession(session, payload);
        }
        const verified = options.mode === "remove"
          ? await verifyRemovedSession(session)
          : (options.reload || options.mode === "once" || options.mode === "verify")
            ? await waitForVerifiedSession(session, options.timeoutMs)
            : await verifySession(session);
        results.push({ targetId: target.id, markers: probe.markers, result: verified });
        if (options.screenshot && !screenshotCaptured) {
          await capture(session, options.screenshot);
          screenshotCaptured = true;
        }
      } finally {
        session.close();
      }
    }
  } finally {
    for (const { session } of connected) session.close();
  }
  console.log(JSON.stringify({ mode: options.mode, port: options.port, targets: results }, null, 2));
  const failed = results.length === 0 || results.some((item) =>
    options.mode === "remove" ? item.result !== true : !item.result?.pass);
  if (failed) process.exitCode = 2;
}

async function runWatch(options) {
  const identityAnchor = await connectBrowserIdentityAnchor(options.port, options.browserId);
  const sessions = new Map();
  const earlyScripts = new Map();
  const fallbackTargets = new Map();
  const fallbackListeners = new Set();
  const targetFailures = new Map();
  let stopping = false;
  let listFailures = 0;
  let lastListErrorLogAt = 0;
  let lastThemeErrorLogAt = 0;
  let lastStrongThemeAuditAt = 0;
  let loadedPayload = null;
  let paused = false;
  const stop = () => { stopping = true; };
  const rejectTarget = (target, baseDelayMs, error = null) => {
    const previous = targetFailures.get(target.id) ?? { failures: 0, lastLogAt: 0 };
    const failures = previous.failures + 1;
    const delayMs = Math.min(30000, baseDelayMs * (2 ** Math.min(failures - 1, 4)));
    const now = Date.now();
    if (error && (failures === 1 || now - previous.lastLogAt >= 30000)) {
      console.error(`[dream-skin] inject failed for ${target.id}: ${error.message}; retrying in ${delayMs}ms`);
      previous.lastLogAt = now;
    }
    targetFailures.set(target.id, { failures, lastLogAt: previous.lastLogAt, until: now + delayMs });
  };
  const attachLoadFallback = (id, target, session) => {
    if (fallbackListeners.has(id)) return;
    fallbackListeners.add(id);
    let lastReinjectErrorLogAt = 0;
    session.on("Page.loadEventFired", () => {
      if (!fallbackTargets.get(id)) return;
      setTimeout(() => {
        const operation = paused ? removeFromSession(session) : applyToSession(session, loadedPayload.payload);
        operation.catch((error) => {
          if (Date.now() - lastReinjectErrorLogAt >= 30000) {
            console.error(`[dream-skin] reinject failed for ${target.id}: ${error.message}`);
            lastReinjectErrorLogAt = Date.now();
          }
        });
      }, 250);
    });
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  try {
    loadedPayload = await loadPayload(options.themeDir);
    lastStrongThemeAuditAt = Date.now();
    paused = await fileExists(options.pauseFile);
    while (!stopping) {
      if (identityAnchor.closed) {
        console.error("[dream-skin] original CDP browser identity closed; watcher is stopping instead of reconnecting");
        process.exitCode = 3;
        break;
      }
      let targets = [];
      try {
        targets = await listAppTargets(options.port);
        listFailures = 0;
      } catch (error) {
        listFailures += 1;
        const retryMs = Math.min(10000, 1000 * (2 ** Math.min(listFailures - 1, 4)));
        if (listFailures === 1 || Date.now() - lastListErrorLogAt >= 30000) {
          console.error(`[dream-skin] ${new Date().toISOString()} ${error.message}; retrying in ${retryMs}ms`);
          lastListErrorLogAt = Date.now();
        }
        await new Promise((resolve) => setTimeout(resolve, retryMs));
        continue;
      }

      const nextPaused = await fileExists(options.pauseFile);
      let nextPayload = loadedPayload;
      if (!nextPaused) {
        try {
          const now = Date.now();
          let shouldAudit = !loadedPayload || now - lastStrongThemeAuditAt >= STRONG_THEME_AUDIT_MS;
          if (!shouldAudit) {
            try {
              shouldAudit = await readThemeSourceStamp(loadedPayload) !== loadedPayload.sourceStamp;
            } catch {
              shouldAudit = true;
            }
          }
          if (shouldAudit) {
            const candidateTheme = await loadTheme(options.themeDir);
            lastStrongThemeAuditAt = now;
            if (!loadedPayload || candidateTheme.fingerprint !== loadedPayload.fingerprint) {
              nextPayload = await loadPayload(options.themeDir, candidateTheme);
            } else {
              loadedPayload.sourceStamp = candidateTheme.sourceStamp;
            }
          }
        } catch (error) {
          if (Date.now() - lastThemeErrorLogAt >= 30000) {
            console.error(`[dream-skin] theme update rejected: ${error.message}; keeping the active theme`);
            lastThemeErrorLogAt = Date.now();
          }
        }
      }
      const pauseChanged = nextPaused !== paused;
      const payloadChanged = !nextPaused && nextPayload !== loadedPayload;
      loadedPayload = nextPayload;
      paused = nextPaused;

      if (pauseChanged || payloadChanged) {
        for (const [id, session] of sessions) {
          try {
            const previousEarlyScript = earlyScripts.get(id);
            if (paused) {
              await removeFromSession(session);
              await removeEarlyPayload(session, previousEarlyScript);
              earlyScripts.delete(id);
              fallbackTargets.delete(id);
              fallbackListeners.delete(id);
            } else {
              let nextEarlyScript = null;
              try {
                nextEarlyScript = await registerEarlyPayload(
                  session,
                  loadedPayload.payload,
                  loadedPayload.fingerprint,
                );
                if (!nextEarlyScript) throw new Error("CDP did not return an early-script identifier");
                fallbackTargets.set(id, false);
              } catch (error) {
                fallbackTargets.set(id, true);
                console.error(`[dream-skin] early theme refresh unavailable for ${id}: ${error.message}`);
                attachLoadFallback(id, { id }, session);
              }
              if (nextEarlyScript) earlyScripts.set(id, nextEarlyScript);
              else earlyScripts.delete(id);
              await removeEarlyPayload(session, previousEarlyScript);
              await applyToSession(session, loadedPayload.payload);
            }
          } catch (error) {
            console.error(`[dream-skin] live theme update failed for ${id}: ${error.message}`);
            await removeEarlyPayload(session, earlyScripts.get(id));
            earlyScripts.delete(id);
            fallbackTargets.delete(id);
            fallbackListeners.delete(id);
            session.close();
            sessions.delete(id);
          }
        }
        console.log(paused ? "[dream-skin] paused" : `[dream-skin] active theme ${loadedPayload.theme.id}`);
      }

      const activeIds = new Set(targets.map((target) => target.id));
      for (const id of targetFailures.keys()) {
        if (!activeIds.has(id)) targetFailures.delete(id);
      }
      for (const [id, session] of sessions) {
        if (!activeIds.has(id) || session.closed) {
          await removeEarlyPayload(session, earlyScripts.get(id));
          earlyScripts.delete(id);
          fallbackTargets.delete(id);
          fallbackListeners.delete(id);
          session.close();
          sessions.delete(id);
          targetFailures.delete(id);
        }
      }

      for (const target of targets) {
        if (identityAnchor.closed) break;
        if (sessions.has(target.id)) continue;
        if ((targetFailures.get(target.id)?.until ?? 0) > Date.now()) continue;
        let session;
        let earlyScriptId = null;
        try {
          session = await connectTarget(target, options.port);
          if (identityAnchor.closed) throw new CdpIdentityMismatchError("Original CDP browser identity closed");
          let earlyInjectionFallback = false;
          if (!paused) {
            try {
              earlyScriptId = await registerEarlyPayload(
                session,
                loadedPayload.payload,
                loadedPayload.fingerprint,
              );
              if (!earlyScriptId) throw new Error("CDP did not return an early-script identifier");
              await session.evaluate(earlyPayloadFor(loadedPayload.payload, loadedPayload.fingerprint));
            } catch (error) {
              await removeEarlyPayload(session, earlyScriptId);
              earlyScriptId = null;
              earlyInjectionFallback = true;
              console.error(`[dream-skin] early injection unavailable for ${target.id}: ${error.message}`);
            }
          }
          const probe = await waitForCodexProbe(session);
          if (!probe?.codex) {
            await removeEarlyPayload(session, earlyScriptId);
            rejectTarget(target, 5000);
            session.close();
            continue;
          }
          fallbackTargets.set(target.id, earlyInjectionFallback);
          if (earlyInjectionFallback) attachLoadFallback(target.id, target, session);
          if (identityAnchor.closed) throw new CdpIdentityMismatchError("Original CDP browser identity closed");
          let earlyApplied = false;
          if (!paused && !earlyInjectionFallback) {
            earlyApplied = await session.evaluate(
              `window.__CODEX_DREAM_SKIN_EARLY_APPLIED__ === ${JSON.stringify(loadedPayload.fingerprint)}`,
            ).catch(() => false);
          }
          if (paused) await removeFromSession(session);
          else if (!earlyApplied) await applyToSession(session, loadedPayload.payload);
          sessions.set(target.id, session);
          if (earlyScriptId) earlyScripts.set(target.id, earlyScriptId);
          targetFailures.delete(target.id);
          console.log(`[dream-skin] injected target ${target.id}`);
        } catch (error) {
          await removeEarlyPayload(session, earlyScriptId);
          fallbackTargets.delete(target.id);
          fallbackListeners.delete(target.id);
          session?.close();
          if (identityAnchor.closed || error instanceof CdpIdentityMismatchError) break;
          rejectTarget(target, 2500, error);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  } finally {
    identityAnchor.close();
    for (const [id, session] of sessions) {
      await removeEarlyPayload(session, earlyScripts.get(id));
      session.close();
    }
    earlyScripts.clear();
    fallbackTargets.clear();
    fallbackListeners.clear();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === "self-test") {
  const valid = validatedDebuggerUrl({ webSocketDebuggerUrl: `ws://127.0.0.1:${options.port}/devtools/page/test` }, options.port);
  const browserId = browserIdFromVersion({
    webSocketDebuggerUrl: `ws://127.0.0.1:${options.port}/devtools/browser/test-browser`,
  }, options.port);
  const invalid = [
    "ws://example.com/devtools/page/test",
    `ws://127.0.0.1:${options.port + 1}/devtools/page/test`,
    `wss://127.0.0.1:${options.port}/devtools/page/test`,
    `ws://user@127.0.0.1:${options.port}/devtools/page/test`,
    `ws://127.0.0.1:${options.port}/unexpected/test`,
    `ws://127.0.0.1:${options.port}/devtools/page/test?query=1`,
  ];
  for (const value of invalid) {
    let rejected = false;
    try { validatedDebuggerUrl({ webSocketDebuggerUrl: value }, options.port); } catch { rejected = true; }
    if (!rejected) throw new Error(`CDP URL validation accepted an unsafe URL: ${value}`);
  }
  const invalidBrowserUrls = [
    `ws://127.0.0.1:${options.port}/devtools/page/not-a-browser`,
    `ws://127.0.0.1:${options.port}/devtools/browser/bad%20id`,
    `ws://127.0.0.1:${options.port}/devtools/browser/test?query=1`,
  ];
  for (const value of invalidBrowserUrls) {
    let rejected = false;
    try { browserIdFromVersion({ webSocketDebuggerUrl: value }, options.port); } catch { rejected = true; }
    if (!rejected) throw new Error(`Browser identity validation accepted an unsafe URL: ${value}`);
  }
  const validPageTarget = {
    id: "page-test",
    type: "page",
    url: "app://codex/",
    webSocketDebuggerUrl: `ws://127.0.0.1:${options.port}/devtools/page/page-test`,
  };
  const invalidPageTargets = [
    { ...validPageTarget, webSocketDebuggerUrl: `ws://127.0.0.1:${options.port}/devtools/browser/page-test` },
    { ...validPageTarget, id: "other-page" },
    { ...validPageTarget, id: 123 },
    { ...validPageTarget, type: "other" },
  ];
  if (!valid || browserId !== "test-browser" || !isValidCdpPageTarget(validPageTarget, options.port) ||
      invalidPageTargets.some((item) => isValidCdpPageTarget(item, options.port))) {
    throw new Error("CDP URL and target validation self-test failed");
  }
  console.log(JSON.stringify({ pass: true, version: SKIN_VERSION, test: "loopback-cdp-validation" }));
  } else if (options.mode === "check-payload") {
    const loaded = await loadPayload(options.themeDir);
    const unresolved = [
      "__DREAM_CSS_JSON__", "__DREAM_ART_JSON__", "__DREAM_THEME_JSON__",
      "__DREAM_COMPONENTS_JSON__", "__DREAM_EXPERIENCE_JSON__",
    ]
      .some((placeholder) => loaded.payload.includes(placeholder));
    if (unresolved) {
      throw new Error("Payload placeholders were not fully replaced");
    }
    console.log(JSON.stringify({
      pass: true,
      version: SKIN_VERSION,
      payloadBytes: Buffer.byteLength(loaded.payload),
      themeId: loaded.theme.id,
      appearance: loaded.theme.appearance,
      art: loaded.theme.art,
      hasThemeCss: loaded.hasThemeCss,
      hasComponents: loaded.hasComponents,
      hasExperience: loaded.hasExperience,
      experienceVersion: loaded.experience?.schemaVersion ?? null,
      hasTaskComponents: Boolean(loaded.components?.task),
      hasChromeComponents: Boolean(loaded.components?.chrome),
      hasSidebarComponents: Boolean(loaded.components?.sidebar),
      hasStickerComponents: Boolean(loaded.components?.sticker),
      themeCssAssetCount: loaded.themeCssAssetCount ?? 0,
      payloadIncludesThemeCss: loaded.payload.includes("skin-codex-theme-css:"),
      payloadIncludesInlinedAssets: loaded.payload.includes("data:image/"),
      payloadIncludesComponents: loaded.payload.includes("skin-codex-bplus"),
      payloadIncludesThemeOverlays: Boolean(loaded.components?.chrome || loaded.components?.sidebar || loaded.components?.sticker) &&
        [loaded.components?.chrome?.title, loaded.components?.sidebar?.matches?.[0]?.title, loaded.components?.sticker?.caption]
          .filter(Boolean)
          .every((value) => loaded.payload.includes(JSON.stringify(value))),
      payloadIncludesExperience: Boolean(loaded.experience) &&
        loaded.payload.includes(JSON.stringify(loaded.experience)),
      artMetadata: loaded.theme.artMetadata ?? null,
    }));
  } else if (options.mode === "watch") await runWatch(options);
  else await runOneShot(options);
}

if (path.resolve(process.argv[1] || "") === path.resolve(scriptPath)) {
  main().catch((error) => {
    console.error(error?.stack ?? error?.message ?? String(error));
    process.exitCode = 2;
  });
}
