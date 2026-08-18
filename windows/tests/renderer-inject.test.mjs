import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const windowsRoot = path.resolve(here, "..");
const css = await fs.readFile(path.join(windowsRoot, "assets", "dream-skin.css"), "utf8");
const renderer = await fs.readFile(path.join(windowsRoot, "assets", "renderer-inject.js"), "utf8");
const sampleRoot = path.join(windowsRoot, "samples", "theme-packs", "sample-b-plus-minimal");
const sampleTheme = JSON.parse(await fs.readFile(path.join(sampleRoot, "theme.json"), "utf8"));
const sampleComponents = JSON.parse(await fs.readFile(path.join(sampleRoot, "components.json"), "utf8"));
const sampleCss = await fs.readFile(path.join(sampleRoot, "theme.css"), "utf8");

assert.match(renderer, /skin-codex-message-content/, "Renderer must expose a stable message-content class.");
assert.match(renderer, /data-composer-surface-variant/, "Renderer must recognize the current semantic composer contract.");
assert.match(renderer, /skin-codex-composer-fade/, "Renderer must expose a stable interface for the native composer fade.");
assert.match(renderer, /skin-codex-bplus-home/, "Renderer must expose the B+ home module host.");
assert.match(css, /\.skin-codex-theme-sticker-bottom-end/, "Engine CSS must define the safe sticker anchor.");
assert.match(css, /pointer-events:\s*none/, "Decorative engine layers must not intercept native actions.");
assert.equal(sampleTheme.id, "sample-b-plus-minimal");
assert.equal(sampleTheme.components.file, "components.json");
assert.equal(sampleComponents.schemaVersion, 1);
assert.equal(sampleComponents.home.cards.length, 2);
assert.match(sampleCss, /prefers-reduced-motion/, "Sample must support reduced motion.");
assert.match(sampleCss, /:focus-visible/, "Sample must expose a keyboard focus treatment.");
assert.doesNotMatch(sampleCss, /https?:|@import|data:/i, "Sample CSS must stay local-only.");

console.log("PASS: renderer exposes stable declarative interfaces and the B+ sample is local-only.");
