项目暂定名：**AI iOS App Replica Engine（AIRE）**

核心目标是：

> 给定一个已有 App 的参考资料、功能需求和目标平台，AI Agent 自动完成需求分析、任务拆分、iOS 工程实现、构建运行、自动测试、视觉评审、问题定位和代码修复，最终形成一个可运行、可验证的 iOS App。

---

# AI iOS App Replica Engine 技术方案

**Version：v0.1**
**定位：AI 驱动的 iOS App 自动化复刻与软件工程 Agent 平台**

---

# 1. 项目背景

随着 Codex CLI、Claude Code、Gemini CLI、OpenCode 等 Coding Agent 的发展，AI 已经能够完成越来越多的软件开发任务。

但当前典型使用方式仍然是：

```text
用户
 ↓
告诉 AI 一个需求
 ↓
AI 修改代码
 ↓
用户自己运行
 ↓
用户发现问题
 ↓
再次告诉 AI
 ↓
AI 修改
```

这仍然是一个**人工驱动的开发循环**。

尤其是在 iOS App 开发和已有 App 复刻场景中，存在几个明显问题：

1. AI 需要人工逐步提供需求。
2. 复杂需求无法自动拆解。
3. 多个 AI Agent 缺乏统一的任务协作机制。
4. AI 写完代码后通常只知道“编译是否成功”。
5. UI 是否符合设计目标，缺乏自动评审能力。
6. AI 很少真正操作 Simulator 验证完整用户流程。
7. 出现问题后，需要人工把问题重新描述给 AI。
8. Codex、Claude Code、Gemini CLI 等工具之间缺少统一编排层。

因此，本项目希望构建一个：

> **面向真实软件工程闭环的 Multi-Agent Coding Orchestrator。**

尤其针对 iOS App：

```text
需求 / 参考 App
       ↓
需求分析
       ↓
产品设计
       ↓
任务拆分
       ↓
多 Agent 协作
       ↓
代码实现
       ↓
Xcode Build
       ↓
Simulator
       ↓
自动测试
       ↓
视觉评审
       ↓
问题分析
       ↓
自动修复
       ↓
再次验证
       ↓
完成
```

---

# 2. 产品定位

AIRE 不负责替代 Codex、Claude Code 等 Coding Agent。

它更像：

> **AI Software Engineering Orchestrator**

上层负责：

* 理解项目
* 制定计划
* 拆分任务
* 分配 Agent
* 管理依赖
* 调度 CLI
* 收集结果
* 验证结果
* Review
* 自动修复

底层负责真正写代码的是：

```text
Codex CLI
Claude Code
Gemini CLI
OpenCode
Cursor Agent
Antigravity
Aider
...
```

因此整体架构是：

```text
                    AIRE
                     │
        ┌────────────┼────────────┐
        │            │            │
     Planning      Agent       Evaluation
        │          Runtime          │
        │            │              │
        └────────────┼──────────────┘
                     │
              AI CLI Runtime
                     │
       ┌─────────────┼─────────────┐
       ↓             ↓             ↓
     Codex        Claude         Gemini
```

---

# 3. 核心使用场景

## 3.1 App Replica

例如：

> 我要复刻一个已有的卡片 App。

提供：

```text
/reference
    home.png
    editor.png
    template.png
    export.png

/reference-video
    editor-flow.mp4

/requirements
    requirements.md
```

然后执行：

```bash
aire run
```

AIRE 自动完成：

```text
分析参考资料
 ↓
生成产品 Spec
 ↓
生成 UI Spec
 ↓
设计技术架构
 ↓
拆分开发任务
 ↓
创建 Agent Team
 ↓
开发
 ↓
Build
 ↓
Simulator
 ↓
测试
 ↓
视觉 Review
 ↓
Fix
 ↓
重新测试
```

---

# 4. 核心设计原则

## 4.1 AI 不直接拥有整个项目

不能让一个 Agent：

> 想改什么就改什么。

采用：

```text
Project
 ↓
Task
 ↓
Agent
 ↓
Declared Files
 ↓
Implementation
```

每个任务都有明确边界。

---

## 4.2 Agent 通过 Artifact 协作

不要让 Agent 之间无限聊天。

而是：

```text
Product Agent
       ↓
product-spec.md

Architect Agent
       ↓
architecture.md

UI Agent
       ↓
design-spec.md

Planner
       ↓
tasks.yaml

Developer
       ↓
Source Code

QA
       ↓
test-report.md

Visual Reviewer
       ↓
visual-review.md
```

