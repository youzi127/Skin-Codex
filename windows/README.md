# Skin Codex 开发版（Windows）

Skin Codex 通过本机回环 CDP 将可编辑主题加载到官方 Codex Windows 桌面应用。它不修改 `WindowsApps`、`app.asar` 或官方应用签名。

这是纯开发版：主题包由 `theme.json`、CSS、JSON 和本地图片组成，可直接编辑、导入和热更新；不需要公钥、私钥、主题签名或商业 Runtime。

## 要求

- 已安装并注册到当前用户的官方 Microsoft Store `OpenAI.Codex` 应用。
- Windows PowerShell 5.1 或更新版本。
- Node.js 22+，可从 `PATH` 找到。

## 安装与启动

在本目录运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-dream-skin.ps1
```

安装完成后使用桌面或开始菜单的 **Skin Codex** 快捷方式启动。脚本仅监听 `127.0.0.1`，并在需要重启已打开的 Codex 时请求确认。

## 日常使用

从 **Skin Codex** 启动后，右下角会出现托盘图标。右键图标可完成：

- **应用或重新应用 / 暂停皮肤**：控制当前主题是否显示。
- **更换背景图**：快速把当前主题替换为一张本地背景图。
- **导入主题包**：选择主题目录或 `.zip` 包，导入后自动应用。
- **保存当前主题 / 已保存主题 / 删除主题**：保存当前配置、切换已保存主题或管理不再需要的主题。
- **完全恢复 Codex**：移除皮肤效果并恢复官方外观。

开发主题可从 `samples/theme-packs/sample-b-plus-minimal` 复制一份开始；若在 Codex 中工作，可使用本地 `skin-codex-theme-dev` Skill 创建、调试、验证和打包主题。主题包仅由 `theme.json`、CSS、JSON 与本地图片组成，不携带 JavaScript 或其他可执行文件。

验证当前会话：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-dream-skin.ps1 `
  -ScreenshotPath "$env:TEMP\skin-codex.png"
```

## 开发主题

可直接从托盘导入主题目录或 ZIP 包，也可从以下样例开始：

- `samples/theme-packs/sample-b-plus-minimal`：不含人物或第三方角色素材的 B+ 声明式组件样例。

主题包不包含 JavaScript。引擎提供受限、稳定的声明式组件接口；视觉表现由 CSS、JSON 和本地素材决定。

重新生成样例 ZIP：

```powershell
node .\scripts\package-sample-themes.mjs
```

## 恢复

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\restore-dream-skin.ps1 `
  -RestoreBaseTheme -PromptRestart
```

加上 `-Uninstall` 会一并删除 Skin Codex 创建的快捷方式。

## 安全边界

- CDP 只绑定 `127.0.0.1`。
- 不修改官方 Codex 安装目录、`app.asar` 或签名。
- 不写入 API Key、Base URL 或模型提供商配置。
- 仅使用本地主题文件；主题 CSS 不允许远程 `@import` 或外部 URL。

## 许可证

MIT，见仓库根目录的 `LICENSE`。Skin Codex 不是 OpenAI 官方产品；Codex 和相关商标归其权利人所有。
