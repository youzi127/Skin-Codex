# Experience Engine v1

`theme.json` can optionally declare `"experience": { "file": "experience.json" }`. The engine owns parsing and DOM mapping; the theme supplies only JSON, CSS, and local assets.

- Content interfaces: `.skin-codex-code-block`, `.skin-codex-inline-code`, `.skin-codex-quote`, `.skin-codex-table`, `.skin-codex-callout`, `.skin-codex-command-output`, `.skin-codex-tool-result`, `.skin-codex-file-reference`.
- A declared content entry receives neutral modifiers: `.skin-codex-surface-plain|soft|raised` and `.skin-codex-density-compact|comfortable|spacious`.
- When the file is enabled, `<html>` receives `.skin-codex-experience` plus one feedback class: `.skin-codex-control-feedback-quiet|responsive|expressive`. Eligible existing controls receive `.skin-codex-control`.
- Keep selectors scoped to these semantic classes. Do not use the modifier classes as a page-layout system, and do not depend on internal component hierarchy.
- Omit `experience` when a theme needs none of these contracts; old themes remain fully compatible.

# 稳定组件接口

主题 CSS 优先使用 renderer 注入的稳定类。使用前读取当前 `renderer-inject.js` 的组件类清单；以下是当前契约。

## 应用与路由

- `.skin-codex-shell`：主应用表面。
- `.skin-codex-sidebar`：左侧导航与任务历史。
- `.skin-codex-sidebar-item`：侧栏行。
- `.skin-codex-sidebar-item-active`：当前侧栏行。
- `.skin-codex-route`：当前主路由。
- `.skin-codex-home`：首页路由。
- `.skin-codex-chat`：聊天/任务路由。
- `.skin-codex-header`：主标题栏。
- `.skin-codex-header-button`：标题栏按钮。
- `.skin-codex-settings-button`：设置入口。

## 首页

- `.skin-codex-home-cards`：原生首页建议卡容器。
- `.skin-codex-home-card`：单个原生建议卡。
- `.skin-codex-native-home-intro`：原生首页欢迎区容器；用于在 B+ 自有 Hero 存在时隐藏重复的原生欢迎内容，同时保留安全的页面布局。
- `.skin-codex-native-home-heading`：原生首页标题的兼容兜底接口，不包含 B+ 模块标题。
- `.skin-codex-native-home-prompt`：原生的项目相关首页提示语。B+ 自有 Hero 存在时可通过此接口隐藏，不能让主题直接匹配项目名、原生文案、`data-feature` 或 Codex 内部类名。
- `.skin-codex-bplus` / `.skin-codex-bplus-hero` 等：引擎拥有的 B+ 首页模块。
- `.skin-codex-bplus-task`：可选 B+ 任务页模块。
- `.skin-codex-theme-chrome`：可选、不可交互的顶部品牌装饰；子元素为 `-icon`、`-copy`、`-title`、`-subtitle`、`-badge`。
- `.skin-codex-sidebar-icon`：由 `components.sidebar` 加在真实侧栏条目上的纯装饰图标。
- `.skin-codex-theme-sticker`：可选、不可交互的路由贴纸；带 `-home|-chat`、`-top-start|-top-end|-bottom-start|-bottom-end` 及 `-small|-medium|-large` 修饰类。

### B+ 首页去重约束

当 B+ 首页承载主题自己的 Hero、行动卡或引导文案时，主题 CSS 只能基于上述稳定类去隐藏重复的原生内容。不要使用具体项目名、中文或英文原生提示、`data-feature`、哈希/Tailwind 类或 DOM 兄弟层级作为选择器；这些属于运行时实现细节。若当前接口无法识别某类重复原生内容，应先扩展 renderer 的语义映射、注册清理类并添加 DOM 重建回归测试。

## 会话

- `.skin-codex-thread`：会话滚动区。
- `.skin-codex-turn`：会话轮次。
- `.skin-codex-message`：消息容器。
- `.skin-codex-message-user`：用户消息。
- `.skin-codex-message-assistant`：AI 消息。
- `.skin-codex-message-content`：真实 Markdown 文本内容层；用于低干扰的内容级可读性保护。不要把整条 `.skin-codex-message` 当作纱雾层，因为它通常跨整行。
- `.skin-codex-code-block`：代码/预格式块。
- `.skin-codex-tool-card`：工具调用卡。
- `.skin-codex-diff-card`：文件变更卡。

默认不要重排 `.skin-codex-turn` 或给每条消息加框。需要改变正文呈现时，先确认用户明确要求，并验证长文本、代码块和工具卡。

## 输入与浮层

- `.skin-codex-composer`：原生输入表面。
- `.skin-codex-composer-action`：输入区操作按钮。
- `.skin-codex-attachment-button`：附件按钮。
- `.skin-codex-access-selector`：权限选择器。
- `.skin-codex-model-selector`：模型选择器。
- `.skin-codex-send-button`：发送/停止按钮。
- `.skin-codex-dialog`：对话框。
- `.skin-codex-menu`：弹出菜单。

## 缺少接口时

1. 不在主题中长期依赖哈希类、工具类或 `nth-child`。
2. 在 renderer 中用语义属性和保守结构识别目标元素。
3. 添加新的 `.skin-codex-*` 类，并加入统一清理列表。
4. 覆盖路由切换、DOM 重建和恢复官方外观测试。
5. 再在主题 CSS 中使用新接口。

宁可让未知组件保持官方样式，也不要误标并破坏无关界面。

## CSS 作用域

- 所有主题规则以 `html.codex-dream-skin` 开始。
- 进一步按 `.skin-codex-home`、`.skin-codex-chat` 或组件类收窄。
- `!important` 只用于覆盖已确认的原生规则，不能代替根因分析。
- 响应式规则依据容器和布局需求编写，不把某个样例窗口坐标固定成产品契约。
