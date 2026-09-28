# gse-slides 使用指南

面向第一次使用本项目的人。全部命令都在项目根目录执行。

## 目录

1. [这是什么](#1-这是什么)
2. [环境准备](#2-环境准备)
3. [五分钟上手](#3-五分钟上手)
4. [项目结构](#4-项目结构)
5. [命令参考](#5-命令参考)
6. [Markdown 写法](#6-markdown-写法)
7. [Front matter 字段](#7-front-matter-字段)
8. [布局指令](#8-布局指令)
9. [图片与自动布局](#9-图片与自动布局)
10. [固定排版与内容密度](#10-固定排版与内容密度)
11. [报错与排错](#11-报错与排错)
12. [导出与离线演示](#12-导出与离线演示)
13. [测试与视觉回归](#13-测试与视觉回归)
14. [常见问题](#14-常见问题)
15. [不要做的事](#15-不要做的事)

---

## 1. 这是什么

把一份 `slides.md` 编译成一套固定风格的幻灯片，并输出三种产物：

```text
slides.md
  -> Markdown Parser
  -> Semantic Slide AST
  -> Layout Engine（真实浏览器逐个测量候选布局）
  -> Reveal.js + 固定 CSS theme
  -> dist/index.html
  -> 可选导出：dist/slides.pdf、dist/slides.pptx
```

三条不变的设计约束：

1. **Markdown 是唯一 source of truth**，HTML / PDF / PPTX 都只是构建产物。
2. **排版固定**：所有页面字号一致，永远不因为某页内容多而缩小字体。
3. **装不下就失败**：构建明确报错并给出建议，而不是硬塞进去。

你负责写内容，渲染器负责排版。

## 2. 环境准备

- Node.js 20 或更高（本机为 v24）。
- pnpm。如果没有：`npm i -g pnpm`

```powershell
cd D:\opencode_project\slides
pnpm install
pnpm exec playwright install chromium
```

Chromium 只在 `build` / `lint` / `pdf` / `pptx` 时使用（真正渲染并测量，而不是靠字符数猜）。
如果你只打算手动写 HTML 里看效果，也建议装上，否则构建会失败。

## 3. 五分钟上手

**第一步：建自己的报告。** 推荐直接复制模板：

```powershell
Copy-Item -Recurse templates my-talk
```

得到：

```text
my-talk/
├── deck.md
└── assets/
    ├── landscape.svg
    ├── portrait.svg
    ├── before.svg
    └── after.svg
```

**第二步：写内容。**

```markdown
---
title: 我的报告
author: 你的名字
theme: gse
aspect: 4:3
slideNumber: true
---

<!-- layout: title -->

# 我的报告

## 一句话说清这份报告要回答什么

你的名字

---

# 一个问题

## 为什么值得讨论？

- 原因一
- 原因二
- 原因三

![示意图](assets/landscape.svg)
```

**第三步：看效果。**

```powershell
pnpm slides dev my-talk/deck.md
```

它会打印一个地址（默认 `http://127.0.0.1:5173/`），**需要你自己打开浏览器**。
之后改 `deck.md` 或 `assets/` 里的文件会自动重建并刷新页面。

**第四步：产出。**

```powershell
pnpm slides lint  my-talk/deck.md   # 先自检
pnpm slides build my-talk/deck.md   # dist/index.html + dist/assets/
pnpm slides pdf   my-talk/deck.md   # dist/slides.pdf
pnpm slides pptx  my-talk/deck.md   # dist/slides.pptx
```

## 4. 项目结构

```text
gse-slides/
├── bin/slides.mjs          CLI 入口（build / dev / pdf / pptx / lint）
├── src/
│   ├── parser/             front matter、markdown、布局指令解析
│   ├── compiler/           语义 AST、布局候选、编译流程
│   ├── render/             HTML 渲染、图片尺寸、Mermaid 转 SVG、模板
│   ├── export/             PDF、PPTX 导出
│   ├── lint/               资源检查、overflow 检测、内容密度
│   └── theme/              gse.css / highlight.css（唯一的视觉来源）
├── templates/              模板：deck.md + 示例图片
├── examples/
│   ├── demo.md             18 页完整示例，覆盖所有布局
│   ├── overflow.md         故意装不下，用来验证构建会失败
│   └── mermaid.md          Mermaid 构建期转 SVG 示例
├── tests/                  单元测试 + 视觉回归（visual/baseline）
├── docs/                   本指南、实现规格
└── dist/                   构建产物（不要手动编辑）
```

`dist/` 生成在**当前工作目录**下，所以请在项目根目录执行命令。

可以改的：你自己写的 `.md`、`assets/` 里的图片、`src/theme/gse.css`（改主题时）。
不要改的：`dist/` 里的任何文件。

## 5. 命令参考

通用写法是 `pnpm slides <命令> <文件.md>`；省略文件名时默认 `slides.md`。
`pnpm` 里另有绑定到 `examples/demo.md` 的快捷方式：`pnpm build` / `pnpm dev` / `pnpm pdf` / `pnpm pptx` / `pnpm lint`。

| 命令 | 作用 | 失败行为 |
| --- | --- | --- |
| `pnpm slides dev <file.md>` | 启动本地服务、监听文件、自动重建并刷新浏览器 | 首次构建失败也会启动，改好后自动恢复 |
| `pnpm slides build <file.md>` | 生成 `dist/index.html` 与 `dist/assets/` | 退出码 1，且**不更新** `index.html` |
| `pnpm slides lint <file.md>` | 检查图片是否存在、是否 overflow、内容密度 | 有问题时退出码 1 并打印报告 |
| `pnpm slides pdf <file.md>` | 生成 `dist/slides.pdf`，一页 slide 对应一页 PDF | 构建失败则不导出 |
| `pnpm slides pptx <file.md>` | 生成 `dist/slides.pptx`，每页一张 2 倍分辨率截图 | 构建失败则不导出 |
| `pnpm slides` | 打印用法 | — |

几个细节：

- **`build` 会先清空 `dist/assets/`**，所以删掉图片后重新构建不会留下孤立文件。
- **`dev` 只监听该 md 文件和它旁边的 `assets/` 目录**。放在别处的资源不会触发重建。
- **`pdf` 是矢量文本**，可以选中、搜索、缩放。
- **`pptx` 是截图**（1024×768 的 2 倍 = 2048×1536），视觉与 HTML 一致，但文字在 PowerPoint 里不可编辑。要改内容就改 `slides.md` 重新构建。

## 6. Markdown 写法

分页只用单独一行的 `---`（前后各留一个空行）。

| 写法 | 含义 |
| --- | --- |
| `# 标题` | 页面主标题（每页一个） |
| `## 副标题` | 二级标题，带 accent 下划线 |
| `- 项目` / `1. 项目` | 无序 / 有序列表，可缩进嵌套 |
| `> 引用` | 引用块（衬线字体） |
| 三个反引号 + 语言 | 代码块，构建期高亮 |
| `$x$` / `$$…$$` | 行内公式 / 独立公式（构建期用 KaTeX 渲染） |
| `![说明](assets/a.svg)` | 图片 |
| `\| a \| b \|` | 表格 |
| 三个反引号 + `mermaid` | 构建期转成 SVG，运行时不再渲染 |

公式、代码高亮、Mermaid 全部在**构建期**完成，所以 `dist/` 不需要额外运行时依赖，也不需要联网。

## 7. Front matter 字段

文件最前面用 `---` 包住的 YAML：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `title` | `Untitled` | 浏览器标题 |
| `author` | 空 | 写入 HTML meta |
| `theme` | `gse` | 目前只支持 `gse`，写别的会警告并回退 |
| `aspect` | `4:3` | 支持 `4:3`（1024×768）与 `16:9`（1280×720） |
| `slideNumber` | `true` | 是否显示页码 |
| `remoteAssets` | `false` | 是否允许远程图片（见下） |

写 `aspect: 4:3` 不需要加引号，解析器已经处理了 YAML 会把它读成数字 243 的坑。
未知字段会产生一条 warning，不影响构建。

## 8. 布局指令

自动布局覆盖绝大多数情况。只有当自动结果不理想时，才用 HTML 注释覆盖，写在**当前页最前面**：

```markdown
<!-- layout: image-right -->

# 标题

- 要点

![图](assets/a.svg)
```

可用的 `layout`：

| 值 | 效果 |
| --- | --- |
| `auto` | 默认，交给自动布局（不写等同于这个） |
| `text` | 纯文本流 |
| `figure` | 一张大图占据正文区 |
| `image-right` / `image-left` | 图文左右分栏 |
| `image-bottom` | 文字在上、图片在下 |
| `gallery` | 图片墙，用于 5 张以上 |
| `middle` | 整页居中大标题（章节过渡页） |
| `title` | 封面页（居中，且不显示页码） |

还可以指定图片列宽：

```markdown
<!-- image-width: 40% -->
```

只允许这九个值：`30% 35% 40% 45% 50% 60% 70% 80% 90%`。
写别的值会被拒绝并给出 warning（不支持写像素）。同理，也**不支持**在 Markdown 里写字体大小、内外边距、颜色。

## 9. 图片与自动布局

你只写 `![alt](assets/x.svg)`，**不要写宽高**。构建时读取真实尺寸（PNG/JPEG 用 sharp，SVG 读 `width/height` 或 `viewBox`），由布局引擎决定怎么放。

所有图片统一规则：`contain`、保持宽高比、**永不裁剪**、不使用 `vw/vh`（所以任何电脑上显示都一致）。

自动布局的决策顺序：

| 情况 | 结果 |
| --- | --- |
| 没有图片 | 纯文本 |
| 1 张图，几乎没有正文 | `figure` |
| 1 张图 + 正文，竖图（比例 < 0.80） | 优先左右分栏 |
| 1 张图 + 正文，横图（比例 > 1.25）且文字少 | 优先上下，图片最多占正文区高度 60% |
| 1 张图 + 正文，文字多 | 左右分栏 |
| 1 张超宽图（比例 > 2.5） | 直接上下（放进窄列会看不清） |
| 2 张图 | 自动并排 |
| 3–4 张图 | 2×2，并给出密度提醒 |
| 5 张图 | 回退到 gallery，并提醒 |
| ≥ 6 张图 | **构建失败**，除非显式写 `<!-- layout: gallery -->` |

判断"放进去了没有"不是靠字符数估算：每个候选布局都会在 Chromium 里真实渲染，读取 `scrollHeight` / `clientHeight` / `scrollWidth` / `clientWidth`，第一个不溢出的布局胜出。

## 10. 固定排版与内容密度

字号跨页恒定：

| 元素 | 字号 |
| --- | --- |
| h1 | 60px |
| h2 | 48px |
| 正文 / 列表 | 32px |
| 代码 | 28px |
| 页码 | 26px |

主题只有一个强调色 `rgb(106, 0, 95)`。需要强调时用 `**加粗**`，确实需要颜色再用 `<span class="accent">文字</span>`。

内容密度只是 **warning**，不会改你的内容，但建议留意：

| 检查项 | 阈值 |
| --- | --- |
| h1 长度 | > 24 个中文字符（英文按半个字符折算） |
| h2 长度 | > 32 |
| 一级要点数 | > 6 |
| 要点总数 | > 10 |
| 单段正文字符数 | > 350 |
| 行内 `font-size` | 出现即提醒（应改用语义布局） |

## 11. 报错与排错

**排版装不下**是最常见的失败。构建会打印：

```text
Slide 4 overflowed vertically by 236px.

Possible fixes:
- split this slide
- reduce bullet count
- use layout: image-right or layout: image-bottom

Typography is fixed: font size is never reduced automatically.
```

`lint` 会给出更详细的版本：

```text
Slide 7
------------
Vertical overflow: 334px

Likely causes:
- 10 top-level bullets
- 1 code blocks

Suggestion:
split into two slides.

Candidates tried: text
```

处理顺序（也是引擎自己的决策优先级）：

1. 调图片尺寸 / 换布局
2. `figure` -> 左右分栏
3. 左右分栏 -> 上下堆叠
4. 仍然不行：拆成两页

**绝对不要**为了塞进去而缩小字号——系统里没有这个开关。

其它常见问题：

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 页数比预期少一页 | 漏写 `---`，两页被合并成一页（两页的指令会叠加） | 检查两页之间是否有**单独一行**的 `---`，且前后各有一个空行 |
| `Slide N: image not found: "..."` | 图片路径不对 | 路径是相对**这个 md 文件所在目录**写的；确认 `assets/` 位置 |
| `remote image "..." is not allowed` | 默认禁止远程图片 | 下载到 `assets/`，或在 front matter 写 `remoteAssets: true` |
| 提示未知 layout / 图片宽度 | 指令拼写或取值不在允许列表 | 对照第 8 节的可选值 |
| `Slide N contains 6 images` | 图片过多 | 拆页，或显式 `<!-- layout: gallery -->` |
| 密度 warning | 内容偏多 | 按建议精简或拆页 |
| `dev` 改了图片没反应 | 图片不在 md 旁边的 `assets/` | 移到 `assets/`，或重启 dev |

## 12. 导出与离线演示

- `dist/index.html` + `dist/assets/` 完全离线：不需要 npm、不需要 node、不需要联网。
- 把 `dist/` 拷到任何机器，用任意静态服务器即可：

```powershell
cd dist
python -m http.server 8000
# 浏览器打开 http://localhost:8000/
```

用 `http.server` 而不是直接双击文件，是因为 KaTeX 字体通过 `file://` 加载在某些浏览器里会被拦截。

- `dist/slides.pdf`：A4 比例随 `aspect` 变化，一页一张 slide，矢量文字。
- `dist/slides.pptx`：每页一张 2048×1536 截图，视觉与 HTML 一致；文字不可在 PowerPoint 内编辑，改内容请改 `slides.md` 重新构建。

## 13. 测试与视觉回归

```powershell
pnpm test          # 单元测试：parser、AST、布局候选、图片尺寸（当前 38 个用例）
pnpm test:visual   # 逐页像素对比
```

`pnpm test:visual` 会先构建 `examples/demo.md`，把每页截图写到 `tests/visual/current/`，再和 `tests/visual/baseline/` 逐像素比对；差异超过 0.5% 即失败，并生成 `*.diff.png` 标出变化区域。
第一次运行（或加 `--update`）会把当前结果保存为基线：

```powershell
node tests/visual/run.mjs --update
```

改了主题 CSS 之后跑一次，就能确认"改一个 margin 不会让整套幻灯片漂移"。

## 14. 常见问题

**我可以直接用某个 `.md`，不复制模板吗？**
可以。任何 `.md` 都能编译，只要 front matter 合法、图片路径正确。模板只是省事。

**能改字号或颜色吗？**
改 `src/theme/gse.css` 里的 `:root` 变量。改完必须重跑测试基线（`--update`），否则视觉回归会失败。不要在 Markdown 里写 `font-size`。

**为什么 PDF 和 PPTX 都能和 HTML 对齐？**
导出时加载同一套 CSS，只额外注入一段"把每页固定成逻辑页面尺寸并分页"的样式，不触碰任何内容层规则。

**代码/公式需要额外的运行时 JS 吗？**
不需要。代码高亮、KaTeX 公式、Mermaid 都在构建期完成；`dist/` 里唯一的运行时脚本是 Reveal.js 本身。

**支持多主题吗？**
目前只支持 `gse` 一个主题，这是刻意的。

## 15. 不要做的事

- 不要编辑 `dist/index.html`，也不要编辑导出的 PPTX。
- 不要在 Markdown 里设置像素位置、字号、边距、颜色。
- 不要指望内容多时自动缩小字体——它会报错让你改结构。
- 不要为了过 lint 而删掉测试或放宽阈值。
- 不要引入渐变、卡片、阴影、玻璃拟态这类装饰。

改 `slides.md`，重新构建即可。
