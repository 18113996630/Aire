# AIRE Sub-project 1: 核心编译与自愈闭环（Walking Skeleton）设计规范

- **文档状态**：Validated Design Spec
- **编写日期**：2026-09-18
- **所属项目**：AI iOS App Replica Engine (AIRE)
- **阶段定位**：Phase 1 / Sub-project 1（端到端最小可用切片）

---

## 1. 目标与范围（Goals & Scope）

### 1.1 背景与目标
根据 [`docs/tech.md`](../../tech.md) 的规划，AIRE 旨在构建一个面向真实 iOS 工程闭环的 Multi-Agent Coding Orchestrator。
为了避免系统一次性设计过于庞大而难以启动，本项目将整体建设拆解为多个渐进式子项目。

**Sub-project 1 的核心目标**：
实现单任务的 **「任务下发 → AI 编码 → Xcode 编译 → 错误捕获 → 自动自愈修复 → 成功提交」** 完整端到端最小可用闭环（Walking Skeleton），验证 AIRE 核心调度器、CLI 适配器与原生 Xcode 评估器之间的协作可行性。

### 1.2 非目标（Non-goals）
- 本阶段**不实现**复杂的多 Agent 协同网络与长链路 DAG 调度（规划至 Sub-project 2）。
- 本阶段**不实现**真实 Simulator 自动化启动交互、截图录制与视觉差异分析算法（规划至 Sub-project 3）。
- 本阶段**不接入**云端复杂编排服务（如 Temporal/Kafka），完全基于本地轻量状态机运行。

### 1.3 验收条件（Acceptance Criteria）
1. 提供统一 CLI 入口：`aire run --task "<任务描述>" --project "<工程路径>"`。
2. 成功集成统一 Coding CLI 适配体系（后续支持 Codex / Antigravity / Cursor），支持下发需求改写本地 iOS 工程源码。
3. 自动执行 `xcodebuild`，实现毫秒级清洗冗余日志并结构化输出 Swift 编译错误（含文件路径、行号、错误信息）。
4. 当编译报错时，自动触发修复流程（Fix Loop），将结构化错误精准回传给 AI CLI，限制最大重试次数（默认 3 次）。
5. 修复成功后自动生成 Git Commit；若超过重试上限仍未成功，自动执行 Git 回滚保护工作区代码。
6. 提供内置轻量测试靶场（`fixtures/MiniApp`）并具备 Layer 1（单元测试）、Layer 2（Mock CLI 自愈测试）和 Layer 3（真实 CLI E2E 验证）。

---

## 2. 系统架构与目录设计（Architecture & Directory Layout）

系统采用 TypeScript / Node.js 编写，保持各模块职责边界严格独立。

### 2.1 目录结构

```text
aire/
├── bin/
│   └── aire.ts                  # CLI 命令行交互入口
├── src/
│   ├── core/                    # 核心调度与状态管理
│   │   ├── state-machine.ts     # 有限状态机定义与状态跃迁约束
│   │   ├── context.ts           # 任务上下文数据结构
│   │   └── types.ts             # 核心公共类型定义
│   ├── runtime/                 # AI Coding CLI 运行时适配器
│   │   ├── adapter.interface.ts # ICliAdapter 抽象接口
│   │   ├── codex.adapter.ts     # Codex 本地 CLI 驱动实现
│   │   ├── antigravity.adapter.ts # Antigravity CLI 驱动实现
│   │   ├── cursor.adapter.ts    # Cursor 本地 CLI 驱动实现
│   │   └── mock.adapter.ts      # 零 Token 测试用 Mock 适配器
│   ├── evaluator/               # 验证与评估引擎
│   │   ├── evaluator.interface.ts # IEvaluator 统一抽象接口
│   │   ├── xcodebuild.ts        # xcodebuild 进程执行器
│   │   └── swift-error-parser.ts# Swift 编译日志正则清洗与结构化提取器
│   └── vcs/                     # 版本控制与代码隔离
│       └── git-manager.ts       # 分支创建、脏检查、暂存区提交与安全回滚
├── fixtures/
│   └── MiniApp/                 # 内置轻量 SwiftUI 靶场工程
├── tests/
│   ├── unit/                    # 状态机、错误解析器、GitManager 单元测试
│   ├── integration/             # 基于 MockAdapter 的自愈状态机流转测试
│   └── e2e/                     # 基于真实 CLI 的端到端功能验证测试
├── package.json
└── tsconfig.json
```

### 2.2 模块职责边界
- **`core`**：系统大脑，只关心任务状态流转，不直接调用底层 shell 命令。
- **`runtime`**：封装子进程通信，负责参数序列化、超时中断与退出码捕获。
- **`evaluator`**：负责将 Xcode 等底层工具的输出归一化为标准的 `EvaluationResult`。
- **`vcs`**：负责提供任务快照、工作区隔离，确保任何破坏性修改可单向回退。

---

## 3. 核心状态机与控制流（State Machine & Execution Flow）

### 3.1 状态转移定义

```text
       [IDLE]
         │ (aire run 触发)
         ▼
  [INITIALIZING] ───(项目路径无效或 Git 未配置)───► [FAILED]
         │
         ▼
  [AGENT_CODING] ◄─────────────────────────────────┐
         │                                         │
         │ (AI CLI 完成修改)                       │
         ▼                                         │
     [BUILDING]                                    │
         │                                         │
         │ (xcodebuild 产出日志)                   │
         ▼                                         │
    [EVALUATING]                                   │
         ├─── 评估通过 (passed == true) ──► [COMMITTING] ──► [COMPLETED]
         │
         ├─── 评估未过 & currentRetry < maxRetries
         │    │
         │    └─► [FIXING] (组装结构化错误) ───────┘
         │
         └─── 评估未过 & currentRetry >= maxRetries
              │
              └─► [ROLLING_BACK] (Git reset) ──► [FAILED]
```

