# AIRE Sub-project 3: DAG 任务图编排与工程级状态机 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建轻量嵌入式拓扑 DAG 调度编排引擎，实现多任务依赖解析、确定性拓扑调度、原子分支失败隔离与级联阻断、防漂移断点续跑（Resume）以及基于结构化契约索引的直接依赖产物交接（Structured Artifact Hand-Off）。

**Architecture:** 严格解耦图调度决策（`TaskGraph`）、单任务执行（`TaskRunner`）、工作区隔离策略（`IWorkspaceStrategy`）、容错策略（`IExecutionPolicy`）、全局断点状态（`IRunStateStore`）与任务产物索引（`IArtifactManager`）。采用 WAL 风格原子持久化时序与机器可验证的 Git Commit Trailer 实现高可靠 Crash Recovery。

**Tech Stack:** TypeScript (Node.js `--experimental-strip-types`), `yaml` npm 包, Git 原生 CLI (`git interpret-trailers`, `git diff`, `git reset`), macOS 原生 `xcrun simctl` 与 `xcodebuild`.

**Spec:** [`docs/superpowers/specs/2026-09-18-aire-subproject3-task-graph-dag-engine-design.md`](../specs/2026-09-18-aire-subproject3-task-graph-dag-engine-design.md)

## Global Constraints

- **Node.js 执行环境**：使用 `node --experimental-strip-types` 原生运行 TypeScript，无需额外转译或打包步骤。
- **环境 PATH**：所有 Node/npm 命令必须确保包含 `/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH`。
- **向后兼容性**：Sub-project 1 与 Sub-project 2 已有的全部 45 个单元与集成测试必须持续保持 100% 通过。
- **测试金字塔与速度**：Layer 1 单测与 Layer 2 集成测试必须在内存/Mock 环境中运行，不强依赖真实 Xcode 模拟器，全量测试执行时间控制在 15 秒以内。
- **单一状态写者（Single Writer）**：`TaskGraph` 纯负责图论计算；`IExecutionPolicy` 仅输出决策枚举；所有状态变更统一由 `Scheduler` 执行与持久化。
- **持久化一致性与 WAL 风格时序**：`saveRunState` 必须使用临时文件 + fsync + 原子重命名（`atomic rename`）；成功分支遵循 `commit -> persist TaskResult -> persist RunState`。
- **机器可验证 Git Trailer**：每个任务提交必须注入 `AIRE-Run-Id`, `AIRE-Task-Id`, `AIRE-Base-Commit`。
- **直接依赖契约**：下游任务 Prompt 只挂载直接依赖的 `TaskResult`，严禁累积全图聊天记录或全量祖先记录。

---

## File Structure

