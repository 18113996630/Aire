# AI Development Rules

## 1. 核心目标

本项目是一个 **AI iOS App Replica Engine（AIRE）**，目标是让 AI 根据参考材料和需求，自动完成：

`需求分析 → 产品/UI分析 → 架构设计 → 任务拆解 → 多Agent开发 → Build → Simulator运行 → 测试 → 视觉验证 → 自动修复 → 再验证`

核心原则：

> Observe → Plan → Act → Verify → Fix

AI 不仅负责生成代码，还必须负责验证代码是否真正达到目标。

---

## 2. 开发原则

* 优先复用成熟的开源项目、CLI、SDK 和工具，不重复造轮子。
* 不直接复制参考开源项目代码，只学习其架构、接口、设计思想和实现方式。
* 优先保持架构简单、模块职责清晰、可测试、可扩展。
* 不为了“未来可能需要”提前增加复杂抽象。
* 不进行与当前任务无关的重构。
* 不修改未授权范围内的文件。
* 不引入没有明确必要的第三方依赖。
* 所有重要状态必须可持久化、可恢复、可追踪。
* Agent 之间优先通过 **Task / Artifact / Event** 协作，而不是依赖长文本对话。

---

## 3. 修改代码前必须执行

在修改任何代码之前，必须明确：

### Goal

当前任务要解决什么问题。

### Non-goals

明确本次任务不处理什么。

### Success Criteria

什么条件满足后认为任务完成。

### Files

本次允许创建、修改、删除哪些文件。

如果无法确定上述内容，先分析项目并补充方案，不要直接修改代码。

---

## 4. 文件修改规则

* 只能修改已声明的 Files。
* 如果发现必须修改额外文件，先更新任务范围，再继续。
* 禁止顺手重构无关代码。
* 禁止为了消除警告而修改无关模块。
* 禁止修改 `.git`、用户环境配置和系统文件。
* 禁止提交 API Key、Token、密码等敏感信息。
* 不要通过删除测试、关闭检查、降低验证标准来解决问题。

---

## 5. 任务执行流程

每个任务必须遵循：

1. Observe

   * 阅读相关代码、配置、文档和已有 Artifact。
   * 不凭猜测修改代码。

2. Plan

   * 分析问题。
   * 确定实现方案。
   * 明确修改范围。
   * 明确验证方式。

3. Act

   * 按计划实现。
   * 保持修改最小化。

4. Verify

   * 执行必要的 Build / Test / Lint / Simulator 验证。
   * UI 任务必须运行 Simulator。
   * UI 任务必须获取实际截图进行验证。

5. Fix

   * 如果验证失败，分析失败原因。
   * 创建修复任务。
   * 修复后重新验证。
   * 不允许验证失败后直接宣布完成。

---

## 6. iOS 开发要求

* 使用 SwiftUI + SwiftData。
* 遵循 MVVM + Coordinator。
* 保持 View、ViewModel、Domain、Data、Infrastructure 职责清晰。
* 优先使用 Apple 原生 Framework。
* UI 修改必须考虑真实 Simulator 表现，而不仅是代码正确。
* 修改 UI 后必须进行截图验证。
* Build 必须使用真实 Xcode 工程验证。
* 不允许仅通过静态代码分析判断任务完成。

---

## 7. AI Agent 协作

Agent 必须有明确 Role。

典型角色：

* Product Analyst
* UI Analyst
* Architect
* Planner
* iOS Developer
* QA Engineer
* Visual Reviewer
* Debugger
* Reviewer

每个 Agent：

* 只负责自己的职责。
* 明确输入。
* 明确输出 Artifact。
* 不直接依赖其他 Agent 的聊天上下文。
* 优先读取已有 Artifact。
* 输出结构化结果。

推荐 Artifact：

* `product-spec.md`
* `design-spec.md`
* `architecture.md`
* `task-graph.yaml`
* `test-plan.md`
* `test-report.json`
* `visual-review.json`
* `fix-plan.md`

---

## 8. Task 要求

每个 Task 至少包含：

```yaml
id:
title:
goal:
non_goals:
role:
dependencies:
allowed_files:
acceptance_criteria:
verification:
```

Task 必须可独立执行、验证和重试。

Task 之间通过依赖关系形成 DAG，不允许依赖隐式聊天上下文。

---

## 9. 验证标准

### Build

必须确认：

* Xcode Build 成功
* 无新增编译错误
* 无关键 Warning

### Test

根据任务执行：

* Unit Test
* Integration Test
* XCTest / XCUITest

### UI

必须：

