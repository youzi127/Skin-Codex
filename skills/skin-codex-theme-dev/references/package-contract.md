# 主题包契约

以当前引擎校验代码为最终依据。若源码和本文冲突，先更新本文，再按源码执行。

## 目录

```text
theme-id/
  theme.json
  background.png|jpg|jpeg|webp
  theme.css             # B/B+ 可选
  components.json       # B+ 可选
  experience.json       # Experience Engine v1 可选
  assets/               # CSS 或 components.json 使用的本地素材
```

主题包不得包含 JS。ZIP 中只能解析出一套 `theme.json`。

## theme.json

```json
{
  "schemaVersion": 1,
  "id": "stable-theme-id",
  "name": "主题显示名",
  "image": "background.png",
  "appearance": "auto",
  "art": {
    "focusX": null,
    "focusY": null,
    "safeArea": "auto",
    "taskMode": "auto"
  },
  "style": {
    "css": "theme.css"
  },
  "components": {
    "file": "components.json"
  },
  "experience": {
    "file": "experience.json"
  }
}
```

- `id`：小写字母、数字、点、下划线或短横线；保持稳定。
- `appearance`：`auto`、`light`、`dark`。
- `focusX` / `focusY`：0 到 1；根据构图决定，不设通用默认视觉答案。
- `palette.accent`：可选；需要时由当前主题的视觉系统决定，不在流程模板中预填颜色。
- `safeArea`：`auto`、`left`、`right`、`center`、`none`。
- `taskMode`：`auto`、`ambient`、`banner`、`off`。
- A 主题省略 `style` 和 `components`；B 省略 `components`。

## experience.json

`experience` 是可选的声明式内容体验层；不能包含 HTML、脚本或任意页面布局。文件为 schema 1，大小为 2 B 到 12 KB，且仅允许下列字段：

```json
{
  "schemaVersion": 1,
  "content": {
    "codeBlock": { "surface": "raised", "density": "comfortable" },
    "quote": { "surface": "soft" },
    "table": { "surface": "plain", "density": "compact" }
  },
  "controls": { "feedback": "responsive" }
}
```

- `content` 仅允许：`codeBlock`、`inlineCode`、`quote`、`table`、`callout`、`commandOutput`、`toolResult`、`fileReference`。
- 每项必须至少指定一个：`surface: plain | soft | raised` 或 `density: compact | comfortable | spacious`。
- `controls.feedback` 可选，取值为 `quiet | responsive | expressive`，省略时为 `responsive`。
- 引擎负责把这些声明映射到稳定语义类和中性修饰类；主题 CSS 决定具体视觉表现。

## components.json

当前 schema 1 必须包含 `home`；`task` 可选。

```json
{
  "schemaVersion": 1,
  "home": {
    "eyebrow": "可选",
    "title": "必填",
    "subtitle": "可选",
    "heroImage": "assets/hero.png",
    "status": "可选",
    "cards": [
      {
        "title": "必填",
        "description": "可选",
        "icon": "assets/card.png",
        "action": { "type": "focus-composer" }
      }
    ],
    "note": {
      "title": "可选",
      "lines": ["可选"]
    }
  },
  "task": {
    "eyebrow": "可选",
    "title": "必填",
    "subtitle": "可选",
    "heroImage": "assets/task.png",
    "status": "可选"
  }
}
```

- 首页卡片最多 4 张。
- 白名单动作：`focus-composer`、`insert-prompt`、`native-suggestion`。
- `insert-prompt` 需要 `value`；`native-suggestion` 需要 0 到 3 的 `index`。
- 图片引用必须在 `assets/` 内；组件图片使用 PNG、JPEG 或 WebP。
- `components.json` 不定义任意 DOM、HTML、脚本或自定义行为。

## 可选 UI 排列接口：chrome / sidebar / sticker

`components.json` 可在 `home` / 可选 `task` 之外声明三个通用、纯装饰接口；它们都由受信任引擎创建，主题包只提供 JSON、CSS 和 `assets/` 中的图片：

```json
{
  "chrome": {
    "route": "home",
    "title": "Theme studio",
    "subtitle": "Optional product line",
    "badge": "Preview",
    "icon": "assets/brand.png"
  },
  "sidebar": {
    "defaultIcon": "assets/conversation.png",
    "newTaskIcon": "assets/new-task.png",
    "matches": [{ "title": "Exact existing title", "icon": "assets/special.png" }]
  },
  "sticker": {
    "route": "home",
    "anchor": "bottom-end",
    "size": "medium",
    "image": "assets/sticker.png",
    "caption": "Optional decoration"
  }
}
```

- `chrome.route` 为 `home | chat`，省略时为 `home`；`chrome.title` 必填，`subtitle`、`badge`、`icon` 可选。渲染在不可交互的引擎顶部品牌层。聊天页只有明确声明 `route: "chat"` 才显示，避免与原生任务标题重叠。
- `sidebar.defaultIcon` 与 `newTaskIcon` 可选。`matches` 最多 12 项，每项只能精确匹配真实存在的侧栏标题，并必须指向本地图片；不得新造项目、会话、任务行或修改真实标题。
- `sticker.route` 仅为 `home | chat`，`anchor` 仅为 `top-start | top-end | bottom-start | bottom-end`，`size` 仅为 `small | medium | large`，`image` 必填且位于 `assets/`。贴纸不可交互，不得遮挡输入框、发送、标题栏或侧栏控制。
- 未声明的主题不得生成额外节点，也不得产生布局变化。不得将品牌名、明星、题材或视觉风格固化到引擎。

## CSS 与素材边界

- `theme.css` 非空且不超过引擎限制；当前上限为 512 KB。
- 单个 CSS/组件素材当前不超过 8 MB，素材总量当前不超过 24 MB。
- 禁止 `@import` 和外部 URL。
- 资源路径必须是主题目录内的相对路径，不得通过链接或 `..` 逃逸。
- 包含素材不代表素材已生效：CSS 或 JSON 必须真实引用它，删除未引用文件。

## 编码

JSON、CSS 和文案统一保存为 UTF-8。PowerShell 控制台显示乱码不等于文件乱码；用 UTF-8 编辑器或按字节读取确认，禁止基于终端乱码重写正常文件。