```text
src/
├── dag/
│   ├── types.ts                              # DAG 核心类型、节点、状态与报告接口
│   ├── task-graph.ts                         # TaskGraph 拓扑解析、环检测与就绪推导
│   ├── artifact-manager.interface.ts         # IArtifactManager 抽象接口
│   ├── artifact-manager.ts                   # 任务级产物存储与幂等重建实现
│   ├── run-state-store.interface.ts          # IRunStateStore 抽象接口
│   ├── run-state-store.ts                    # 全局运行状态原子落盘与 Schema 迁移
│   ├── workspace-strategy.interface.ts       # IWorkspaceStrategy 抽象接口
│   ├── serial-workspace-strategy.ts          # 基于主分支与 Git Trailer 的工作区策略
│   ├── execution-policy.interface.ts         # IExecutionPolicy 抽象接口
│   ├── cascade-execution-policy.ts           # 失败隔离与子孙级联阻断决策策略
│   ├── prompt-builder-dag.ts                 # 直接前置依赖契约装配器
│   ├── task-runner.interface.ts              # ITaskRunner 抽象接口
│   ├── task-runner.ts                        # 动态评估管道组装与单任务状态机适配器
│   ├── scheduler.interface.ts                # IScheduler 抽象接口
│   └── serial-dag-scheduler.ts               # 拓扑主调度器与 Crash Recovery
bin/
└── aire.ts                                   # CLI 入口增加 --task-graph, --resume, --retry-task
fixtures/
└── MiniApp/
    └── task-graph.yaml                       # MiniApp 多任务拓扑靶场配置
tests/
├── unit/
│   └── dag/
│       ├── task-graph.test.ts                # YAML 解析、环检测与拓扑推导单测
│       ├── artifact-manager.test.ts          # 产物保存、过滤与幂等重建单测
│       ├── run-state-store.test.ts           # 原子写入、哈希防漂移与版本迁移单测
│       ├── workspace-strategy.test.ts        # 快照捕获、Trailer 注入与回滚单测
│       ├── execution-policy.test.ts          # 级联阻断与重试状态重算单测
│       ├── prompt-builder-dag.test.ts        # 直接依赖 Prompt 装配单测
│       └── task-runner.test.ts               # 动态评估管道装配单测
├── integration/
│   ├── dag-diamond-flow.test.ts              # 菱形依赖 A->(B,C)->D 成功全链路集成测试
│   ├── dag-failure-cascade.test.ts           # 单分支自愈失败隔离与平行分支继续测试
│   └── dag-crash-recovery.test.ts            # 崩溃恢复 3 大场景集成测试
└── e2e/
    └── dag-cli.test.ts                       # aire run --task-graph 端到端测试
```

---

### Task 1: 引入 YAML 解析依赖与 DAG 核心类型定义（Types & YAML Dep）

**Files:**
- Modify: `package.json`
- Create: `src/dag/types.ts`
- Test: `tests/unit/dag/task-graph-types.test.ts`

**Interfaces:**
- Produces:
  - `TaskExecutionStatus`: `'PENDING' | 'READY' | 'RUNNING' | 'VERIFYING' | 'REPAIRING' | 'RETRYING' | 'SUCCEEDED' | 'FAILED' | 'BLOCKED' | 'CANCELLED'`
  - `TaskNode`: 包含 `id`, `title`, `goal`, `dependencies`, `dependents`, `allowed_files`, `acceptance_criteria`, `verification`, `max_retries`
  - `TaskGraphConfig`: 包含 `version`, `project`, `tasks`
  - `DagRunState`: 包含 `schemaVersion`, `graphVersion`, `graphHash`, `runId`, `status`, `activeTaskIds`, `tasks`
  - `TaskResult`: 包含 `taskId`, `summary`, `changedFiles`, `artifacts`, `apiContracts`, `baseCommit`, `commit`

- [ ] **Step 1: 安装 yaml 依赖并配置 package.json**

```bash
export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH"
npm install yaml
```

- [ ] **Step 2: 编写针对类型导出的失败单元测试**

创建 `tests/unit/dag/task-graph-types.test.ts`：
```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import type { TaskExecutionStatus, TaskNode, DagRunState, TaskResult } from '../../../src/dag/types.ts';

test('TaskExecutionStatus covers all required lifecycle states', () => {
  const statuses: TaskExecutionStatus[] = [
    'PENDING', 'READY', 'RUNNING', 'VERIFYING',
    'REPAIRING', 'RETRYING', 'SUCCEEDED', 'FAILED',
    'BLOCKED', 'CANCELLED'
  ];
  assert.equal(statuses.length, 10);
});
```

- [ ] **Step 3: 编写 `src/dag/types.ts`**

定义完整的接口与枚举类型（完全对应设计文档第 2、3 节）。

- [ ] **Step 4: 运行单测验证**

```bash
export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH"
node --experimental-strip-types --test tests/unit/dag/task-graph-types.test.ts
```
Expected: PASS。

- [ ] **Step 5: 提交更改**

```bash
git add package.json package-lock.json src/dag/types.ts tests/unit/dag/task-graph-types.test.ts
git commit -m "feat(dag): introduce yaml dependency and define core DAG types"
```

---

### Task 2: TaskGraph 拓扑图模型与环检测实现（TaskGraph & Cycle Detection）

