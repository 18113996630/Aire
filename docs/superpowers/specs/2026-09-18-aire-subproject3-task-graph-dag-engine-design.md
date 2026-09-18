# AIRE Sub-project 3: DAG 任务图编排与工程级状态机（Task Graph & DAG Orchestrator）设计规范

- **文档状态**：Validated Design Spec
- **编写日期**：2026-09-18
- **所属项目**：AI iOS App Replica Engine (AIRE)
- **阶段定位**：Phase 3 / Sub-project 3（多任务拓扑依赖、工程级调度编排、断点续跑与任务产物交接）
- **参考规范**：[`docs/tech.md`](../../tech.md)、[`AGENTS.md`](../../../AGENTS.md)、[`docs/ui-verification-rules.md`](../../ui-verification-rules.md)

---

## 1. 目标与范围（Goals & Scope）

### 1.1 背景与目标
在前两个子项目中，AIRE 成功构建了单任务执行与自愈内核：
- **Sub-project 1**：单任务「任务下发 → AI 编码 → 编译错误捕获 → 自动自愈修复 → Git 原子提交/回滚」的最小可用闭环（Walking Skeleton）；
- **Sub-project 2**：单任务「iOS 模拟器自动化控制 → 确定性探针生成 → Refkit 像素级度量 → 视觉缺陷量化自愈闭环」。

然而，真实 iOS App 复刻（App Replica）与需求原型驱动开发（PRD & Prototype）由多个相互依赖的模块构成（数据建模 → 基础组件 → 核心视图 → 路由协调）。仅支持单任务命令行参数（`aire run --task ...`）无法支撑复杂工程。

**Sub-project 3 的核心目标**：
在已验证的单任务自愈状态机之上，构建 **轻量嵌入式拓扑 DAG 调度编排引擎**，实现多任务依赖解析、确定性拓扑调度、原子分支失败隔离与级联阻断、防漂移断点续跑（Resume）以及基于结构化契约索引的直接依赖产物交接（Structured Artifact Hand-Off）。

### 1.2 非目标（Non-goals）
- 本阶段**不引入**外部重量级工作流引擎或分布式数据库（如 Temporal、Kafka、SQLite），保持纯 Node.js / TypeScript 极简嵌入式运行；
- 本阶段**不实现**基于 Git Worktree 的全自动并行冲突合并算法，执行模型采用严格拓扑串行（`concurrency = 1`），但通过抽象稳定接口（`IWorkspaceStrategy`）为多工作区并发预留无缝扩展点；
- 本阶段**不实现**上游自动由 PRD/截图逆向生成任务图的 AI 分析 Agent（规划至 Sub-project 4），专注于任务图的高可靠调度与容错执行引擎。

### 1.3 验收条件（Acceptance Criteria）
1. **任务图规范（`task-graph.yaml`）**：
   - 严格遵循 `AGENTS.md` 规范，支持声明 `id`, `title`, `goal`, `non_goals`, `role`, `dependencies`, `allowed_files`, `acceptance_criteria`, `verification`；
   - 调度器启动时执行有向无环图校验与环检测（Cycle Detection），一旦存在循环依赖立即抛出带有完整环路径的结构化错误并安全终止。
2. **稳定架构接口与解耦**：
   - 严格解耦图调度决策与单任务执行：定义 `IScheduler`, `IWorkspaceStrategy`, `IExecutionPolicy`, `IArtifactManager`, `IRunStateStore`；
   - `TaskGraph` 纯负责图论计算，`TaskRunner` 统管单任务状态机与动态评估管道装配。
3. **失败隔离与级联阻断（Failure Cascade）**：
   - 任务重试耗尽自愈失败后，工作区原子硬重置回该任务的 `baseCommit`；
   - 仅将失败任务的所有直接/间接下游子孙节点标记为 `BLOCKED`；
   - **完全不影响互不依赖的独立平行分支继续执行**；
   - 仅当全图再无可运行节点时，全局状态才置为 `HALTED` / `FAILED`。
4. **防漂移断点续跑（Drift-Safe Resume & Crash Recovery）**：
   - 全局运行状态与崩溃恢复以 `.aire/run-state.json` 为唯一法定源，记录 `graphHash`, `graphVersion`, `schemaVersion`；
   - 状态持久化严格遵循 Write-Ahead Logging (WAL) 时序，并在恢复时通过 `baseCommit`、`commit` 与 Git HEAD 比对进行一致性校准；
   - 支持通过 `--retry-task <id>` 重置失败节点，重置后自动依 DAG 重算就绪态，杜绝多依赖节点的早熟执行。
