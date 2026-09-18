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
- 本阶段**不实现**基于 Git Worktree 的全自动并行冲突合并算法，执行模型采用严格拓扑串行（`maxConcurrency = 1`），但通过抽象稳定接口（`IWorkspaceStrategy`）为多工作区并发预留无缝扩展点；
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
   - 仅当全图再无可运行节点时，调度器评估全局终态：若全部节点为 `SUCCEEDED` 则 Run 为 `SUCCEEDED`；若存在 `FAILED` 或 `BLOCKED` 则 Run 标记为 `HALTED`。
4. **防漂移断点续跑（Drift-Safe Resume & Crash Recovery）**：
   - 全局运行状态与崩溃恢复以 `.aire/run-state.json` 为唯一法定源，记录 `graphHash`, `graphVersion`, `schemaVersion`，并内置 Schema 升级迁移拦截机制；
   - 状态持久化遵循 **WAL 风格严格时序（WAL-style Persistence Ordering）** 与 **原子文件替换（Atomic Temp-Rename）** 机制；
   - Commit Message 注入机器可验证的 Git Trailer（`AIRE-Run-Id`, `AIRE-Task-Id`, `AIRE-Base-Commit`），使 Crash Recovery 能够可靠校准提交事实，杜绝重复提交与错误回滚；
   - **闭环持久化一致性链（Git → TaskResult → RunState）**：当恢复处于 `SUCCEEDED` 状态的任务时，若检测到 `TaskResult` 缺失，能够自动基于 Git Commit 与 Task 元数据幂等重建，杜绝下游依赖读取缺失；
   - 支持通过 `--retry-task <id>` 重置失败节点，重置时将该节点与受阻下游统一置为 `PENDING`，并通过 DAG 重新严格推导就绪态，杜绝多依赖节点的早熟执行。
5. **结构化契约与产物交接（Structured Artifact Hand-Off）**：
   - Git 工作区源码是唯一真相源，每个成功任务通过 `IArtifactManager` 持久化 `.aire/tasks/<taskId>/result.json` 作为“索引雷达”；
   - 下游任务 Prompt 仅挂载**直接前置依赖**的 `TaskResult`（摘要、变更文件、API 契约、文档产物路径），严格控制上下文规模。
6. **完备的三层测试金字塔**：
   - Layer 1 单元测试（YAML 解析、拓扑排序、环检测、防漂移校验、就绪状态推导、Prompt 注入）；
   - Layer 2 集成测试（菱形依赖全链路、分支失败隔离与级联阻断、崩溃恢复三场景覆盖与 Commit Trailer/TaskResult 幂等补齐、修复后重试）；
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
  maxConcurrency?: number;   // 阶段三默认固定为 1，接口层面完全支持未来横向扩展
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
  runId: string;
  allowedFiles: string[];
}

export interface CommitMetadata {
  runId: string;
  taskId: string;
  baseCommit: string;
  title: string;
}

export interface IWorkspaceStrategy {
  prepareWorkspace(ctx: WorkspaceContext): Promise<void>;
  captureSnapshot(ctx: WorkspaceContext): Promise<string>; // 返回 baseCommit
  rollbackWorkspace(ctx: WorkspaceContext, baseCommit: string): Promise<void>;
  commitTaskWorkspace(ctx: WorkspaceContext, meta: CommitMetadata): Promise<string>; // 返回 new commit (注入 Trailer)
  extractChangedFiles(ctx: WorkspaceContext, baseCommit: string): Promise<string[]>;
  verifyCommitBelongsToTask(projectPath: string, commitSha: string, taskId: string, runId: string): Promise<boolean>;
  cleanupWorkspace(ctx: WorkspaceContext): Promise<void>;
}
```

#### 2.2.3 执行决策策略接口（`IExecutionPolicy`）
仅负责失败决策，不负责状态修改，保持策略的纯粹性：
```typescript
export enum FailureDecision {
  CASCADE_BLOCK_AND_CONTINUE = 'CASCADE_BLOCK_AND_CONTINUE', // 阻断子孙节点，允许无关平行分支继续
  ABORT_ALL = 'ABORT_ALL',                                   // 紧急全盘中断
}

export interface IExecutionPolicy {
  onTaskFailure(task: TaskNode, error: TaskError, graph: TaskGraph): FailureDecision;
}
```

#### 2.2.4 产物索引与运行状态接口分离
```typescript
// 1. 任务级产物契约管理器（支持幂等重建）
export interface IArtifactManager {
  saveTaskResult(projectPath: string, result: TaskResult): Promise<void>;
  getTaskResult(projectPath: string, taskId: string): Promise<TaskResult | null>;
  getDirectDependencyResults(projectPath: string, dependencyIds: string[]): Promise<TaskResult[]>;
  reconstructTaskResult(
    projectPath: string,
    task: TaskNode,
    baseCommit: string,
    commit: string,
    changedFiles: string[]
  ): Promise<TaskResult>;
}