**Files:**
- Create: `src/dag/task-graph.ts`
- Test: `tests/unit/dag/task-graph.test.ts`

**Interfaces:**
- Consumes: `TaskNode`, `TaskGraphConfig`, `TaskExecutionStatus` from `src/dag/types.ts`
- Produces:
  - `class TaskGraph`:
    - `static fromYaml(yamlContent: string): TaskGraph`
    - `getAllTasks(): TaskNode[]`
    - `getTask(id: string): TaskNode | undefined`
    - `getDirectDependencies(id: string): TaskNode[]`
    - `getDirectDependents(id: string): TaskNode[]`
    - `getTransitiveDependents(id: string): TaskNode[]`
    - `computeReadyTasks(records: Record<string, { status: TaskExecutionStatus }>): TaskNode[]`
  - `class CycleDetectedError extends Error`: 包含循环路径 `cyclePath: string[]`

- [ ] **Step 1: 编写拓扑解析与环检测失败单元测试**

在 `tests/unit/dag/task-graph.test.ts` 中编写：
1. 正常线性图解析与反向 `dependents` 校验；
2. 环检测异常（如 A->B->C->A）断言抛出 `CycleDetectedError`；
3. 未知依赖引用异常断言抛错；
4. `computeReadyTasks` 根据状态推导就绪节点。

- [ ] **Step 2: 运行测试确认失败**

```bash
export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH"
node --experimental-strip-types --test tests/unit/dag/task-graph.test.ts
```
Expected: FAIL（模块未实现）。

- [ ] **Step 3: 编写 `src/dag/task-graph.ts` 实现**

实现 YAML 解析（使用 `yaml.parse`）、DFS 染色法环检测算法、反向依赖构建与 `computeReadyTasks`。

- [ ] **Step 4: 运行测试验证**

```bash
export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH"
node --experimental-strip-types --test tests/unit/dag/task-graph.test.ts
```
Expected: PASS。

- [ ] **Step 5: 提交更改**

```bash
git add src/dag/task-graph.ts tests/unit/dag/task-graph.test.ts
git commit -m "feat(dag): implement TaskGraph parser, cycle detection, and ready state derivation"
```

---

### Task 3: 任务产物与契约索引管理器（ArtifactManager & Result Reconstruction）

**Files:**
- Create: `src/dag/artifact-manager.interface.ts`
- Create: `src/dag/artifact-manager.ts`
- Test: `tests/unit/dag/artifact-manager.test.ts`

**Interfaces:**
- Consumes: `TaskResult`, `TaskNode` from `src/dag/types.ts`
- Produces:
  - `IArtifactManager`:
    - `saveTaskResult(projectPath: string, result: TaskResult): Promise<void>`
    - `getTaskResult(projectPath: string, taskId: string): Promise<TaskResult | null>`
    - `getDirectDependencyResults(projectPath: string, dependencyIds: string[]): Promise<TaskResult[]>`
    - `reconstructTaskResult(projectPath: string, task: TaskNode, baseCommit: string, commit: string, changedFiles: string[]): Promise<TaskResult>`

- [ ] **Step 1: 编写 ArtifactManager 失败单元测试**

在 `tests/unit/dag/artifact-manager.test.ts` 中测试：
1. 保存并读取 `.aire/tasks/<taskId>/result.json`；
2. 批量读取只获取直接依赖项，不存在时返回空；
3. `reconstructTaskResult` 根据元数据和文件列表生成合法的 `TaskResult` 并写入文件。

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现 `src/dag/artifact-manager.interface.ts` 与 `src/dag/artifact-manager.ts`**

实现文件目录自动创建（`mkdir -p .aire/tasks/<taskId>`）与 JSON 读写，保证幂等重建逻辑。

- [ ] **Step 4: 运行测试验证通过**

```bash
export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH"
node --experimental-strip-types --test tests/unit/dag/artifact-manager.test.ts
```
Expected: PASS。

- [ ] **Step 5: 提交更改**