1. 启动 Simulator
2. 执行目标操作
3. 截图
4. 与参考截图比较（对齐尺度并提取探针）
5. 输出量化视觉问题列表
6. 必要时创建 Fix Task

### Replica

Replica 类任务不仅要求功能正确，更要求视觉与度量的高精度还原：

* 布局一致
* 尺寸精确
* 间距精准
* 字体与字重匹配
* 颜色与色彩空间准确（基于 sRGB / P3 测量基准）
* 动画/交互行为接近

### UI 对比校验规则（对标 super-prototyping）

后续所有 UI 对比、视觉 Review 与像素级复刻校验，**必须严格参考参考项目 `docs/reference-project/super-prototyping`（详见 `docs/ui-verification-rules.md`）的方法论与校验标准**：

1. **可辩护的复刻（Defensible Replica）**：
   - 界面中所有的颜色、间距、字号、圆角尺寸必须来源于真实参考截图的测量证据（Evidence），严禁主观盲猜“看起来差不多”。
   - "No evidence, no token." / "Values that look about right are how a replica quietly stops being one."
2. **尺度校准与色彩空间统一（Scale & Color Space）**：
   - 采样前必须准确计算设备 capture px 与 SwiftUI pt 的缩放比（如 `@3x` 下 `393 pt -> 1179 px`），长宽比例误差须 `< 1%`。
   - 截图前先校准色彩空间（统一转为 sRGB），避免因未标记 Display P3 与 sRGB 产生伪色差。
3. **分层测量与证据采样（Hierarchical Sampling）**：
   - **背景/容器填充**：在目标区域统计纯色平铺点（Flat Fills），剔除边缘抗锯齿噪声；
   - **文本颜色**：取最深的前几个百分位墨水核（Ink Core），不能直接用众数（众数通常是背景色）；
   - **边框与细线**：通过透光与墨量亏损（Hairline Ink Deficit）测算真实颜色与粗细，不凭直觉单点采样；
   - **节奏与间距**：通过墨斑投影（Bands）和色彩扫描（Scan）确定组件行高、列表节拍与真实边缘坐标。
4. **探针机制与量化容差（Probe-based Verification）**：
   - **无探针即流言**（"A defect without a probe is a rumour"）：任何视觉缺陷报告必须提供精确的探针坐标包围盒（`probe: [x1, y1, x2, y2]`）、预期值（Ref）、实际值（Mine）与绝对差值（Delta）。
   - **容差标准**：系统原生控件与容器的平均绝对偏差（Mean Absolute Delta）控制在 `3-7` 属于达标；纯文本字体替换区允许合理容差，禁止为了追平不可测数值而歪曲已测量的几何坐标。
5. **审阅与修改解耦（Fan out the looking, not the editing）**：
   - 视觉审阅与探针复现可并行分发（多任务同时比对不同页面）；
   - 代码修复必须单点收敛（单一负责修改的 Developer Agent 执行），严禁多 Agent 混乱修改样式或直接硬编码魔数。
6. **重测再验证闭环**：
   - "A correction you have not re-rendered is not a correction."
   - 任何样式与布局修改后，必须重新在 Simulator 中构建、截屏、跑探针校验，确认 Delta 收敛后方可关闭缺陷。

---

## 10. 错误处理

遇到错误时：

`错误 → 定位原因 → 创建修复方案 → 修改 → 验证`

禁止：

* 猜测性大量修改
* 连续修改大量无关代码
* 通过绕过验证解决问题
* 隐藏错误
* 在没有验证的情况下声称成功

如果连续修复失败，应停止当前循环并输出：

* 当前问题
* 已尝试方案
* 失败原因
* 推荐下一步

---

## 11. Git

每个独立 Task 尽可能保持可回滚。

重要任务完成后必须保证：

* 工作区状态清晰
* 修改范围明确
* 不包含无关修改
* 可以独立回滚

禁止覆盖或删除用户已有的未提交修改。

---

## 12. 完成标准

只有同时满足以下条件，Task 才能标记为 `completed`：

* 实现完成
* Acceptance Criteria 全部满足
* Build 成功
* 必要测试通过
* UI 任务完成 Simulator 验证
* 视觉任务完成截图验证
* 没有遗留已知阻塞问题

如果任何条件不满足，状态必须保持：

`failed` / `blocked` / `needs_fix`

不能标记为完成。

---

## 13. 最终回复

完成任务后只需要简洁说明：

* 做了什么
* 验证结果
* 是否存在遗留问题

不要输出冗长过程日志。

如果任务全部完成：

> 喵，我做完了