5. **结构化契约与产物交接（Structured Artifact Hand-Off）**：
   - Git 工作区源码是唯一真相源，每个成功任务通过 `IArtifactManager` 持久化 `.aire/tasks/<taskId>/result.json` 作为“索引雷达”；
   - 下游任务 Prompt 仅挂载**直接前置依赖**的 `TaskResult`（摘要、变更文件、API 契约、文档产物路径），严格控制上下文规模。
6. **完备的三层测试金字塔**：
   - Layer 1 单元测试（YAML 解析、拓扑排序、环检测、防漂移校验、就绪状态推导、Prompt 注入）；
   - Layer 2 集成测试（菱形依赖全链路、分支失败隔离与级联阻断、崩溃恢复与 Commit 校准、修复后重试）；
   - Layer 3 E2E 测试（CLI `--task-graph` 完整驱动 MiniApp 靶场）。

---

## 2. 系统总体架构与稳定接口（Architecture & Core Interfaces）

### 2.1 架构分层模型

```text
                        ┌─────────────────────────────────────────┐
                        │            CLI Entry (aire)             │
                        │   --task-graph <path>  /  --resume      │
                        └────────────────────┬────────────────────┘
                                             │
                                             ▼
                        ┌─────────────────────────────────────────┐
                        │               IScheduler                │
                        │         (SerialDagScheduler)            │
                        └──────┬─────────────┬─────────────┬──────┘
                               │             │             │
              ┌────────────────┘             │             └────────────────┐
              ▼                              ▼                              ▼
      ┌───────────────┐            ┌──────────────────┐            ┌──────────────────┐
      │   TaskGraph   │            │IWorkspaceStrategy│            │ IExecutionPolicy │
      │ (DAG / Cycle) │            │ (Serial / Tree)  │            │(FailFastCascade) │
      └───────────────┘            └─────────┬────────┘            └──────────────────┘
                                             │ wraps workspace
                                             ▼
                                   ┌───────────────────┐
                                   │    TaskRunner     │
                                   │  (EvaluatorFact.) │
                                   └─────────┬─────────┘
                                             │ uses
                                 ┌───────────┴───────────┐
                                 ▼                       ▼
                       ┌───────────────────┐   ┌───────────────────┐
                       │ IArtifactManager  │   │   IRunStateStore  │
                       │(TaskResult Store) │   │(.aire/run-state)  │
                       └───────────────────┘   └───────────────────┘
```

### 2.2 核心接口定义

#### 2.2.1 调度器接口（`IScheduler`）
```typescript
export interface SchedulerOptions {
  projectPath: string;
  maxConcurrency?: number;   // 阶段三固定为 1
  concurrency?: number;
  retryTaskId?: string;
}

export interface DagExecutionReport {
  runId: string;
  status: 'SUCCEEDED' | 'HALTED' | 'FAILED';
  durationMs: number;
  completedTasks: string[];
  failedTasks: string[];
  blockedTasks: string[];
  taskReports: Record<string, TaskExecutionSummary>;
}

export interface IScheduler {
  run(graph: TaskGraph, options: SchedulerOptions): Promise<DagExecutionReport>;
  resume(projectPath: string, options?: SchedulerOptions): Promise<DagExecutionReport>;
}
```

#### 2.2.2 工作区策略接口（`IWorkspaceStrategy`）
抽象工作区生命周期，解耦当前主分支操作与未来的 Git Worktree 或远程容器：
```typescript
export interface WorkspaceContext {
  projectPath: string;
  taskId: string;
  allowedFiles: string[];
}

export interface IWorkspaceStrategy {
  prepareWorkspace(ctx: WorkspaceContext): Promise<void>;
  captureSnapshot(ctx: WorkspaceContext): Promise<string>; // 返回 baseCommit
  rollbackWorkspace(ctx: WorkspaceContext, baseCommit: string): Promise<void>;
  commitTaskWorkspace(ctx: WorkspaceContext, message: string): Promise<string>; // 返回 new commit
  extractChangedFiles(ctx: WorkspaceContext, baseCommit: string): Promise<string[]>;
  cleanupWorkspace(ctx: WorkspaceContext): Promise<void>;
}
```