```bash
git add src/dag/artifact-manager.interface.ts src/dag/artifact-manager.ts tests/unit/dag/artifact-manager.test.ts
git commit -m "feat(dag): implement ArtifactManager with direct dependency filtering and reconstruction"
```

---

### Task 4: 全局断点状态存储器与原子落盘（RunStateStore & Schema Migration）

**Files:**
- Create: `src/dag/run-state-store.interface.ts`
- Create: `src/dag/run-state-store.ts`
- Test: `tests/unit/dag/run-state-store.test.ts`

**Interfaces:**
- Consumes: `DagRunState` from `src/dag/types.ts`
- Produces:
  - `IRunStateStore`:
    - `saveRunState(projectPath: string, state: DagRunState): Promise<void>` (temp -> fsync -> rename)
    - `loadRunState(projectPath: string): Promise<DagRunState | null>`
    - `computeGraphHash(rawYamlContent: string): string`
  - `GraphDriftError`: 哈希不匹配报错
  - `UnsupportedSchemaVersionError`: 未知高版本报错

- [ ] **Step 1: 编写 RunStateStore 失败单元测试**

在 `tests/unit/dag/run-state-store.test.ts` 中测试：
1. `computeGraphHash` 生成稳定的 SHA-256 哈希值；
2. 原子写入校验：确认写入时产生 `.aire/run-state.json.tmp` 并原子替换目标文件；
3. 状态读取与 Schema 版本检查；
4. 遇到更高未支持主版本时抛出 `UnsupportedSchemaVersionError`。

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 编写 `src/dag/run-state-store.ts` 实现**

使用 `node:crypto` 的 `createHash('sha256')`，使用 `fs.promises.writeFile`、`fs.open` + `sync`，以及 `fs.promises.rename` 实现原子替换。

- [ ] **Step 4: 运行测试验证通过**

```bash
export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH"
node --experimental-strip-types --test tests/unit/dag/run-state-store.test.ts
```
Expected: PASS。

- [ ] **Step 5: 提交更改**

```bash
git add src/dag/run-state-store.interface.ts src/dag/run-state-store.ts tests/unit/dag/run-state-store.test.ts
git commit -m "feat(dag): implement RunStateStore with atomic rename, hash drift detection, and schema migration"
```

---

### Task 5: 工作区策略与 Git Commit Trailer 机器校验（WorkspaceStrategy）

**Files:**
- Create: `src/dag/workspace-strategy.interface.ts`
- Create: `src/dag/serial-workspace-strategy.ts`
- Test: `tests/unit/dag/workspace-strategy.test.ts`

**Interfaces:**
- Consumes: `WorkspaceContext`, `CommitMetadata` from `src/dag/types.ts`
- Produces:
  - `IWorkspaceStrategy`:
    - `prepareWorkspace(ctx: WorkspaceContext): Promise<void>`
    - `captureSnapshot(ctx: WorkspaceContext): Promise<string>`
    - `rollbackWorkspace(ctx: WorkspaceContext, baseCommit: string): Promise<void>`
    - `commitTaskWorkspace(ctx: WorkspaceContext, meta: CommitMetadata): Promise<string>`
    - `extractChangedFiles(ctx: WorkspaceContext, baseCommit: string): Promise<string[]>`
    - `verifyCommitBelongsToTask(projectPath: string, commitSha: string, taskId: string, runId: string): Promise<boolean>`
    - `cleanupWorkspace(ctx: WorkspaceContext): Promise<void>`

- [ ] **Step 1: 编写 WorkspaceStrategy 失败单元测试**

在 `tests/unit/dag/workspace-strategy.test.ts` 中测试（利用临时 Git 仓库）：
1. 捕获 clean commit sha；
2. 提交代码并注入标准 Git Trailers（`AIRE-Run-Id`, `AIRE-Task-Id`, `AIRE-Base-Commit`）；
3. 提取 `extractChangedFiles` 返回相对文件列表；
4. `verifyCommitBelongsToTask` 验证 Trailer 是否准确匹配；
5. `rollbackWorkspace` 回滚脏代码并验证恢复到 `baseCommit`。

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 编写 `src/dag/serial-workspace-strategy.ts` 实现**

