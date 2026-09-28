---
title: Mermaid Demo
author: Your Name
theme: gse
aspect: 4:3
---

# Mermaid

## 构建阶段转成 SVG，运行时不再渲染

```mermaid
graph LR
  Intent --> Spec
  Spec --> Impl
  Impl --> Validate
  Validate --> Intent
```

- Mermaid 只在 build 时运行
- 输出普通 image block
- HTML / PDF / PPTX 因此完全一致