#### 2.2.3 执行决策策略接口（`IExecutionPolicy`）
仅输出决策枚举，不直接改动图状态，由 `Scheduler` 统一实施单点状态跃迁：
```typescript
export enum FailureDecision {
  CASCADE_BLOCK_AND_CONTINUE = 'CASCADE_BLOCK_AND_CONTINUE', // 阻断子孙节点，允许无关分支继续
  ABORT_ALL = 'ABORT_ALL',                                   // 紧急全盘中断
}

export interface IExecutionPolicy {
  onTaskSuccess(task: TaskNode, result: TaskResult, graph: TaskGraph): void;
  onTaskFailure(task: TaskNode, error: TaskError, graph: TaskGraph): FailureDecision;
}
```

#### 2.2.4 产物索引与运行状态接口分离
```typescript
// 1. 任务级产物契约管理器
export interface IArtifactManager {
  saveTaskResult(projectPath: string, result: TaskResult): Promise<void>;
  getTaskResult(projectPath: string, taskId: string): Promise<TaskResult | null>;
  getDirectDependencyResults(projectPath: string, dependencyIds: string[]): Promise<TaskResult[]>;
}

// 2. 全局运行状态与断点恢复存储器
export interface IRunStateStore {
  saveRunState(projectPath: string, state: DagRunState): Promise<void>;
  loadRunState(projectPath: string): Promise<DagRunState | null>;
  computeGraphHash(rawYamlContent: string): string;
}
```

#### 2.2.5 任务执行器与评估管道工厂（`TaskRunner` & `EvaluatorFactory`）
`Scheduler` 仅下发 `TaskNode` 与上下文，动态评估器组合归属执行层：
```typescript
export interface ITaskRunner {
  executeTask(
    task: TaskNode,
    projectPath: string,
    dependencyResults: TaskResult[],
    baseCommit: string,
    onStateChange: (status: TaskExecutionStatus) => Promise<void>
  ): Promise<TaskExecutionOutcome>;
}
```

---

## 3. 数据模型与契约（Data Contracts & Schemas）

### 3.1 任务图定义（`TaskGraphYaml`）
```typescript
export interface TaskGraphVerification {
  build?: boolean | { scheme?: string };
  visual?: {
    reference: string;
    focus?: string;
    tolerance?: {
      containerDeltaMax?: number;
      spacingPtMax?: number;
      textDeltaMax?: number;
    };
  };
  test?: {
    testPlan?: string;
  };
}

export interface TaskNode {
  id: string;
  title: string;
  goal: string;
  non_goals?: string[];
  role: string;
  dependencies: string[];        // 前置依赖入度 ID 列表
  dependents: string[];          // 反向索引出度 ID 列表（解析后自动生成）
  allowed_files: string[];
  acceptance_criteria: string[];
  verification: TaskGraphVerification;
  max_retries?: number;          // 默认 3
}

export interface TaskGraphConfig {
  version: string;
  project: {
    name: string;
    targetScheme: string;
  };
  tasks: TaskNode[];
}
```

### 3.2 全局运行状态（`DagRunState`）
存储于 `.aire/run-state.json`，是 Resume 的法定事实源：
```typescript
export type TaskExecutionStatus = 
  | 'PENDING'     // 初始状态，依赖尚未全部就绪
  | 'READY'       // 依赖均已 SUCCEEDED，等待调度分发
  | 'RUNNING'     // 正在执行代码修改
  | 'VERIFYING'   // 正在执行构建/视觉评估
  | 'REPAIRING'   // 评估未通过，正在进行自愈代码修复
  | 'RETRYING'    // 自愈修复完毕，等待重新评估
  | 'SUCCEEDED'   // 验证全通且提交完成（终态）
  | 'FAILED'      // 达到重试上限，已回滚（终态）
  | 'BLOCKED'     // 因上游依赖失败被级联阻断（终态）
  | 'CANCELLED';  // 外部主动取消（终态）

export interface TaskRunRecord {
  taskId: string;
  status: TaskExecutionStatus;
  retryCount: number;
  baseCommit?: string;           // 任务开始前的纯净 Commit 快照
  commit?: string;               // 任务成功完成后的 Commit 快照
  startedAt?: string;
  completedAt?: string;
  blockedBy?: string;            // 若为 BLOCKED，记录触发阻断的根源 Task ID
  error?: { type: string; message: string };
  resultPath?: string;           // 指向 .aire/tasks/<id>/result.json
}

export interface DagRunState {
  schemaVersion: '1.0';
  graphVersion: string;
  graphHash: string;             // task-graph.yaml 的 SHA-256 哈希防漂移
  runId: string;
  graphPath: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'HALTED' | 'FAILED';
  activeTaskId: string | null;
  startedAt: string;
  updatedAt: string;
  tasks: Record<string, TaskRunRecord>;
}
```