调用 `git` 命令完成提交与 `git log -1 --format="%(trailers:key=AIRE-Task-Id,valueonly)"` 解析。

- [ ] **Step 4: 运行测试验证通过**

```bash
export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH"
node --experimental-strip-types --test tests/unit/dag/workspace-strategy.test.ts
```
Expected: PASS。

- [ ] **Step 5: 提交更改**

```bash
git add src/dag/workspace-strategy.interface.ts src/dag/serial-workspace-strategy.ts tests/unit/dag/workspace-strategy.test.ts
git commit -m "feat(dag): implement SerialWorkspaceStrategy with Git trailer metadata and verification"
```

---

### Task 6: 容错决策与依赖级联阻断策略（CascadeExecutionPolicy）

**Files:**
- Create: `src/dag/execution-policy.interface.ts`
- Create: `src/dag/cascade-execution-policy.ts`
- Test: `tests/unit/dag/execution-policy.test.ts`

**Interfaces:**
- Consumes: `TaskNode`, `TaskGraph`, `FailureDecision`
- Produces:
  - `IExecutionPolicy`:
    - `onTaskFailure(task: TaskNode, error: TaskError, graph: TaskGraph): FailureDecision`
  - `class CascadeExecutionPolicy implements IExecutionPolicy`:
    - 提供根据失败节点计算所有需要被置为 `BLOCKED` 的下游子孙节点列表方法

- [ ] **Step 1: 编写 CascadeExecutionPolicy 失败单元测试**

在 `tests/unit/dag/execution-policy.test.ts` 中测试：
1. 任务失败返回 `FailureDecision.CASCADE_BLOCK_AND_CONTINUE`；
2. 菱形依赖中，B 失败时精确推导 D 需要被阻断，而 C 绝不在阻断名单中；
3. 支持多级传递阻断（B -> D -> E）。

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 编写 `src/dag/cascade-execution-policy.ts` 实现**

使用图模型的 `getTransitiveDependents` 计算受阻节点。

- [ ] **Step 4: 运行测试验证通过**

```bash
export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH"
node --experimental-strip-types --test tests/unit/dag/execution-policy.test.ts
```
Expected: PASS。

- [ ] **Step 5: 提交更改**

```bash
git add src/dag/execution-policy.interface.ts src/dag/cascade-execution-policy.ts tests/unit/dag/execution-policy.test.ts
git commit -m "feat(dag): implement CascadeExecutionPolicy with selective branch blocking"
```

---

### Task 7: 任务 Prompt 注入与直接依赖装配（PromptBuilderDag）

**Files:**
- Create: `src/dag/prompt-builder-dag.ts`
- Test: `tests/unit/dag/prompt-builder-dag.test.ts`

**Interfaces:**
- Consumes: `TaskNode`, `TaskResult`
- Produces:
  - `function buildDagTaskPrompt(task: TaskNode, directDependencyResults: TaskResult[]): string`

- [ ] **Step 1: 编写 Prompt 装配失败单元测试**

在 `tests/unit/dag/prompt-builder-dag.test.ts` 中测试：
1. 生成包含当前任务 Goal, Role, Allowed Files, Acceptance Criteria 的结构化 Markdown；
2. 注入所有直接依赖的 `TaskResult`（摘要、变更文件、Commit、API 契约、文档产物）；
3. 注入明确准则："Git 工作区代码是唯一的真实事实源"；
4. 验证传入空依赖时仅生成自身任务描述。

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 编写 `src/dag/prompt-builder-dag.ts` 实现**

格式化输出严谨、高信息密度的 Prompt 模板。

- [ ] **Step 4: 运行测试验证通过**

```bash
export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH"
node --experimental-strip-types --test tests/unit/dag/prompt-builder-dag.test.ts
```
Expected: PASS。

- [ ] **Step 5: 提交更改**

