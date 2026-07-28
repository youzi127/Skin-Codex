import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const windowsRoot = path.resolve(here, "..");

async function exists(relativePath) {
  try {
    await fs.access(path.join(windowsRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

for (const relativePath of [
  "installer/CodexDreamSkinCommercial.iss",
  "scripts/build-commercial-runtime.mjs",
  "scripts/commercial-runtime-entry.cjs",
  "scripts/generate-theme-keypair.mjs",
  "scripts/prepare-commercial-distribution.mjs",
  "scripts/sign-theme-package.mjs",
  "scripts/theme-integrity.mjs",
  "tests/commercial-distribution.test.mjs",
  "tests/commercial-installer-contract.test.mjs",
  "tests/commercial-launcher-contract.test.mjs",
  "tests/commercial-runtime.test.mjs",
  "tests/commercial-theme-import.test.mjs",
  "tests/commercial-theme-loader.test.mjs",
  "tests/theme-integrity.test.mjs",
  "tests/theme-signing-cli.test.mjs",
]) {
  assert.equal(await exists(relativePath), false, `Open-source development edition must not include ${relativePath}.`);
}

for (const relativePath of [
  "scripts/common-windows.ps1",
  "scripts/start-dream-skin.ps1",
  "scripts/theme-windows.ps1",
  "scripts/tray-dream-skin.ps1",
  "scripts/verify-dream-skin.ps1",
  "scripts/import-theme-pack.ps1",
  "scripts/install-dream-skin.ps1",
  "scripts/launch-hidden.vbs",
  "scripts/injector.mjs",
]) {
  const source = await fs.readFile(path.join(windowsRoot, relativePath), "utf8");
  assert.doesNotMatch(
    source,
    /CommercialRuntimePath|SkinCodexRuntime\.exe|--trusted-keys|--private-key|require-signed-theme|theme-integrity/i,
    `Open-source development script still has commercial signing/runtime logic: ${relativePath}`,
  );
}

for (const restrictedPack of [
  "samples/theme-packs/sample-b-plus-kun",
  "samples/theme-packs/sample-b-plus-shinchan",
  "themes/preset-romantic-rose",
]) {
  assert.equal(await exists(restrictedPack), false, `Restricted demonstration material must not ship publicly: ${restrictedPack}`);
}

assert.equal(await exists("samples/theme-packs/sample-b-plus-minimal/theme.json"), true, "Development edition must retain an editable B+ sample.");
assert.equal(await exists("samples/theme-packs/sample-b-plus-minimal/components.json"), true, "Development edition must retain a declarative B+ component example.");

const traySource = await fs.readFile(path.join(windowsRoot, "scripts", "tray-dream-skin.ps1"), "utf8");
assert.match(
  traySource,
  /\$AiModelAccessUrl\s*=\s*['"]https:\/\/useaifor\.me\/register\?aff=J7F65KDMA542['"]/,
  "The open-source tray must keep the disclosed AI model access destination in source control.",
);
assert.match(
  traySource,
  /-Text\s+['"]AI 模型接入['"][\s\S]{0,500}?Start-Process\s+-FilePath\s+\$AiModelAccessUrl/s,
  "The tray must expose an AI model access item that opens the configured destination in the default browser.",
);

console.log("PASS: public development edition excludes commercial signing/runtime paths and restricted demonstration packs.");
