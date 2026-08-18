import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const windowsRoot = path.resolve(here, "..");
const injector = path.join(windowsRoot, "scripts", "injector.mjs");
const themeRoot = path.join(windowsRoot, "samples", "theme-packs", "sample-b-plus-your-name");

const theme = JSON.parse(await fs.readFile(path.join(themeRoot, "theme.json"), "utf8"));
const components = JSON.parse(await fs.readFile(path.join(themeRoot, "components.json"), "utf8"));
const experience = JSON.parse(await fs.readFile(path.join(themeRoot, "experience.json"), "utf8"));
const css = await fs.readFile(path.join(themeRoot, "theme.css"), "utf8");
const background = await fs.stat(path.join(themeRoot, "background.png"));

assert.equal(theme.id, "sample-b-plus-your-name");
assert.equal(theme.image, "background.png");
assert.equal(theme.appearance, "light");
assert.equal(theme.art.safeArea, "left");
assert.equal(theme.components.file, "components.json");
assert.equal(theme.experience.file, "experience.json");
assert.ok(background.size > 100 * 1024, "The theme must include the generated full-window wallpaper.");

assert.equal(components.schemaVersion, 1);
assert.equal(components.home.cards.length, 4);
assert.match(components.home.title, /黄昏|相遇|名字/);
assert.equal(components.chrome.route, "home");
assert.equal(components.sticker, undefined);
assert.equal(experience.schemaVersion, 1);
assert.equal(experience.controls.feedback, "responsive");

assert.match(css, /skin-codex-bplus-hero/);
assert.match(css, /skin-codex-theme-chrome/);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /\.skin-codex-message-content::before\s*\{[\s\S]*?background:\s*linear-gradient\(/);
assert.match(css, /html:root\.codex-dream-skin\s*\{[\s\S]*?--dream-task-immersive-edge:\s*transparent;/);
assert.match(css, /--dream-immersive-composer:\s*rgba\(255,\s*252,\s*246,\s*\.86\);/);
assert.match(css, /\.skin-codex-composer\s*\{[\s\S]*?background:\s*rgba\(255,\s*252,\s*246,\s*\.86\)\s*!important;/);
assert.match(css, /\.dream-art-wide\s+\.composer-surface-chrome\s*\{[\s\S]*?backdrop-filter:\s*blur\(14px\)\s+saturate\(1\.03\)\s+brightness\(1\.05\)\s*!important;/);
assert.match(css, /\.dream-art-wide\s+\.dream-home-utility\s*\{[\s\S]*?backdrop-filter:\s*blur\(14px\)\s+saturate\(1\.03\)\s+brightness\(1\.05\)\s*!important;/);
assert.match(css, /body\s*\{[\s\S]*?background-image:\s*var\(--dream-art\)\s*!important;/);
assert.doesNotMatch(css, /body\s*\{[\s\S]*?background-image:\s*linear-gradient/);
assert.match(css, /skin-codex-thread\s*\{[\s\S]*?background:\s*transparent\s*!important;/);
assert.match(css, /dream-home:has\(> \.skin-codex-bplus\)\s*\{[\s\S]*?background:\s*transparent\s*!important;/);
assert.match(css, /\.dream-task\s*\{[\s\S]*?background:\s*transparent\s*!important;/);
assert.doesNotMatch(css, /@import|https?:\/\//i);

const result = await new Promise((resolve) => {
  const child = spawn(process.execPath, [injector, "--check-payload", "--theme-dir", themeRoot], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.once("close", (code) => resolve({ code, stdout, stderr }));
});

assert.equal(result.code, 0, result.stderr);
const payload = JSON.parse(result.stdout);
assert.equal(payload.themeId, theme.id);
assert.equal(payload.hasComponents, true);
assert.equal(payload.hasExperience, true);
assert.equal(payload.hasChromeComponents, true);
assert.equal(payload.hasStickerComponents, false);
console.log("PASS: Your Name B+ theme package is complete, local-only, and validator-compatible.");
