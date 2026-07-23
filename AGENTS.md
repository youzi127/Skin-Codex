# Repository Guidelines

Skin Codex is a Windows-only, open-source theme-development tool for Codex Desktop.

- Keep CDP bound to loopback only. Never modify WindowsApps, `app.asar`, official signatures, API keys, Base URLs, or model-provider settings.
- Theme packages contain only data, CSS, and local assets. Do not introduce executable theme JavaScript, remote CSS imports, or external asset URLs.
- Run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File windows\tests\run-tests.ps1` before submitting a change. It requires Node.js 22+ on `PATH`.
- Do not commit logs, generated releases, private screenshots, `auth.json`, API keys, tokens, private keys, or public-key trust stores.
- Before adding visual assets, confirm that they are original or that their redistribution rights are explicit.