**Artifact 是 Agent 之间的主要通信协议。**

---

## 4.3 所有工作必须可追踪

每次 Agent 行为都应该记录：

```text
Task
Agent
Input
Tool Call
Files Changed
Command
Output
Test Result
Review Result
```

最终形成完整：

```text
Execution Trace
```

---

# 5. 总体架构

```text
┌──────────────────────────────────────────────────────┐
│                      AIRE CLI / UI                   │
└─────────────────────────┬────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────┐
│                  Project Orchestrator                │
│                                                      │
│  Workflow Engine                                     │
│  Task Scheduler                                      │
│  Agent Manager                                       │
│  State Manager                                       │
└──────────────┬───────────────┬───────────────────────┘
               │               │
               ▼               ▼
        ┌────────────┐   ┌───────────────┐
        │ Agent      │   │ Evaluation    │
        │ Runtime    │   │ Engine        │
        └─────┬──────┘   └───────┬───────┘
              │                  │
              ▼                  ▼
        AI CLI Adapter      Test / Visual
              │             / Build / Review
              │                  │
       ┌──────┼──────┐           │
       ▼      ▼      ▼           ▼
    Codex  Claude  Gemini    iOS Simulator
                             Xcode
```

---

# 6. 模块划分

建议第一版拆成 9 个核心模块。

```text
aire/
├── orchestrator
├── workflow
├── agent-runtime
├── task-engine
├── cli-runtime
├── artifact
├── evaluator
├── ios-runtime
└── cli
```

---

# 7. Orchestrator

这是整个系统的大脑。

负责：

* Workflow 执行
* Agent 调度
* Task 状态
* 依赖关系
* Retry
* Failure Recovery
* Context 管理

核心状态：

```text
PROJECT_CREATED
↓
ANALYZING
↓
PLANNING
↓
IMPLEMENTING
↓
BUILDING
↓
TESTING
↓
REVIEWING
↓
FIXING
↓
COMPLETED
```

失败：

```text
FAILED
 ↓
RECOVERING
 ↓
RETRY
```

---

# 8. Workflow Engine

不要把流程硬编码成：

```text
Analysis → Coding → Testing
```

而是建立 Workflow DSL。

例如：

```yaml
workflow:
  name: ios-replica

steps:

  - id: research
    agent: product-analyst

  - id: architecture
    agent: architect
    depends_on:
      - research

  - id: planning
    agent: planner
    depends_on:
      - architecture

  - id: implementation
    strategy: parallel
    source: planning

  - id: build
    executor: ios-build

  - id: test
    executor: xctest

  - id: visual-review
    agent: visual-reviewer

  - id: fix
    agent: developer
    condition: review.failed

  - id: verify
    goto: visual-review
```

这样以后：

```text
iOS Replica
Web Replica
Android Replica
Backend Development
```

都可以使用同一个 Engine。

---

# 9. Task Engine

这是整个系统非常重要的一层。

Planner 输出：

```text
Task Graph
```

例如：

```text
T001 Research
      │
      ▼
T002 Product Spec
      │
      ├───────────────┐
      ▼               ▼
T003 UI Design     T004 Architecture
      │               │
      └───────┬───────┘
              ▼
           T005 Home
              │
              ▼
           T006 Editor
              │
              ▼
           T007 Export
              │
              ▼
           T008 Testing
```

每个 Task：

```yaml
id: T005

name: Implement Home

goal: Implement the home screen

non_goals:
  - Editor
  - Export

dependencies:
  - T003
  - T004

agent_role: ios-developer

files:
  allowed:
    - Sources/Home/**
    - Sources/Shared/**

acceptance:
  - App launches
  - Home renders correctly
  - Navigation works

verification:
  - xcodebuild
  - simulator screenshot
```

---

# 10. Agent Runtime

Agent Runtime 不应该直接绑定某个模型。

定义统一接口：

```text
Agent
 ├── Role
 ├── Prompt
 ├── Tools
 ├── Context
 ├── Permissions
 └── Output
```

例如：

```yaml
agent:
  name: ios-developer
  role: developer

runtime:
  provider: codex

permissions:
  read:
    - project/**
  write:
    - Sources/Home/**

tools:
  - filesystem
  - shell
  - xcodebuild
  - simulator
```

---

# 11. CLI Runtime Adapter

这是 AIRE 区别于普通 Agent Framework 的关键模块。