### 3.2 任务上下文（TaskContext）数据模型

```typescript
export type TaskState =
  | 'IDLE'
  | 'INITIALIZING'
  | 'AGENT_CODING'
  | 'BUILDING'
  | 'EVALUATING'
  | 'FIXING'
  | 'COMMITTING'
  | 'ROLLING_BACK'
  | 'COMPLETED'
  | 'FAILED';

export interface TaskContext {
  taskId: string;
  projectPath: string;
  scheme: string;
  taskGoal: string;
  maxRetries: number;
  currentRetry: number;
  state: TaskState;
  branchName?: string;
  initialCommitSha?: string;
  history: Array<{
    iteration: number;
    action: 'INITIAL_PROMPT' | 'FIX_PROMPT';
    promptUsed: string;
    cliSummary?: string;
    evaluationResult?: EvaluationResult;
    timestamp: number;
  }>;
}
```

---

## 4. Evaluator 链式抽象与 Swift 错误清洗（Evaluator Pipeline）

### 4.1 统一评估器抽象（IEvaluator）
为平滑对接第二阶段的视觉/交互评审，评估层设计为插件式管道：

```typescript
export interface BuildError {
  file: string;
  line: number;
  column: number;
  message: string;
  rawSnippet?: string;
}

export interface EvaluationResult {
  passed: boolean;
  type: 'BUILD' | 'FUNCTIONAL' | 'VISUAL_REVIEW';
  summary: string;
  errors: BuildError[];
}

export interface IEvaluator {
  readonly name: string;
  evaluate(context: TaskContext): Promise<EvaluationResult>;
}
```

### 4.2 SwiftErrorParser 清洗规则
通过流式正则匹配剔除数千行编译器 flag 冗余输出，精准抽取编译故障：
- **匹配规则**：`^(?<file>.+\.swift):(?<line>\d+):(?<column>\d+):\s+error:\s+(?<message>.+)$`
- **解析产物**：标准化 `BuildError` 结构，提供给 `FixPromptBuilder` 构建轻量上下文。

### 4.3 错误自愈提示词模板（Fix Prompt Assembly）
当进入 `FIXING` 状态时，调度器自动组装高聚焦提示词：
```markdown
【自动修复指令】
上一次代码修改导致 Xcode 编译失败，请根据以下具体报错进行针对性修复：

[报错清单]
- 文件: Sources/Views/ContentView.swift (第 42 行)
  错误: cannot find 'InvalidView' in scope

[修改要求]
1. 仅修改解决上述编译错误所必需的代码。
2. 保持项目其他逻辑不变，确保类型与语法正确。
3. 请直接更新文件，无需输出无关解释。
```

---

## 5. CLI 运行时适配器（Runtime Adapter）

### 5.1 统一接口定义
```typescript
export interface CliExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface ICliAdapter {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  execute(params: {
    cwd: string;
    prompt: string;
    timeoutMs?: number;
  }): Promise<CliExecutionResult>;
}
```

### 5.2 适配器实现规范
- **`CodexCliAdapter`**：执行 Codex CLI 无头脚本模式命令，捕获标准输出和异常。
- **`AntigravityCliAdapter`**：执行 Antigravity（如 `agy` CLI）无头脚本命令，管理生命周期与异常。
- **`CursorCliAdapter`**：对接 Cursor Agent CLI 驱动，执行代码修改指令并捕获退出码。
- **`MockCliAdapter`**：内存级预制行为适配器，支持设定不同 iteration 的代码修改模拟结果，供自动化测试高速重演。

---

## 6. 版本控制与隔离策略（VCS & Workspace Protection）

1. **执行前检查（Clean Workspace Check）**：
   - 检测目标工程是否处于 Git 仓库中。
   - 检查是否有未提交修改，若有则发出告警或自动建立 WIP Checkpoint。
2. **任务隔离（Task Branching）**：
   - 每次任务可选择创建隔离分支：`task/<task-id>`。
3. **安全提交（Safe Commit）**：
   - 当 `EvaluationResult.passed === true` 时，执行 `git add -A && git commit -m "feat(aire): <taskGoal>"`。
4. **回滚保底（Rollback Guard）**：
   - 若重试达到 `maxRetries` 上限仍失败，执行 `git reset --hard <initialCommitSha>` 并记录失败原因，绝不残留损坏的中间代码。

---

## 7. 靶场工程与三层测试金字塔（Verification Strategy）

### 7.1 内置靶场工程（`fixtures/MiniApp`）
- 提供标准最小 SwiftUI 工程，包含 Scheme `MiniApp`，支持命令行 `xcodebuild -scheme MiniApp -destination 'generic/platform=iOS Simulator'` 快速编译。
- 测试运行时自动拷贝至临时工作目录，保证原工程纯净。

### 7.2 自动化测试套件
1. **Layer 1: Unit Tests（单元测试）**：
   - `swift-error-parser.test.ts`：覆盖各类复杂 Swift 报错日志匹配提取。
   - `state-machine.test.ts`：覆盖正常跳转、非法跃迁拦截、重试耗尽判定。
   - `git-manager.test.ts`：覆盖分支管理、脏文件检测、硬回滚逻辑。
2. **Layer 2: Integration Tests（集成测试）**：
   - 结合 `MockCliAdapter`，模拟首轮写入语法错误代码、次轮修复正确的端到端自愈流转。
3. **Layer 3: E2E Live Tests（真实环境端到端验证）**：
   - 调用真实 Coding CLI（Codex / Antigravity / Cursor）对测试靶场下发新增 UI 控件需求，验证全流程自动执行与最终 Commit 结果。