```bash
git add src/dag/prompt-builder-dag.ts tests/unit/dag/prompt-builder-dag.test.ts
git commit -m "feat(dag): implement buildDagTaskPrompt with direct predecessor contract mounting"
```

---

### Task 8: 单任务执行适配器与动态评估管道装配（TaskRunner）

**Files:**
- Create: `src/dag/task-runner.interface.ts`
- Create: `src/dag/task-runner.ts`
- Test: `tests/unit/dag/task-runner.test.ts`

**Interfaces:**
- Consumes: `TaskNode`, `TaskResult`, `ICliAdapter`, `StateMachine`, `EvaluatorPipeline`
- Produces:
  - `ITaskRunner`:
    - `executeTask(task: TaskNode, projectPath: string, runId: string, dependencyResults: TaskResult[], baseCommit: string, onStateChange: (status: TaskExecutionStatus) => Promise<void>): Promise<TaskExecutionOutcome>`

- [ ] **Step 1: 编写 TaskRunner 失败单元测试**

在 `tests/unit/dag/task-runner.test.ts` 中测试：
1. 当 `task.verification` 仅有 `build: true` 时，仅创建 `XcodeBuildEvaluator`；
2. 当 `task.verification` 包含 `visual` 配置时，自动组装 `[XcodeBuildEvaluator, VisualReviewEvaluator]`；
3. 验证回调函数 `onStateChange` 正确触发 `RUNNING`, `VERIFYING`, `SUCCEEDED` / `FAILED` 等跃迁。

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 编写 `src/dag/task-runner.ts` 实现**

结合 `buildDagTaskPrompt` 组装任务上下文，调度 `EvaluatorPipeline` 与 `StateMachine`。

- [ ] **Step 4: 运行测试验证通过**

```bash
export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH"
node --experimental-strip-types --test tests/unit/dag/task-runner.test.ts
```
Expected: PASS。

- [ ] **Step 5: 提交更改**

```bash
git add src/dag/task-runner.interface.ts src/dag/task-runner.ts tests/unit/dag/task-runner.test.ts
git commit -m "feat(dag): implement TaskRunner with dynamic EvaluatorPipeline assembly and state emission"
```

---

### Task 9: 拓扑 DAG 调度编排器实现（SerialDagScheduler Core Loop & Recovery）

**Files:**
- Create: `src/dag/scheduler.interface.ts`
- Create: `src/dag/serial-dag-scheduler.ts`
- Test: `tests/unit/dag/serial-dag-scheduler.test.ts`

**Interfaces:**
- Consumes: `TaskGraph`, `IWorkspaceStrategy`, `IExecutionPolicy`, `IArtifactManager`, `IRunStateStore`, `ITaskRunner`
- Produces:
  - `class SerialDagScheduler implements IScheduler`:
    - `run(graph: TaskGraph, options: SchedulerOptions): Promise<DagExecutionReport>`
    - `resume(projectPath: string, options?: SchedulerOptions): Promise<DagExecutionReport>`

- [ ] **Step 1: 编写 SerialDagScheduler 失败单元测试**

在 `tests/unit/dag/serial-dag-scheduler.test.ts` 中测试：
1. 线性双任务调度全成功，最终 Run 状态为 `SUCCEEDED`；
2. 单分支失败时阻断下游，独立平行分支顺利跑完，最终 Run 状态为 `HALTED`；
3. 断点续跑前哈希校验；
4. 支持 `--retry-task` 重置为 `PENDING` 并安全重算就绪态。

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 编写 `src/dag/serial-dag-scheduler.ts` 实现**

严格实现设计规范第 4.3 节的 WAL 风格持久化调度时序与第 4.4 节的恢复校准四步法。

- [ ] **Step 4: 运行测试验证通过**

```bash
export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH"
node --experimental-strip-types --test tests/unit/dag/serial-dag-scheduler.test.ts
```
Expected: PASS。

- [ ] **Step 5: 提交更改**