统一接口：

```text
AIRuntime

run(task, context)
stream()
cancel()
resume()
```

然后：

```text
CodexRuntime
ClaudeRuntime
GeminiRuntime
OpenCodeRuntime
CursorRuntime
AntigravityRuntime
```

都实现统一接口。

例如：

```text
Agent
 ↓
AIRuntime
 ↓
Codex CLI
```

或者：

```text
Agent
 ↓
AIRuntime
 ↓
Claude Code
```

这样 Planner 根本不需要知道具体使用什么 CLI。

---

# 12. Agent Role System

第一版建议至少定义：

### Product Analyst

负责：

* 需求分析
* 功能梳理
* 用户流程

---

### UI Analyst

负责：

* 截图分析
* UI 层级
* Design Token
* 交互推断

---

### Architect

负责：

* 技术架构
* 模块划分
* 数据模型

---

### Planner

负责：

* Task Graph
* Dependency
* Acceptance Criteria

---

### iOS Developer

负责：

* SwiftUI
* SwiftData
* API
* Feature

---

### QA Engineer

负责：

* XCTest
* XCUITest
* 功能验证

---

### Visual Reviewer

负责：

* Screenshot
* Reference Comparison
* UI 差异分析

---

### Debugger

负责：

* Crash
* Build Error
* Test Failure

---

### Reviewer

负责：

* Code Review
* Architecture Review
* Requirement Review

---

# 13. iOS Runtime

这是 AIRE 的专属能力。

提供：

```text
iOSRuntime

create-simulator
boot
install
launch
terminate
screenshot
record
log
tap
type
swipe
dump-accessibility
```

底层主要调用：

```text
xcodebuild
xcrun simctl
XCTest
XCUITest
```

---

# 14. Build Engine

例如：

```text
xcodebuild \
  -scheme MyApp \
  -destination 'platform=iOS Simulator,...'
```

输出：

```json
{
  "status": "failed",
  "error": {
    "type": "compile",
    "file": "HomeView.swift",
    "line": 42
  }
}
```

然后自动转成：

```text
Fix Task
```

交给 Debugger / Developer。

---

# 15. Functional Test Engine

测试不仅仅是：

```text
xcodebuild test
```

还要支持用户流程。

例如：

```yaml
scenario:
  name: Create Card

steps:
  - launch

  - tap:
      accessibility_id: create

  - type:
      text: "Hello World"

  - tap:
      accessibility_id: save

assertions:
  - exists: "Hello World"
  - screenshot: editor
```

这样可以让 Agent 真正验证：

> 用户是否可以完成这个操作。

---

# 16. Visual QA Engine

这是 AIRE 的核心差异化模块之一。

输入：

```text
reference.png
actual.png
```

然后：

```text
Vision Model
 ↓
Layout Analysis
 ↓
Difference Detection
 ↓
Issue List
```

输出：

```yaml
result: failed

issues:

  - type: spacing
    element: header
    expected: 24
    actual: 32

  - type: typography
    element: title
    expected_size: 28
    actual_size: 24

  - type: color
    element: background
    expected: "#F7F7F7"
    actual: "#FFFFFF"

  - type: alignment
    element: card
    severity: medium
```

---

# 17. Visual Review 不应该只依赖 LLM

建议使用三层：

```text
                    Visual QA
                       │
           ┌───────────┼───────────┐
           ↓           ↓           ↓
       Pixel Diff   CV Analysis   Vision LLM
```

### Pixel Diff

检测：

* 颜色
* 位移
* 边界

### Computer Vision

检测：

* 元素位置
* 尺寸
* OCR
* Layout

### Vision LLM

判断：

* 是否整体一致
* 是否视觉风格一致
* 哪些地方明显不像

最后综合：

```text
Visual Score
```

但内部可以保留详细问题，不建议只输出一个分数。

---

# 18. Auto Fix Loop

整个系统最重要的闭环：

```text
             ┌──────────────┐
             │   Developer  │
             └──────┬───────┘
                    ↓
                 Build
                    ↓
               Simulator
                    ↓
                Screenshot
                    ↓
             ┌──────────────┐
             │ Visual QA    │
             └──────┬───────┘
                    ↓
                Problems
                    ↓
              Fix Task
                    ↓
             ┌──────────────┐
             │   Developer  │
             └──────────────┘
                    │
                    └──────────→ Build
```

设置最大循环次数：

