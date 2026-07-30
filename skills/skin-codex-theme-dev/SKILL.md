---
name: skin-codex-theme-dev
description: Use when designing, creating, debugging, validating, or packaging Skin Codex A/B/B+ themes, especially for full-window backgrounds, stable Codex component styling, theme imports, visual regressions, duplicate artwork, opaque panels, white footer masks, or Codex update compatibility.
---

## Background veil boundary (mandatory)

- Distinguish a **text-local veil** from a **route-level wash**. A low-opacity blurred `::before` on `.skin-codex-message-content` is allowed when detailed art needs body-text protection. Keep it behind the text, non-interactive, and only a few pixels beyond the text block; it must not turn messages into cards.
- Never apply that veil to `body`, `main.main-surface`, `.skin-codex-thread`, a route container, or a full scrolling region. Outside the immediate text area, the wallpaper must remain visually continuous.
- Before changing colors, inspect computed styles for `main.main-surface` and its pseudo-elements. If an engine immersive gradient causes a whole-page white wash, neutralize the relevant immersive variables at the theme root (for example `--dream-immersive-*` and `--dream-task-immersive-*`) instead of deleting the local text veil or adding an opaque competing panel.
- After hot update, verify both layers: the route-level surface is visually transparent over the single wallpaper source, and `.skin-codex-message-content::before` exists only around the text.

## Composer frosted lens (mandatory on detailed art)

- Treat the composer and its paired project/context utility bar as one local reading surface. Preserve their theme-specific color, border, corner shape, and controls; tune only their opacity and lens treatment unless the user requests a redesign.
- Do not choose between plain transparency and a fully opaque white panel. On busy or high-contrast artwork, use a high-opacity tinted surface (normally about `.82`–`.90`) with `backdrop-filter: blur(14px) saturate(1.03) brightness(1.05)`. It should conceal recognisable background detail while retaining a restrained frosted-glass depth.
- In wide-art mode, inspect computed styles. The engine may set `.composer-surface-chrome { backdrop-filter: none }`; a theme that declares blur only on `.skin-codex-composer` will therefore still render as a flat panel. Restore the lens with narrowly scoped overrides for both `.dream-art-wide .composer-surface-chrome` and `.dream-art-wide .dream-home-utility`.
- Verify with a screenshot over a high-detail, high-contrast part of the artwork, and record computed `background` plus `backdrop-filter` for both surfaces. Do not judge opacity from CSS source alone.

## 当前默认 UI 基线（可由明确设计需求覆盖）

- 主题迭代默认**保留已确认的组件语言**，不要因为引擎增加接口就顺带把界面改成另一种产品风格。引擎升级负责扩展能力；主题 CSS 和配置决定外观，二者应可独立回退。
- 不把圆角轻拟态、胶囊控件、渐变侧栏、圆形发送按钮或“行动台”式排版当作默认升级方向。先从题材推导轮廓、边角、层次、阴影、主操作和动效；只有题材支持时才采用这些表现。
- 小新主题当前以“漫画手账”作为确认基线：红/黄/深墨主操作，偏方角的小圆角，清晰的漫画描边和错位投影；侧栏选中项、输入框、发送按钮、首页卡片与弹窗要使用同一套语言。不要无明确要求地将其改成圆形按钮、细描边玻璃卡或柔和行动台。
- 聊天正文默认保持 Codex 原生阅读节奏，不将每条用户或助手消息改成卡片。复杂背景优先通过背景安全区和构图解决；允许在 `.skin-codex-message-content` 下方使用低透明、局部、不可交互的轻纱来保护正文，但它不得扩展到正文容器、会话区、路由或全窗口。完整代码块保持中性面板，`code` 与语法 `span` 必须透明，不能逐词铺黄色底。行内代码可使用题材化的轻量强调。
- 首页可以使用 B+ Hero、卡片、chrome、sidebar 图标和 sticker 等可选接口；普通聊天页不得默认添加永久横幅或占用会话可视高度的主题组件。只有用户明确要求且完成不遮挡验证时才展示。

# Skin Codex 主题开发

## 核心原则

固定开发流程和安全边界，不固定视觉答案。配色、字体、圆角、间距、透明度、边框、阴影、动效和组件尺寸必须根据当前主题重新设计，不得从示例主题照搬为默认值。尤其不要把黑框、深色描边或粗描边沉淀为通用视觉规则；只有当前主题语言和具体组件层级都需要时才使用。

主题包只声明数据、CSS 和本地图片。可信 JS 仅属于 Skin Codex 引擎；主题包不得携带或执行 JS。

## 开始前

