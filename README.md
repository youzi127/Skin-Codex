# Skin Codex

![Skin Codex interface example](./docs/images/skin-codex-shinchan-example.png)

一个面向 Codex Desktop 的开源本地主题开发工具。主题由 CSS、JSON 和本地图片组成，通过本机回环 CDP 加载；不修改官方应用文件、`app.asar` 或签名。


## 快速开始（Windows）

```powershell
cd windows
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-dream-skin.ps1
```

详细用法、主题包结构和样例见 [windows/README.md](./windows/README.md)。

## 简单使用

1. 安装后请从桌面或开始菜单的 **Skin Codex** 启动；它会连接已安装的 Codex Desktop，并在右下角保留主题托盘入口。
2. 右键托盘图标可应用或暂停皮肤、更换背景图、导入主题包、保存当前主题，以及在“已保存主题”中切换或删除主题。
3. 收到主题包时，选择 **导入主题包** 并选取 `.zip`；导入后会自动应用，也可以从“已保存主题”随时切换回来。
4. 开发自己的主题时，可从 `samples/theme-packs/sample-b-plus-minimal` 复制一份开始，或使用本地 `skin-codex-theme-dev` Skill；主题包只使用 `theme.json`、CSS、JSON 和本地图片，不包含可执行脚本。

## 开源边界

- 仅使用本机 `127.0.0.1` CDP；不修改官方 Codex 安装目录。
- 主题包不可执行 JavaScript；引擎只提供受限的声明式接口。
- 仓库仅附带抽象或原创技术样例；请在提交主题素材前确认再分发权利。
- 旧商业化实现保留在维护者本地，未包含在公开历史中。

## 许可证

[MIT](./LICENSE)。Skin Codex 不是 OpenAI 官方产品；Codex 及相关商标归其权利人所有。