```yaml
max_iterations: 5
```

避免 Agent 无限修复。

---

# 19. Context 管理

这是 Multi-Agent 系统容易失败的地方。

不能把整个项目历史全部塞给 Agent。

采用：

```text
Global Context
+
Task Context
+
Relevant Artifacts
+
Previous Failures
```

例如 Developer 只需要：

```text
Project Architecture
+
Current Task
+
Relevant UI Spec
+
Relevant Files
+
Previous QA Result
```

而不是整个 Agent History。

---

# 20. Artifact System

统一管理：

```text
artifacts/

research/
product/
design/
architecture/
planning/
implementation/
testing/
review/
```

例如：

```text
artifacts/
├── product-spec.md
├── design-spec.md
├── architecture.md
├── task-graph.yaml
├── test-report.json
├── visual-review.json
└── fix-plan.md
```

Artifact 必须版本化。

---

# 21. Event System

所有操作产生 Event：

```json
{
  "event": "task.completed",
  "task_id": "T005",
  "agent": "ios-developer",
  "timestamp": "...",
  "files_changed": [
    "HomeView.swift"
  ]
}
```

事件类型：

```text
project.created
task.created
task.started
agent.started
tool.called
file.changed
build.started
build.failed
test.started
test.failed
review.started
review.failed
fix.started
task.completed
workflow.completed
```

这为以后做 Web UI Dashboard 做准备。

---

# 22. 权限模型

这个一定要从第一版设计。

Agent 不应该拥有无限权限。

例如：

```yaml
permissions:

filesystem:
  read:
    - Sources/**
  write:
    - Sources/Home/**

shell:
  allow:
    - xcodebuild
    - xcrun
    - git
  deny:
    - rm -rf
    - sudo
```

尤其是：

> **不同 Agent 的文件修改范围必须隔离。**

---

# 23. Git Strategy

建议每个 Task 使用独立 branch：

```text
main
 │
 ├── task/T005-home
 ├── task/T006-editor
 └── task/T007-export
```

完成后：

```text
Task
 ↓
Build
 ↓
Test
 ↓
Review
 ↓
Merge
```

失败：

```text
Task branch
 ↓
Discard
```

这样 Agent 搞坏代码时可以快速回滚。

---

# 24. 并行开发

Task Graph 支持：

```text
          Architecture
                │
       ┌────────┼────────┐
       ↓        ↓        ↓
     Home    Editor    Settings
       │        │        │
       └────────┼────────┘
                ↓
              QA
```

三个 Agent 可以并行。

但是共享文件必须有冲突检测：

```text
Agent A → HomeView.swift
Agent B → HomeView.swift
```

禁止同时执行。

---

# 25. 项目目录建议

AIRE 自身：

```text
aire/
├── Sources/
│
├── Core/
│   ├── Workflow/
│   ├── Task/
│   ├── Agent/
│   ├── Context/
│   └── Event/
│
├── Runtime/
│   ├── Codex/
│   ├── Claude/
│   ├── Gemini/
│   └── OpenCode/
│
├── Evaluator/
│   ├── Build/
│   ├── Test/
│   ├── Visual/
│   └── Review/
│
├── iOS/
│   ├── Xcode/
│   ├── Simulator/
│   └── XCTest/
│
├── Storage/
│
└── CLI/
```

---

# 26. 项目配置

用户项目：

```text
my-replica/
├── .aire/
│   ├── project.yaml
│   ├── agents/
│   ├── workflows/
│   ├── tasks/
│   ├── artifacts/
│   └── evaluations/
│
├── reference/
│   ├── screenshots/
│   ├── videos/
│   └── documents/
│
├── requirements/
│   └── requirements.md
│
└── iOSProject/
```

---

# 27. 一次完整执行

用户：

```bash
aire init
```

然后：

```bash
aire analyze
```

得到：

```text
Product Spec
UI Spec
Architecture
```

接下来：

```bash
aire plan
```

得到：

```text
Task Graph
```

然后：

```bash
aire run
```

整个过程：

```text
[1/10] Product Analysis       ✓
[2/10] UI Analysis            ✓
[3/10] Architecture           ✓
[4/10] Task Planning          ✓

[5/10] Implement Home         ✓
[6/10] Implement Editor       ✓
[7/10] Build                  ✓
[8/10] Functional Test        ✓

[9/10] Visual Review          ✗
      ├─ Header spacing
      ├─ Font size
      └─ Background color

[10/10] Auto Fix              ✓

Visual Review #2              ✓

PROJECT COMPLETED
```