1. 定位 Skin Codex 源码或已安装引擎，不要假设固定盘符。源码优先；运行态通常位于 `%LOCALAPPDATA%\SkinCodex`。
2. 阅读当前引擎的主题校验器、renderer 适配层和样例包。以代码中的当前契约为准，不凭记忆编字段。
3. 明确用户要的是纯背景、组件换肤，还是新增受信任的首页模块。
4. 默认按**本地自用主题**处理：真人、品牌、影视/动漫角色和公开可见素材不以授权核验作为开发阻塞条件。只有用户明确要公开发布、分享、随仓库分发或商业交付时，才提示其核对相应权利与来源；不要自行把本地创作改成“原创替代物”。

需要文件格式与 schema 时读 [package-contract.md](references/package-contract.md)。需要可用选择器时读 [stable-component-api.md](references/stable-component-api.md)。当背景复杂、文字被吞没、黑字压在深色图案上，或需要设计低干扰阅读保护时，进入“文字可读性决策”并读 [text-readability.md](references/text-readability.md)。

当用户要求主题不止换色/换背景，而要重塑按钮、选择器、卡片、状态反馈或微交互时：先使用 `ui-ux-pro-max` 获取与产品语境匹配的交互模式或设计系统建议；再使用 `new-ui` 形成组件状态、动效目的和视觉验收方案。两者只提供设计决策，不复制进本 Skill；稳定组件接口、主题包约束、CSS 落地和导入验证仍由本 Skill 负责。

## 选择主题等级

| 等级 | 适用目标 | 文件 |
|---|---|---|
| A | 背景、明暗模式、焦点、安全区和强调色 | `theme.json` + 背景图 |
| B | A + 原生 Codex 组件视觉重设计 | A + `theme.css` + 可选 `assets/` |
| B+ | B + 引擎支持的首页/任务页声明式模块，或内容体验语义层 | B + 可选 `components.json` / `experience.json` |

选择满足需求的最低等级。不要为了“高级”空加 `components.json`，也不要在 A 主题里假装 CSS 会生效。

## 工作流

### 1. 建立视觉概念

- 提炼主题情绪、受众、工作场景、信息密度和可读性目标。
- 定义背景主体、视觉焦点、留白区和窄窗口裁切策略。
- 先给出视觉方向，再决定参数；不要预设某种粉色、玻璃、圆角或卡片语言。
- 把概念效果图当参考，不当成可直接导入的主题背景。

### 2. 制作纯背景和独立素材

- 背景必须是连续、铺满画布的纯视觉资产，不烘焙 Codex 界面、输入框、按钮、侧栏、可读文案或水印。
- 首页 Hero、卡片图标和装饰图使用 `assets/` 中的独立文件；不要把所有元素压进一张背景图。
- 需要生成图片时优先使用可用的 `imagegen` 能力，并按实际窗口比例生成；生成后检查文字、手部、透视、重复人物和边缘连续性。
- 对动漫、影视、真人或品牌题材：用户允许时，可先从公开参考图确认经典构图与氛围，再以 Image 2 生成适配 Skin Codex 的二次创作背景；不要把参考图中已有的 UI、文字或水印直接带入主题。若用户要求“先看看”，先生成预览图并展示，获得确认后再制作主题包。
- Image 2 生成成功后，保存生成时间、提示词、模型和输出路径的溯源记录；选定素材再复制到主题包。主题内只引用本地最终文件，不保留远程图片链接。
- 背景只承担环境和氛围，真实界面文字与交互继续由 DOM 渲染。

### 3. 先实现最小可导入包

- 先完成有效 `theme.json` 和背景图，并验证 A 级主题可以导入、切换、恢复。
- 再逐层增加 `theme.css`、`components.json` 和可选 `experience.json`。每增加一层立即验证，避免把导入失败、DOM 适配和视觉问题混在一起。
- `id` 要稳定且唯一；同一主题升级沿用相同 ID，避免重复目录和资源垃圾。

### 4. 设计 B/B+ 组件

- 只把 `.skin-codex-*` 当公开组件接口。原生哈希类、Tailwind 工具类和脆弱 DOM 层级只能用于诊断，不应成为新主题的长期契约。
- 当 B+ 首页提供自己的 Hero 或行动卡时，必须去除与其重叠的原生首页提示和建议卡。主题 CSS 只能使用引擎提供的 `.skin-codex-home-cards`、`.skin-codex-native-home-intro`、`.skin-codex-native-home-heading`、`.skin-codex-native-home-prompt` 等稳定语义类；不得以项目名、中文/英文原生文案、`data-feature`、生成类名或内部 DOM 层级作为隐藏条件。缺少语义类时，先在 renderer 中补接口与清理逻辑并写回归测试，再写主题 CSS。
- 需要让主题在代码、引用、表格、提示、命令输出、工具结果、文件引用和控件反馈上形成不同体验时，优先使用 `experience.json` 的语义接口和中性变体，再由 CSS 定义题材化表现；不要把具体主题风格写进通用引擎。
- 若目标元素没有稳定类，先在引擎 renderer 适配层增加保守识别、稳定类、清理逻辑和测试，再让主题使用新接口。
- 保留 Codex 的原生文案、点击行为、键盘操作、焦点和滚动逻辑。主题 CSS 只改变表现。
- 不把每条用户/AI 消息包装成卡片，除非当前视觉需求明确要求；默认保护正文阅读节奏。
- 差异卡、工具卡和文件变更卡默认保持轻量：不要沿用历史主题的黑色或深色外框；只有信息分组确有必要时才按当前主题加入低对比边界。
- 需要增强组件手感时，先定义操作层级与 `default`、`hover`、`focus-visible`、`pressed`、`selected`、`disabled` 状态；动效只解释状态变化，优先 `transform` 和 `opacity`，并支持 `prefers-reduced-motion`。设计方法委托给 `new-ui`，模式检索委托给 `ui-ux-pro-max`。
- 先通过背景安全区和局部正文轻纱解决可读性；允许 `.skin-codex-message-content` 使用低透明、局部、可撤回的伪元素保护层。`body`、首页、聊天路由、任务路由和会话滚动区不得用浅色渐变、半透明白底或重复背景图再洗白整张原图；不要把描边或重阴影当作默认答案。
- 首页增强只在首页显示；聊天页不得永久占用横幅空间，除非需求明确且已验证不会压缩会话和输入区。

