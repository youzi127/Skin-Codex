import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const packs = path.join(root, "samples", "theme-packs");
const tar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");

for (const id of ["sample-b-plus-minimal"]) {
  const zip = path.join(packs, `${id}.zip`);
  await fs.rm(zip, { force: true });
  execFileSync(tar, ["-a", "-c", "-f", zip, "-C", path.join(packs, id), "."], {
    stdio: "inherit",
    windowsHide: true,
  });
}