---

# 28. MVP 不要一次实现全部能力

我建议严格分三阶段。

## Phase 1：Coding Orchestrator

目标：

```text
Spec
 ↓
Plan
 ↓
Task Graph
 ↓
Codex
 ↓
Build
 ↓
Test
 ↓
Fix
```

暂时不做复杂视觉。

支持：

* Codex
* Claude Code
* Gemini CLI

重点验证：

> **AI 能不能真正自主完成一个完整开发任务。**

---

# 29. Phase 2：iOS Replica Engine

加入：

```text
Screenshot
 ↓
Vision Analysis
 ↓
SwiftUI Implementation
 ↓
Simulator
 ↓
Screenshot
 ↓
Visual Review
 ↓
Fix
```

同时加入：

* Xcode
* Simulator
* XCUITest
* OCR
* Screenshot Diff

这个阶段才真正实现：

> **AI iOS App Replica Engine**

---

# 30. Phase 3：通用软件工程平台

最后再抽象：

```text
                    AIRE
                     │
        ┌────────────┼────────────┐
        ↓            ↓            ↓
       iOS          Web         Backend
        │            │            │
    Simulator      Browser       Docker
        │            │            │
       QA           Playwright    Tests
```

变成通用：

> **AI Software Engineering Engine**

---

# 31. 与现有开源项目的关系

建议不要从零设计所有东西。

可以参考以下项目：

```text
| 项目              | AIRE 主要参考内容                                     |
| --------------- | ----------------------------------------------- |
| **Legion**      | Multi-CLI 编排、Agent Registry、Workflow、任务阶段管理     |
| **OpenHands**   | Agent Runtime、Tool 调用、Workspace、Agent Loop、自主执行 |
| **Conductor**   | Spec → Plan → Task、Context 管理、任务状态、Git 回滚       |
| **MetaGPT**     | 多角色协作、Role 定义、SOP、Artifact 交接                   |
| **SWE-agent**   | Coding → Test → Error → Fix 的自动修复闭环             |
| **Auto-Claude** | 自动任务执行、任务隔离、QA、长任务恢复                            |

### AIRE 自己重点实现

```text
Reference App
    ↓
需求/视觉分析
    ↓
Spec
    ↓
Task Graph
    ↓
Multi-Agent Implementation
    ↓
Xcode Build
    ↓
iOS Simulator
    ↓
XCUITest
    ↓
Screenshot / Visual QA
    ↓
Auto Fix
    ↓
Re-test
```

其中：

* **Legion** → 编排层
* **OpenHands** → Agent 执行层
* **Conductor** → Spec/Plan 层
* **MetaGPT** → 多角色模型
* **SWE-agent** → 修复闭环
* **Auto-Claude** → 自动执行机制
* **AIRE 自研** → iOS Runtime + Visual QA + Replica Workflow

建议优先研究顺序：**Legion → OpenHands → Conductor → SWE-agent → MetaGPT → Auto-Claude**。
```

而 AIRE 自己重点实现：

```text
                 AIRE
                  │
       ┌──────────┴──────────┐
       ↓                     ↓
iOS Environment       Visual Evaluation
       │                     │
 Simulator              Screenshot
 Xcode                  OCR / CV
 XCUITest               Vision LLM
       │                     │
       └──────────┬──────────┘
                  ↓
             Auto Fix Loop
```

这部分才是你的核心差异化。

---

# 32. 最关键的技术挑战

这个项目真正困难的地方，我认为有 6 个。

### ① Agent 协作质量

不是 Agent 越多越好。

核心是：

> **正确的任务交给正确的 Agent。**

---

### ② Task Decomposition

Planner 如果拆错：

```text
错误 Task
 ↓
错误依赖
 ↓
错误实现
 ↓
大量返工
```

所以 Task Graph 是核心资产。

---

### ③ Agent Context

上下文太少：

> Agent 不知道项目。

上下文太多：

> Agent 注意力下降、成本增加。

必须做 Context Selection。

---

### ④ Visual Evaluation

这是目前最值得投入研发的部分。

因为：

```text
Build PASS
≠
App PASS
```

而：

```text
XCUITest PASS
≠
UI 像参考 App
```

所以必须增加 Visual QA。

---

### ⑤ 自动修复稳定性

不能：

```text
发现问题
 ↓
AI 随便改
 ↓
引入新问题
```