### 3.3 任务产物与契约索引（`TaskResult`）
存储于 `.aire/tasks/<taskId>/result.json`：
```typescript
export interface TaskResult {
  taskId: string;
  title: string;
  goal: string;
  status: 'SUCCEEDED';
  summary: string;               // 任务达成的结构化摘要说明
  changedFiles: string[];        // 本任务改动的精确相对路径清单（由 Git 提取）
  artifacts: string[];           // 本任务生成的外部文档/规范产物
  apiContracts?: string[];       // 导出的核心类型名/协议声明列表
  baseCommit: string;
  commit: string;
  completedAt: string;
}
```

---

## 4. 调度算法、容错机制与 Crash Recovery

### 4.1 DAG 解析与环检测（Cycle Detection）
1. 加载 `task-graph.yaml` 时构建邻接表，校验所有引用的 `dependencies` 是否存在；
2. 运行基于深度优先遍历（DFS 染色法：White / Gray / Black）的环检测算法；
3. 若访问到 Gray 节点，回溯调用栈生成完整循环路径并抛出：
   `CycleDetectedError: Cyclic dependency detected: task-a -> task-b -> task-c -> task-a`；
4. 校验通过后，自动为每个节点建立 `dependents` 反向依赖出度集合。

### 4.2 就绪状态推导（Ready Derivation）
在调度主循环中：
```typescript
function computeReadyTasks(graph: TaskGraph, records: Record<string, TaskRunRecord>): TaskNode[] {
  return graph.getAllTasks().filter(task => {
    const record = records[task.id];
    if (record.status !== 'PENDING') return false;
    // 必须所有直接前置依赖均为 SUCCEEDED
    return task.dependencies.every(depId => records[depId]?.status === 'SUCCEEDED');
  });
}
```

### 4.3 任务执行生命周期与 WAL 持久化时序
为了防止断电或进程中断产生“代码已提交但 RunState 未记录”的不一致窗口，执行必须遵循严格时序：

```text
1. 选取 READY 节点
       │
2. WorkspaceStrategy 捕获当前 HEAD commit 作为 baseCommit
       │
3. 【WAL 持久化】RunState 更新为 RUNNING，写入 baseCommit 并存盘
       │
4. TaskRunner 驱动 StateMachine 执行（编码 -> 编译 -> 视觉质检 -> 自愈循环）
       │
   ├── 验证失败（耗尽重试）：
   │     1. WorkspaceStrategy 强制回滚：git reset --hard <baseCommit>
   │     2. ExecutionPolicy 返回 CASCADE_BLOCK_AND_CONTINUE
   │     3. 【WAL 持久化】当前任务更新为 FAILED
   │     4. 调度器遍历所有直接/间接下游子孙节点，统一步迁为 BLOCKED (blockedBy: taskId)
   │     5. 【WAL 持久化】保存更新后的任务状态清单
   │     6. 调度器检查是否还有其他独立平行分支处于 READY 或 PENDING：
   │          - 若有：主循环继续驱动独立分支！
   │          - 若无：全图无就绪节点，RunState 标记为 HALTED 并退出
   │
   └── 验证成功：
         1. WorkspaceStrategy 提交工作区：git commit -m "feat(<taskId>): <title>"
         2. 获取产生的最新 commit sha
         3. 【WAL 持久化】RunState 更新为 SUCCEEDED，写入 commit 并存盘
         4. WorkspaceStrategy 提取变更文件清单 (git diff --name-only baseCommit..commit)
         5. 构造 TaskResult 并通过 ArtifactManager 持久化至 .aire/tasks/<taskId>/result.json
         6. 调度器重新评估全图就绪节点（computeReadyTasks），解锁下游任务
```

### 4.4 防漂移断点续跑与状态校准（Resume & State Calibration）

当运行 `aire run --task-graph <path> --resume`：
1. **防漂移哈希检查**：
   - 读取指定 YAML 文件的 SHA-256；
   - 比对 `run-state.json` 中的 `graphHash` 与 `graphVersion`。若不一致，抛出 `GraphDriftError` 并提示用户不可直接 Resume。
2. **崩溃校准（Crash Calibration）**：
   - 检查 RunState 中是否存在残留的运行态（`RUNNING / VERIFYING / REPAIRING / RETRYING`）；
   - 比对当前 Git 仓库的 `HEAD` 与该任务记录的 `baseCommit`：
     - 若 `HEAD === baseCommit`：说明中断发生在提交前，工作区调用 `rollbackWorkspace` 清理任何未跟踪脏文件，任务状态重置为 `READY`；
     - 若 `HEAD !== baseCommit` 且最新 Commit 属于该任务：说明中断发生在提交后但 RunState 尚未写入，调度器自动校准补全状态为 `SUCCEEDED`，提取变更文件并补全 `TaskResult`，避免重复提交或错误回滚！
