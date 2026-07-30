# 视觉问题根因诊断

## 原则

先回答“哪一层在绘制”，再修改 CSS。截图中的白色不一定是 `background-color`；可能来自背景图、渐变、阴影、滤镜、伪元素或透过半透明层看到的祖先。

## CDP 检查顺序

Skin Codex 默认通过本地 CDP 端口连接 Codex。读取 `http://127.0.0.1:9335/json` 获取 page target，再用 `Runtime.evaluate` 检查运行态。

对目标元素及 6 到 10 层祖先收集：

- `getBoundingClientRect()`
- `background`、`backgroundColor`、`backgroundImage`
- `border`、`boxShadow`
- `backdropFilter`、`filter`、`opacity`
- `position`、`zIndex`、`overflow`、`padding`、`margin`
- `getComputedStyle(node, '::before')` 和 `::after`

在视觉边界内、边界线上和边界外各取点，调用 `elementsFromPoint(x, y)`。比较命中层，找出覆盖范围大于目标控件的绘制元素。

## 常见症状

### 重复人物或背景

检查 `body`、路由、侧栏、Hero、`::before` 是否同时包含相同 `url()`。只保留一个整窗绘制源，其余层改为透明/半透明表面。

### 侧栏与聊天区像两张图

检查两区是否分别用了 `background-size: cover`。同一图片在不同矩形内 cover 会产生不同裁切；不要靠微调 `background-position` 对齐，应让两区透出同一个窗口背景。

### 输入框外的大块白边

先比较白区矩形与输入框矩形。如果白区明显更宽或一直延伸到底部，通常不是输入框 border。

逐项检查：

1. 输入框 `box-shadow` 是否有外圈或 inset。
2. 输入框父级是否有背景。
3. sticky footer 是否有绝对定位子层。
4. 是否存在 `bg-gradient-to-t` 一类原生底部可读性遮罩。
5. 该遮罩的计算 `background-image` 是否仍是从主表面色到透明的渐变。

关闭遮罩时，优先由引擎给它稳定类。若当前尚无稳定类，把它视为引擎契约缺口，不把脆弱工具类扩散到所有主题。

### 规则写了但没有效果

检查：

- 目标元素是否真的有稳定类。
- selector 是否匹配当前节点。
- 样式表是否已热更新到 `active-theme`。
- 更高优先级规则或 inline style 是否覆盖。
- 规则是否被 `dream-art-wide`、路由类或 `:has()` 条件排除。
- 当前窗口/主题元数据生成的是 `dream-art-standard` 还是其他状态类。

不要因为样式表中“存在规则”就认为规则已生效；必须读取目标元素的计算样式和匹配规则。

### 只在某个聊天显示

比较首页、新聊天、已有聊天和不同项目的 DOM 标记。检查增强模块是否绑定到临时节点、标题文本或旧路由；适配器应绑定语义容器，并在路由变化后重新识别和清理。

## 最小修复

一次只修一层：先建立失败断言或运行态证据，再修改最窄规则，随后复查计算样式、截图和回归测试。若连续三次修改仍转移症状，停止叠补丁，重新审视背景/适配层架构。
