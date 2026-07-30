# Skin Codex

![Skin Codex interface example](./docs/images/skin-codex-shinchan-example.png)

An open-source local theme-development tool for Codex Desktop. Themes use CSS, JSON, and local images and load through loopback CDP; the project does not modify official application files, `app.asar`, or signatures.

The public repository is the development edition only: no commercial runtime, encryption/obfuscation implementation, theme signing, public/private keys, or private distribution logic. You can create, edit, import, and share theme packages freely.

## Exclusive sponsor

<p align="center">
  <a href="https://useaifor.me/register?aff=J7F65KDMA542">
    <img src="docs/images/sponsor-useaifor.svg" alt="useaifor.me" height="72">
  </a>
</p>

<p align="center">
  <strong>AI model access · Build without interruption</strong><br>
  <sub>Flexible model access · OpenAI-compatible clients</sub>
</p>

<p align="center">
  Thanks to <a href="https://useaifor.me/register?aff=J7F65KDMA542"><strong>useaifor.me</strong></a> for supporting this project.<br>
  An AI model access service for developers who use OpenAI-compatible clients.
</p>

<p align="center">
  <sub>Theme installation and API configuration stay separate; this project never rewrites your provider settings.</sub>
</p>

## Quick start (Windows)

```powershell
cd windows
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-dream-skin.ps1
```

See [windows/README.en.md](./windows/README.en.md) for usage, package structure, and samples.

For authoring a theme, start from `samples/theme-packs/sample-b-plus-minimal` or use the included [`skin-codex-theme-dev` skill](./skills/skin-codex-theme-dev/). Theme packages contain only `theme.json`, CSS, JSON, and local images—never executable scripts.

## Open-source boundaries

- Uses loopback `127.0.0.1` CDP only; never modifies the official Codex installation.
- Theme packages cannot execute JavaScript; the engine exposes restricted declarative interfaces only.
- The repository includes only abstract or original technical samples. Confirm redistribution rights before contributing visual assets.
- The earlier commercial implementation is retained locally by the maintainer and is not in the public history.

## License

[MIT](./LICENSE). Skin Codex is not an OpenAI product. Codex and related marks belong to their respective owners.
