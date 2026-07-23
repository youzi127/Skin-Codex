# Skin Codex Development Edition (Windows)

Skin Codex loads editable themes into the official Codex Windows desktop app through loopback CDP. It does not modify `WindowsApps`, `app.asar`, or the official application signature.

This is the development edition: theme packages use `theme.json`, CSS, JSON, and local images. They can be edited, imported, and hot-reloaded without public keys, private keys, theme signing, or a commercial runtime.

## Requirements

- The official Microsoft Store `OpenAI.Codex` app registered for the current user.
- Windows PowerShell 5.1 or newer.
- Node.js 22+ available on `PATH`.

## Install and launch

Run in this directory:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-dream-skin.ps1
```

Launch with the **Skin Codex** shortcut created on the Desktop and Start Menu. The scripts listen only on `127.0.0.1` and ask before restarting an existing Codex window.

Verify an active session:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-dream-skin.ps1 `
  -ScreenshotPath "$env:TEMP\skin-codex.png"
```

## Theme development

Import a theme directory or ZIP package from the tray menu, or start from:

- `samples/theme-packs/sample-b-plus-minimal`: a declarative B+ component sample without people or third-party character assets.

Theme packages never contain JavaScript. The engine exposes restricted, stable declarative component interfaces; CSS, JSON, and local assets control visual expression.

Rebuild sample ZIPs:

```powershell
node .\scripts\package-sample-themes.mjs
```

## Restore

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\restore-dream-skin.ps1 `
  -RestoreBaseTheme -PromptRestart
```

Add `-Uninstall` to remove shortcuts created by Skin Codex.

## Security boundaries

- CDP binds only to `127.0.0.1`.
- The tool does not modify the official Codex installation, `app.asar`, or signatures.
- It does not write API keys, Base URLs, or model-provider configuration.
- Themes are local-only; CSS may not use remote `@import` or external URLs.

## License

MIT; see `LICENSE` at the repository root. Skin Codex is not an OpenAI product. Codex and related trademarks belong to their respective owners.
