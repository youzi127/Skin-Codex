# Skin Codex

一个面向 Codex Desktop 的开源本地主题开发工具。主题由 CSS、JSON 和本地图片组成，通过本机回环 CDP 加载；不修改官方应用文件、`app.asar` 或签名。

当前公开的是纯开发版：不含商业 Runtime、加密/混淆实现、主题签名、公私钥或私有分发逻辑。你可以自由创建、编辑、导入和分享主题包。

## 快速开始（Windows）

```powershell
cd windows
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-dream-skin.ps1
```

详细用法、主题包结构和样例见 [windows/README.md](./windows/README.md)。

## 开源边界

- 仅使用本机 `127.0.0.1` CDP；不修改官方 Codex 安装目录。
- 主题包不可执行 JavaScript；引擎只提供受限的声明式接口。
- 仓库仅附带抽象或原创技术样例；请在提交主题素材前确认再分发权利。
- 旧商业化实现保留在维护者本地，未包含在公开历史中。

## 许可证

[MIT](./LICENSE)。Skin Codex 不是 OpenAI 官方产品；Codex 及相关商标归其权利人所有。