### 5. 建立单一背景源

- 先决定唯一背景绘制层，通常为整窗 `body`。
- 侧栏、标题栏、聊天区、输入区和工具卡只提供透明或半透明可读性层，不得各自重新绘制同一背景。
- 主题的 `body` 只保留单一 `--dream-art` 背景源；首页、聊天路由、会话滚动区和任务路由默认透明。关闭重复背景的伪元素、Hero 残留、任务氛围图和路由级浅色渐变，避免背景被二次叠加成白雾。
- 背景是否连续必须在侧栏与主区交界、标题栏、窗口底部和滚动状态中验证，不能只看首页截图。

### 6. 证据优先调试

出现白边、重复人物、背景断层、组件没变化或只在某个任务生效时，不要连续试色值。先通过 CDP 检查：

1. 元素和祖先的 `getBoundingClientRect()`。
2. `background`、`background-image`、`box-shadow`、`border`、`backdrop-filter` 和 `opacity`。
3. `::before`、`::after`。
4. 边界内外点的 `elementsFromPoint()`。
5. 目标规则是否实际匹配、是否被作用域条件排除。

完整排查方法见 [diagnostics.md](references/diagnostics.md)。

### 7. 热更新与视觉验收

- 同步到已安装主题和 `active-theme` 后，让现有 watcher 热更新；不要把重启 Codex 当作第一验证手段。
- 同时检查首页、已有聊天、新聊天、长聊天、工具调用、文件变更卡、菜单、弹窗和输入框多行状态。
- 检查正常、悬浮、聚焦、选中、禁用和滚动状态。
- 至少验证宽屏和窄窗口；确认控件不重叠、不被裁切、文字不溢出。复杂背景主题还要按 `text-readability.md` 验证浅色、深色和高纹理区域。
- 对含 B+ 首页的主题，确认 B+ Hero、卡片与输入区仍可见且可操作；原生项目提示节点 `.skin-codex-native-home-prompt` 已按主题意图隐藏，不得与 B+ 内容重叠。用计算样式和不同项目名复验，不能只依赖截图。
- 截图只能证明结果外观；同时记录关键元素的计算样式，证明问题层已真正消失。

完整验收表见 [acceptance-checklist.md](references/acceptance-checklist.md)。

### 8. 打包交付

- ZIP 中只放一个主题根目录或直接放一套主题文件，且只能有一个 `theme.json`。
- 验证包内无 `.js`、脚本、外链、`@import`、绝对路径、目录穿越、链接或无引用大文件。
- 从最终 ZIP 执行一次真实导入，而不是只测试源码目录。
- 重复导入相同 ID 应覆盖升级，不产生新主题副本。

## 不可跨越的边界

- 不允许 `theme.js`、内联脚本、事件处理器或任意代码执行。
- 不允许 CSS 外链、远程字体、`@import`、`http:`、`https:`、`file:`、`data:` 或 `javascript:` 资源。
- 不替换 Codex 业务页面、模型请求、文件操作或点击逻辑。
- 不隐藏发送、权限、模型、附件、设置、窗口控制等关键控件。
- 不用 `!important` 掩盖未知根因；只有在确认级联来源后，才在最窄作用域使用。
- 不把当前 Codex DOM 的偶然结构当永久接口。适配变化集中修引擎，不批量重做已售主题。
- 不承诺像素级复刻概念图中不存在于 Codex 的业务功能；先区分视觉层、引擎声明式模块和真正产品功能。

## 完成标准

只有同时满足以下条件才可称为完成：主题可从 ZIP 导入；A/B/B+ 兼容边界正确；无可执行文件；背景单源且连续；关键 Codex 控件可用；多个路由和窗口尺寸通过；计算样式与截图验证通过；可切换到其他主题并恢复官方外观。
