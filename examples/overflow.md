---
title: Overflow Demo
author: Your Name
theme: gse
aspect: 4:3
---

# 这一页故意装不下

## 用来验证 build 会明确失败，而不是偷偷缩小字号

- 第一点：目标必须可以被验证
- 第二点：未知必须被拆成便宜的实验
- 第三点：反馈必须足够快
- 第四点：错误必须尽早暴露
- 第五点：系统必须持续向真实结果收敛
- 第六点：工程能力不是写更多代码
- 第七点：排版必须稳定且可复现
- 第八点：字号在任何页面都不允许变化
- 第九点：内容密度过高时应当拆页
- 第十点：这会触发 overflow，构建必须失败

工程的意义，是让系统在不确定中持续收敛。

预期结果：

```text
ERROR: slide cannot fit with fixed typography.
```

如果你看到 build 成功，说明 overflow 检测失效了。