```bash
git add src/dag/scheduler.interface.ts src/dag/serial-dag-scheduler.ts tests/unit/dag/serial-dag-scheduler.test.ts
git commit -m "feat(dag): implement SerialDagScheduler core loop, cascade blocking, and crash recovery"
```

---

### Task 10: 完备的 Layer 2 集成测试套件（Integration Test Matrix）

**Files:**
- Create: `tests/integration/dag-diamond-flow.test.ts`
- Create: `tests/integration/dag-failure-cascade.test.ts`
- Create: `tests/integration/dag-crash-recovery.test.ts`

**Interfaces:**
- 覆盖三大核心集成场景：
  1. 菱形依赖全通流转（A -> B, A -> C, B & C -> D），断言全图终态为 `SUCCEEDED`；
  2. 分支失败隔离与级联阻断（B 失败，D 阻断，C 成功，终态 `HALTED`）；
  3. Crash Recovery 3 大场景（场景 1 提交前崩溃重试、场景 2 提交后 RunState 前崩溃通过 Git Trailer 自动校准为 SUCCEEDED、场景 3 RunState 标记 SUCCEEDED 但 TaskResult 缺失时幂等重建）。

- [ ] **Step 1: 编写 `tests/integration/dag-diamond-flow.test.ts` 并验证**

```bash
export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH"
node --experimental-strip-types --test tests/integration/dag-diamond-flow.test.ts
```
Expected: PASS。

- [ ] **Step 2: 编写 `tests/integration/dag-failure-cascade.test.ts` 并验证**

```bash
export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH"
node --experimental-strip-types --test tests/integration/dag-failure-cascade.test.ts
```
Expected: PASS。

- [ ] **Step 3: 编写 `tests/integration/dag-crash-recovery.test.ts` 并验证**

```bash
export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH"
node --experimental-strip-types --test tests/integration/dag-crash-recovery.test.ts
```
Expected: PASS。

- [ ] **Step 4: 运行全量测试确认 0 回归**

```bash
export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH"
npm test
```
Expected: 所有已有 45 个测试 + 新增集成测试 100% 全部 PASS！

- [ ] **Step 5: 提交更改**

```bash
git add tests/integration/dag-*.test.ts
git commit -m "test(integration): add DAG diamond flow, failure cascade, and 3-scenario crash recovery tests"
```

---

### Task 11: CLI 命令行装配与 MiniApp 靶场验证（CLI Wiring & E2E）

**Files:**
- Modify: `bin/aire.ts`
- Create: `fixtures/MiniApp/task-graph.yaml`
- Create: `tests/e2e/dag-cli.test.ts`

**Interfaces:**
- Produces:
  - `aire run --task-graph <path> [--project <dir>] [--resume] [--retry-task <id>] [--max-concurrency <n>]`
  - 完整装配 `SerialDagScheduler` 驱动端到端多任务执行

- [ ] **Step 1: 创建 `fixtures/MiniApp/task-graph.yaml` 真实靶场任务配置**

包含模型任务 `task-data-model` 与视图任务 `task-card-view`。

- [ ] **Step 2: 更新 `bin/aire.ts` 支持任务图选项**

引入 `--task-graph`、`--resume`、`--retry-task`，并在指定 `--task-graph` 时分发至 `SerialDagScheduler`。

- [ ] **Step 3: 编写 `tests/e2e/dag-cli.test.ts` 并运行验证**

```bash
export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH"
node --experimental-strip-types --test tests/e2e/dag-cli.test.ts
```
Expected: PASS。

- [ ] **Step 4: 运行全量单测、集成测试与 E2E 测试**

```bash
export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH"
npm test
npm run test:e2e
```
Expected: 全部测试 PASS。

- [ ] **Step 5: 提交更改**

```bash
git add bin/aire.ts fixtures/MiniApp/task-graph.yaml tests/e2e/dag-cli.test.ts
git commit -m "feat(cli): wire --task-graph, --resume, and --retry-task to SerialDagScheduler"
```

---

## Plan Complete

Plan complete and saved to `docs/superpowers/plans/2026-09-18-aire-subproject3-task-graph-dag-engine.md`.