必须：

```text
Issue
 ↓
Fix Scope
 ↓
Fix
 ↓
Build
 ↓
Regression Test
 ↓
Visual Review
```

---

### ⑥ 安全性

因为 Agent 可以执行：

```text
shell
git
xcodebuild
xcrun
filesystem
```

所以一定要做：

```text
Sandbox
Permission
Allowlist
Git Isolation
Command Policy
```

---

# 33. 我认为最重要的设计理念

整个 AIRE 可以浓缩成一句话：

> **Agent 不负责“完成任务”，Agent 负责“执行下一步可验证的行动”。**

例如不要：

```text
Developer Agent：
把首页做好。
```

而应该：

```text
Task:
Implement Home Screen

Success:
1. Build succeeds
2. Home appears
3. Screenshot generated
4. Reference comparison passes
5. Existing tests remain passing
```

于是：

```text
AI
 ↓
Action
 ↓
Observation
 ↓
Evaluation
 ↓
Next Action
```

最终形成：

# **Observe → Plan → Act → Verify → Fix**

这是整个项目最核心的 Agent Loop。

---

# 34. 最终产品形态

我认为最终最好做成：

```text
┌──────────────────────────────────────────┐
│ AIRE                                     │
├──────────────────────────────────────────┤
│                                          │
│  Project: Firefly Replica                │
│                                          │
│  ● Research              Completed       │
│  ● Product Spec          Completed       │
│  ● Architecture          Completed       │
│  ● Task Planning         Completed       │
│  ◉ Implementation        Running         │
│  ○ Functional QA                         │
│  ○ Visual QA                             │
│  ○ Auto Fix                              │
│                                          │
├──────────────────────────────────────────┤
│ Agents                                   │
│                                          │
│ 🧑‍💼 Product Analyst       ✓              │
│ 🎨 UI Analyst             ✓              │
│ 🏗 Architect              ✓              │
│ 👨‍💻 iOS Developer         ●              │
│ 🧪 QA Engineer            waiting        │
│ 👁 Visual Reviewer        waiting        │
│                                          │
├──────────────────────────────────────────┤
│ Simulator                                │
│                                          │
│        [ iPhone Simulator ]               │
│                                          │
├──────────────────────────────────────────┤
│ Evaluation                               │
│                                          │
│ Build       ✓                            │
│ Tests       ✓  24/24                     │
│ Visual      82% → fixing                 │
│                                          │
└──────────────────────────────────────────┘
```

这时候它就已经不只是一个 CLI Wrapper，而是一个真正的：

> **AI Software Development Control Plane。**

---

## 35. 我建议你的第一版技术选型

如果这个项目是你自己准备实际开发，我会选：

```text
Language:
TypeScript

Runtime:
Node.js

CLI:
Commander / Ink

State:
SQLite

Workflow:
自研 DAG + State Machine

Agent Runtime:
CLI Adapter

AI:
Codex / Claude / Gemini / OpenCode

Project:
Git

iOS:
Xcode + xcodebuild + simctl + XCTest

Visual:
Screenshot + OCR + Vision LLM

Config:
YAML

Logs:
JSONL

Artifacts:
Filesystem + SQLite Metadata
```

**不要一开始上 Kubernetes、Redis、Kafka、Temporal。**

第一版完全可以：

```text
Mac
 │
 ├── AIRE
 ├── SQLite
 ├── Git
 ├── Xcode
 ├── Simulator
 └── AI CLI
```

跑起来。

等真正出现长任务、并发 Agent、断点恢复、远程执行的需求，再考虑 Temporal / Redis / Docker 等基础设施。

---

# 36. 最终 MVP 验收标准

我会把第一阶段的成功标准定义得非常具体：

> 给 AIRE 一个空的 SwiftUI 项目 + 一份结构化需求。

AIRE 能够：

* 自动分析需求
* 自动生成 Spec
* 自动拆解 Task
* 自动选择 Agent
* 自动调用 Codex/Claude Code
* 自动修改代码
* 自动 Git commit
* 自动执行 `xcodebuild`
* 自动发现 Build Error
* 自动创建 Fix Task
* 自动重新执行
* 自动运行 XCTest/XCUITest
* 测试失败后自动修复
* 最终输出完整 Execution Report

第二阶段再增加：

> **给 AIRE 参考截图 + 需求，它能够自主完成 iOS UI 复刻，并通过 Simulator 截图进行视觉验收和自动修复。**