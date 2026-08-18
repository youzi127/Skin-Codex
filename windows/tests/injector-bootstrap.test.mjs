import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { earlyPayloadFor } from "../scripts/injector.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const injectorPath = path.resolve(here, "../scripts/injector.mjs");
const source = await fs.readFile(injectorPath, "utf8");

function createFixture() {
  const observers = [];
  const timers = new Map();
  let nextTimer = 1;
  const markers = { shell: false, modernShell: false, sidebar: false, main: false };
  const context = {
    window: { installs: [] },
    document: {
      documentElement: {},
      body: {},
      querySelector(selector) {
        if (selector === "main.main-surface") return markers.shell ? {} : null;
        if (selector === 'main[data-app-shell-main-surface], main.main-surface') {
          return markers.shell || markers.modernShell ? {} : null;
        }
        if (selector === ".app-shell-left-panel") return markers.sidebar ? {} : null;
        if (selector === '[role="main"]') return markers.main ? {} : null;
        if (selector.includes(".app-shell-left-panel") || selector.includes('[role="main"]')) {
          return markers.sidebar || markers.main ? {} : null;
        }
        return null;
      },
    },
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.connected = true;
        observers.push(this);
      }
      observe() {}
      disconnect() { this.connected = false; }
    },
    setTimeout(callback) {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  };
  return { context, markers, observers };
}

const guarded = createFixture();
vm.runInNewContext(earlyPayloadFor('window.installs.push("guarded")', "guarded"), guarded.context);
assert.deepEqual(guarded.context.window.installs, [], "Auxiliary app targets must remain untouched.");
guarded.markers.shell = true;
guarded.observers[0].callback([]);
assert.deepEqual(guarded.context.window.installs, [], "A main surface without a Codex UI marker is not sufficient.");
guarded.markers.main = true;
guarded.observers[0].callback([]);
assert.deepEqual(guarded.context.window.installs, ["guarded"], "The guarded payload should install once the shell is complete.");

const modernShell = createFixture();
vm.runInNewContext(earlyPayloadFor('window.installs.push("modern")', "modern"), modernShell.context);
modernShell.markers.modernShell = true;
modernShell.markers.sidebar = true;
modernShell.observers[0].callback([]);
assert.deepEqual(
  modernShell.context.window.installs,
  ["modern"],
  "The early payload must recognize Codex's current semantic main-surface attribute, not only its retired CSS class.",
);

const generations = createFixture();
vm.runInNewContext(earlyPayloadFor('window.installs.push("old")', "old"), generations.context);
vm.runInNewContext(earlyPayloadFor('window.installs.push("new")', "new"), generations.context);
generations.markers.shell = true;
generations.markers.sidebar = true;
for (const observer of generations.observers) observer.callback([]);
assert.deepEqual(
  generations.context.window.installs,
  ["new"],
  "A stale early script must yield to the newest watcher generation.",
);
assert.equal(generations.context.window.__CODEX_DREAM_SKIN_EARLY_APPLIED__, "new");

const registrationStart = source.indexOf("earlyScriptId = await registerEarlyPayload");
const evaluateStart = source.indexOf("await session.evaluate(earlyPayloadFor", registrationStart);
const probeStart = source.indexOf("const probe = await waitForCodexProbe", registrationStart);
assert.ok(registrationStart >= 0 && evaluateStart > registrationStart && probeStart > evaluateStart,
  "New targets must register and run the early payload before full shell probing.");
assert.match(source, /if \(earlyInjectionFallback\) attachLoadFallback\(/,
  "Load-event reinjection must be attached only when early injection falls back.");
assert.match(source, /if \(!fallbackTargets\.get\(id\)\) return;/,
  "Fallback listeners must stay inert after a successful early registration.");
assert.match(source, /Page\.removeScriptToEvaluateOnNewDocument/,
  "Watcher shutdown and theme refresh must unregister persistent Page scripts.");

console.log("PASS: Windows early injection is shell-guarded, generation-safe, ordered before probing, and fallback-scoped.");