// 2. 全局运行状态与断点恢复存储器（含 Schema 迁移机制与原子落盘契约）
export interface IRunStateStore {
  saveRunState(projectPath: string, state: DagRunState): Promise<void>; // 必须使用 write temp -> fsync -> rename 原子替换
  loadRunState(projectPath: string): Promise<DagRunState | null>;       // 自动检测 schemaVersion 并执行向上迁移
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
    runId: string,
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
  schemaVersion: string;         // 如 "1.0.0"，用于 Schema Migration 检验
  graphVersion: string;
  graphHash: string;             // task-graph.yaml 的 SHA-256 哈希防漂移
  runId: string;
  graphPath: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'HALTED' | 'FAILED';
  activeTaskIds: string[];       // 预留数组语义，阶段三永远至多 1 个元素
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

### 4.3 任务执行生命周期与 WAL 风格严格持久化时序（WAL-style Persistence Ordering）

所有状态写入必须经由 `IRunStateStore.saveRunState()` 的原子操作：
`写入临时文件 .aire/run-state.json.tmp -> fsync -> 原子 rename 替换 .aire/run-state.json`。

主循环调度与持久化时序：

```text
1. 评估全图可运行任务：
   computeReadyTasks()
       │
   ├── 若存在 READY 节点：取出下一个节点并执行
   │
   └── 若不存在任何 READY 节点（无可运行节点）：
         ├── 全图所有任务均为 SUCCEEDED：
         │     RunState.status = 'SUCCEEDED'，保存状态并正常成功退出！
         │
         └── 全图存在 FAILED 或 BLOCKED 节点：
               RunState.status = 'HALTED'，保存状态并输出阻断报告退出。

2. 针对选出的 READY 节点执行：
   a. WorkspaceStrategy 捕获当前 HEAD commit 作为 baseCommit
   b. 【原子持久化】RunState 更新：
        activeTaskIds = [taskId], task.status = 'RUNNING', task.baseCommit = baseCommit
   c. TaskRunner 动态组装 EvaluatorPipeline 并驱动 StateMachine 执行
        （状态流转 VERIFYING / REPAIRING / RETRYING 均实时原子刷盘）
   d. 执行分支判定：
      ├── 验证失败（耗尽重试）：
      │     1. WorkspaceStrategy 强制回滚：git reset --hard <baseCommit>
      │     2. ExecutionPolicy.onTaskFailure() 返回 CASCADE_BLOCK_AND_CONTINUE
      │     3. 当前任务标记为 FAILED
      │     4. 调度器遍历该任务所有直接/间接下游子孙节点，统一步迁为 BLOCKED (blockedBy: taskId)
      │     5. 【原子持久化】清空 activeTaskIds，落盘更新后的状态清单
      │     6. 调度器继续回到步骤 1（如果存在独立平行分支，继续调度执行！）
      │
      └── 验证成功：
            1. WorkspaceStrategy 提交工作区并注入 Git Trailer：
               git commit -m "feat(<taskId>): <title>

               AIRE-Run-Id: <runId>
               AIRE-Task-Id: <taskId>
               AIRE-Base-Commit: <baseCommit>"
            2. 获取最新 commit sha
            3. WorkspaceStrategy 提取变更文件 (git diff --name-only baseCommit..commit)
            4. 构造 TaskResult 并通过 ArtifactManager 持久化至 .aire/tasks/<taskId>/result.json
            5. 【原子持久化】清空 activeTaskIds，task.status = 'SUCCEEDED', task.commit = commit, task.resultPath = ...
            6. 调度器回到步骤 1，重新通过 computeReadyTasks() 激活下游就绪任务
```

### 4.4 机器可验证的 Crash Recovery 与防漂移断点续跑

当运行 `aire run --task-graph <path> --resume` 时，调度器严格执行四步校准：

#### Step 1: 防漂移与 Schema 迁移校验
1. **Schema 兼容性与迁移**：
   - 读取 `.aire/run-state.json` 中的 `schemaVersion`；
   - 若属于已知旧版本（如未来从 `1.0.0` 升至 `1.1.0`），执行已注册的 Schema Migrator 进行向前兼容转换；
   - 若属于未知的更高主版本，抛出 `UnsupportedSchemaVersionError` 拒绝 Resume。
2. **拓扑一致性哈希比对**：
   - 计算当前 `task-graph.yaml` 的 SHA-256 哈希值；
   - 与 `run-state.json` 中的 `graphHash` 比对。若拓扑结构被破坏性篡改，抛出 `GraphDriftError` 拦截。

#### Step 2: 机器可验证的崩溃状态校准（Crash Calibration）
检查 RunState 中是否存在残留的未完成态（`activeTaskIds` 非空，或任务处于 `RUNNING / VERIFYING / REPAIRING / RETRYING`）：
- 针对该任务，调度器检查 Git 仓库当前的 `HEAD`：
  1. **提交前崩溃场景**：
     若 `HEAD === baseCommit`，说明中断发生在代码提交前。调用 `rollbackWorkspace` 清理任何未跟踪脏文件，将该任务状态安全重置为 `PENDING`，清空 `activeTaskIds`；
  2. **提交后、RunState 更新前崩溃场景**：
     若 `HEAD !== baseCommit`，调度器通过 `git interpret-trailers` 校验 HEAD commit 的 Trailer 元数据：
     ```bash
     git log -1 --format="%(trailers:key=AIRE-Task-Id,valueonly)"
     ```
     - 若提取出的 `AIRE-Task-Id` 严格等于当前 `taskId` 且 `AIRE-Run-Id` 匹配：
       **机器可验证该提交确属本任务！** 调度器提取变更文件，通过 `ArtifactManager.reconstructTaskResult` 幂等生成并持久化 `TaskResult`，校准状态为 `SUCCEEDED`，记录 `commit = HEAD`，清空 `activeTaskIds`，杜绝错误回滚与重复提交！
     - 若 Trailer 不匹配或不存在：说明存在外部干扰，调度器抛出 `WorkspaceInconsistentError` 保护现场并终止。

#### Step 3: 已成功节点 TaskResult 幂等补全校准（TaskResult Reconciliation）
为防范“RunState 已标记 SUCCEEDED，但 TaskResult 持久化异常缺失”的极小 Crash Window：
- 调度器遍历全图所有状态为 `SUCCEEDED` 的节点；
- 检查其 `resultPath` 与 `.aire/tasks/<taskId>/result.json` 是否真实有效存在；
- 若文件缺失，调度器依据该任务的 `baseCommit` 与 `commit` 自动通过 `extractChangedFiles` 重新提取代码差异，调用 `ArtifactManager.reconstructTaskResult` 幂等重建并持久化 `result.json`，确保下游读取直接依赖契约时 100% 完整可用！

#### Step 4: 修复后重试（`--retry-task <taskId>`）状态重算
当用户修复代码或前置问题后发起 `--retry-task <taskId>`：
1. 校验目标 `taskId` 是否处于 `FAILED` 状态；
2. **严格重置为 `PENDING`**：
   - 将该任务状态重置为 `PENDING`（**禁止直接重置为 `READY`**）；
   - 将其所有标记为 `BLOCKED` 的下游子孙节点统一重置回 `PENDING`；
3. **依 DAG 依赖统一重新推导就绪态**：
   调用 `computeReadyTasks(graph, records)`。只有当该任务的全部直接前置依赖均为 `SUCCEEDED` 时，才自然进入 `READY`，严格杜绝多依赖节点的早熟执行；
4. 调度器重新启动主循环。

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
  - 验证 `.aire/run-state.json` 原子写入（temp -> fsync -> rename）与读取；
  - 验证哈希比对防漂移机制与 `schemaVersion` 迁移兼容校验。
- `tests/unit/dag/execution-policy.test.ts`:
  - 验证失败任务级联推导阻断子孙节点；
  - 验证平行分支不受阻断影响；
  - 验证 `--retry-task` 重置为 `PENDING` 后，通过依赖判定安全推导就绪。
- `tests/unit/dag/prompt-builder-dag.test.ts`:
  - 验证只注入直接依赖契约，间接祖先节点不侵入上下文。

### 6.2 Layer 2: 集成测试（Mock 状态机与工作区模拟）
- `tests/integration/dag-diamond-flow.test.ts`:
  - 构造菱形依赖（`A -> B, A -> C, B & C -> D`）；
  - 验证 A 成功后调度 B 与 C，B 和 C 均成功后调度 D，全图进入 `SUCCEEDED`（验证终态判断非 HALTED），Git Commit 序列线性可溯。
- `tests/integration/dag-failure-cascade.test.ts`:
  - 在菱形依赖中模拟 B 自愈失败（耗尽 3 次重试）；
  - 验证 B 自动回滚回 `baseCommit`；
  - 验证 D 自动被标记为 `BLOCKED`；
  - 验证独立分支 C 继续运行并成功（`SUCCEEDED`）；
  - 验证全图在无就绪节点后终止为 `HALTED`。
- `tests/integration/dag-crash-recovery.test.ts`:
  - 场景 1：模拟执行中崩溃（状态为 `RUNNING`，`HEAD === baseCommit`），验证 Resume 自动重置并从 `baseCommit` 重新安全执行；
  - 场景 2：模拟 Commit 完成后但 RunState 写入前崩溃（`HEAD !== baseCommit`），验证 Resume 通过 Git Trailer `AIRE-Task-Id` 机器可验证并校准为 `SUCCEEDED`，补全 `TaskResult`；
  - 场景 3：模拟 RunState 已标记 `SUCCEEDED` 但 `TaskResult` 写入前崩溃/文件缺失，验证 Resume 自动执行幂等重建并补全保存 `result.json`，下游任务顺利消费依赖契约。

### 6.3 Layer 3: 端到端 CLI 验证（E2E）
- `tests/e2e/dag-cli.test.ts`:
  - 基于真实 `fixtures/MiniApp` 靶场，提供包含多任务的 `task-graph.yaml`；
  - 运行 `aire run --task-graph fixtures/MiniApp/task-graph.yaml`；
  - 验证最终生成规范的 `.aire/run-state.json` 与 `.aire/tasks/<id>/result.json`，全链路顺利退出。