3. **修复后任务重试（`--retry-task <taskId>`）**：
   - 将指定的 `FAILED` 节点重置为 `READY`；
   - 将其所有标记为 `BLOCKED` 的下游子孙节点统一重置回 `PENDING`；
   - 重新执行 DAG 状态推导（`computeReadyTasks`），仅当子孙节点的所有直接依赖均满足 `SUCCEEDED` 时才激活，保证多依赖节点绝不早熟执行。

---

## 5. 提示词装配与直接依赖注入（Context Assembly）

当下游任务启动时，`PromptBuilder` 结合 Git 事实源与 `IArtifactManager` 注入直接依赖契约：

```typescript
export function buildDagTaskPrompt(
  task: TaskNode,
  directDependencyResults: TaskResult[]
): string {
  // 1. 注入当前任务声明：ID, Title, Role, Goal, Non-Goals, Allowed Files
  // 2. 注入 Acceptance Criteria
  // 3. 注入直接依赖任务的结构化索引：
  //    - Task ID, Title, Goal, Commit Sha
  //    - 成果摘要 (Summary)
  //    - 改动源码文件清单 (Changed Files)
  //    - 导出类型与 API 契约 (API Contracts)
  //    - 关联文档产物 (Artifacts)
  // 4. 明确注入准则："Git 工作区代码是唯一的真实事实源。请参考上述变更文件直接查阅源码与模型定义。"
}
```

---

## 6. 测试验证金字塔（Testing Pyramid）

系统将扩展测试套件，在现有 45 个测试用例保持 100% 通过的前提下，新增完备的三层验证：

### 6.1 Layer 1: 单元测试（内存/毫秒级）
- `tests/unit/dag/task-graph.test.ts`:
  - 验证标准 YAML 解析与反向出度集合推导；
  - 验证环形依赖检测，确认抛出 `CycleDetectedError` 且包含准确环路径；
  - 验证孤立节点与线性依赖的拓扑排序正确性；
  - 验证 `computeReadyTasks` 就绪节点推导。
- `tests/unit/dag/run-state-store.test.ts`:
  - 验证 `.aire/run-state.json` 读写与哈希比对防漂移机制。
- `tests/unit/dag/execution-policy.test.ts`:
  - 验证失败任务级联推导阻断子孙节点；
  - 验证平行分支不受阻断影响；
  - 验证 `--retry-task` 重置后下游回到 `PENDING` 并按依赖安全推导。
- `tests/unit/dag/prompt-builder-dag.test.ts`:
  - 验证只注入直接依赖契约，间接祖先节点不侵入上下文。

### 6.2 Layer 2: 集成测试（Mock 状态机与工作区模拟）
- `tests/integration/dag-diamond-flow.test.ts`:
  - 构造菱形依赖（`A -> B, A -> C, B & C -> D`）；
  - 验证 A 成功后调度 B 与 C，B 和 C 均成功后调度 D，全图进入 `SUCCEEDED`，Git Commit 序列线性可溯。
- `tests/integration/dag-failure-cascade.test.ts`:
  - 在菱形依赖中模拟 B 自愈失败（耗尽 3 次重试）；
  - 验证 B 自动回滚回 `baseCommit`；
  - 验证 D 自动被标记为 `BLOCKED`；
  - 验证独立分支 C 继续运行并成功（`SUCCEEDED`）；
  - 验证全图在无就绪节点后终止为 `HALTED`。
- `tests/integration/dag-crash-recovery.test.ts`:
  - 场景 1：模拟执行中崩溃（状态为 `RUNNING`），验证 Resume 自动重置并从 `baseCommit` 重新安全执行；
  - 场景 2：模拟 Commit 完成后但 RunState 写入前崩溃，验证 Resume 自动通过 HEAD 识别并校准为 `SUCCEEDED`。

### 6.3 Layer 3: 端到端 CLI 验证（E2E）
- `tests/e2e/dag-cli.test.ts`:
  - 基于真实 `fixtures/MiniApp` 靶场，提供包含多任务的 `task-graph.yaml`；
  - 运行 `aire run --task-graph fixtures/MiniApp/task-graph.yaml`；
  - 验证最终生成规范的 `.aire/run-state.json` 与 `.aire/tasks/<id>/result.json`，全链路顺利退出。
