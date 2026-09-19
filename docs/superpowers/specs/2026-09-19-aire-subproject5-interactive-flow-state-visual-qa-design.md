# AIRE Sub-project 5: 交互流与状态驱动的视觉 QA 引擎（Interactive Flow & State-driven Visual QA Engine）设计规范

- **文档状态**：Validated Design Spec
- **编写日期**：2026-09-19
- **所属项目**：AI iOS App Replica Engine (AIRE)
- **阶段定位**：Phase 5 / Sub-project 5（Flow DSL、XCUITest 语义化主交互通道、Bootstrap 状态启动加速、simctl 最后一级坐标降级、多维 State Snapshot、双轨缺陷模型与 Replay 自愈闭环）
- **参考规范**：[`docs/tech.md`](../../tech.md)、[`AGENTS.md`](../../../AGENTS.md)、[`docs/ui-verification-rules.md`](../../ui-verification-rules.md)

---

## 1. 目标与范围（Goals & Scope）

### 1.1 背景与核心痛点
在 Sub-project 1～4A 中，AIRE 已经成功打通了从「多模态输入 → 物理证据采集 → Analysis IR → TaskGraph 编译与校验 → 任务执行 → XcodeBuild → 模拟器运行 → Refkit 探针视觉比对 → 自动自愈」的全流程单页面闭环。

然而，现有的验证能力停留在 **静态单一页面验证**：
> `launchApp → settleDelay → takeScreenshot → refkit compare`

在真实的 iOS 原生应用中，大量的核心业务逻辑、设计细节与交互反馈分布在状态空间中：
- 首页列表点击卡片，触发转场动画进入详情页；
- 详情页点击编辑，弹出 Modal Sheet；
- 在表单输入框中键入文本，键盘弹起，保存按钮从未激活变为高亮；
- 点击保存，Sheet 收起，详情页数据与布局局部刷新。

如果 AIRE 只能“启动并截取第一页”，就无法验证多页面路由、表单交互、键盘避让、弹层与状态流转。

**Sub-project 5 的核心目标**：
> **将 AIRE 从“单页面截图验证器”升级为“状态空间中的交互执行与全流程视觉验证引擎”。**
> 核心对象从 `Page` 升维为 `State + Transition`。

### 1.2 核心设计原则与冻结决策
1. **三层驱动优先级**：
   `Bootstrap (LaunchArgs / DeepLink 设定已知起点)` → `XCUITest / XCUIAutomation (语义化控件主交互通道)` → `simctl (末级坐标降级兜底)`。严禁反向猜测。
2. **Identifier Contract（系统契约）**：
   `.accessibilityIdentifier` 不只是测试辅助，而是贯穿 `Analysis IR → TaskGraph → App Code (SwiftUI) → Flow DSL → Interaction Driver → Self-Healing` 的全局强类型系统契约。
3. **多维 State Snapshot**：
   快照不仅仅等于截图（Screenshot），而是结合 `Screenshot + UI 状态树 (Elements, Route, Keyboard, Active Sheet, Hittable)` 的多维快照。
4. **统一内置 Test Harness**：
   不为每个 Task 单独生成 XCTest Target，而由 AIRE 维护一个通用的、只读的 `AIREUITests` Harness，运行时通过 Apple 官方标准环境变量 `TEST_RUNNER_FLOW_FILE_PATH` 和 `TEST_RUNNER_ARTIFACT_DIR` 动态加载 Flow。
5. **双轨缺陷与完整 Replay 自愈**：
   状态缺陷（`StateDefect`）与视觉缺陷（`VisualDefect`）双轨输出；修复代码后必须进行完整的 `Flow Replay`，状态与视觉全部通过后才允许提交 Git。

### 1.3 非目标（Non-goals）
- 本阶段**不引入** Appium、WebDriverAgent 等笨重的外部常驻 HTTP 服务进程，完全基于 Apple 原生原生命令行工具链；
- 本阶段**不覆盖**并发多设备并行测试（保留至 Sub-project 6）；
- 本阶段**不破坏** Sub-project 2 中已建立的静态单页视觉验证逻辑，保持 100% 向后兼容。

---

## 2. 系统总体架构与分层职责

系统采用严格的 4 层分层架构：

```text
┌────────────────────────────────────────────────────────────────────────┐
│ Layer 1: Flow Definition (DSL)                                         │
│   - 定义 Flow DSL 规范 (.aire/flows/<flow-id>.json)                    │
│   - 描述 Bootstrap 起点、动作序列 (ActionTarget)、期望状态与检查点        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Layer 2: Flow Orchestrator & Interaction Driver                        │
│   - Bootstrap: 通过 launchArguments / DeepLink 快速就位                │
│   - Primary Driver: XCUITest / XCUIAutomation (语义化 Identifier)       │
│   - Fallback Driver: simctl coordinate input (坐标末级兜底)            │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Layer 3: State Snapshot (多维快照采集)                                  │
│   - 原生 @3x 截屏保存                                                   │
│   - 运行时 UI 状态树导出 (Route, Elements, Keyboard, Active Sheet)     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Layer 4: FlowInteractiveEvaluator (双轨评估与自愈闭环)                  │
│   - State Assertion Verification -> StateDefect[]                      │
│   - Refkit Probe Verification -> VisualDefect[]                        │
│   - 触发 Self-Healing -> 修复 SwiftUI 代码 -> 完整 Flow Replay        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 核心接口与数据模型契约 (Contracts)

### 3.1 Flow Definition DSL 契约 (`src/flow/types.ts`)

```typescript
export type TargetType = 'accessibility' | 'coordinate' | 'predicate';

export interface ActionTarget {
  /** 首选 accessibility；coordinate 仅作为 fallback/特殊场景 */
  type: TargetType;
  /** 语义命名空间规范，如 "flow.button.edit", "flow.field.title" */
  identifier?: string;
  /** 坐标兜底 (x, y) */
  coordinate?: { x: number; y: number };
  /** XCUIElementQuery Predicate，例如 "label CONTAINS 'Total'" */
  predicate?: string;
}

export type FlowActionType =
  | 'launch'
  | 'tap'
  | 'input'
  | 'clear'
  | 'swipe'
  | 'scrollTo'
  | 'pressBack'
  | 'wait';

export interface StateAssertion {
  elementsExist?: Array<{
    target: ActionTarget;
    enabled?: boolean;
    textEquals?: string;
    textContains?: string;
  }>;
  elementsNotExist?: ActionTarget[];
  keyboardVisible?: boolean;
  expectedRoute?: string;
}

export interface StepExpectation {
  /** 是否需要记录为检查点（截屏并记录 StateSnapshot） */
  checkpoint?: boolean;
  /** 关联的参考图像（用于视觉探针比对） */
  referenceImage?: string;
  /** 状态层断言 */
  state?: StateAssertion;
  /** 视觉探针与容差配置 */
  visualProbes?: {
    focusArea?: string;
    tolerance?: {
      containerDeltaMax?: number;
      spacingPtMax?: number;
      textDeltaMax?: number;
    };
  };
}

export interface FlowStepDefinition {
  stepId: string;
  action: FlowActionType;
  target?: ActionTarget;
  value?: string;
  timeoutMs?: number;
  /** 是否允许降级到 simctl 坐标点击（默认 false） */
  allowCoordinateFallback?: boolean;
  expect?: StepExpectation;
}

export interface FlowDefinition {
  schemaVersion: '1.0';
  flowId: string;
  name: string;
  description: string;
  bootstrap?: {
    type: 'deepLink' | 'launchArgs';
    value: string;
    environment?: Record<string, string>;
  };
  steps: FlowStepDefinition[];
}
```

### 3.2 Identifier Contract（全局命名空间规范）

在 Analysis IR 与 SwiftUI 代码中强制执行统一的命名空间契约：

| 命名空间前缀 | 语义类别 | 示例 |
| :--- | :--- | :--- |
| `flow.screen.<name>` | 页面/容器根视图 | `flow.screen.home`, `flow.screen.detail` |
| `flow.button.<action>` | 操作按钮 | `flow.button.add`, `flow.button.edit`, `flow.button.save` |
| `flow.field.<name>` | 文本输入框/选择器 | `flow.field.title`, `flow.field.amount` |
| `flow.cell.<list>.<index/id>` | 列表单元项 | `flow.cell.transaction.0`, `flow.cell.item.1` |
| `flow.nav.<destination>` | 导航返回/跳转入口 | `flow.nav.back`, `flow.nav.settings` |
| `flow.sheet.<name>` | 弹出层/Modal 容器 | `flow.sheet.category_picker` |

SwiftUI 视图必须在对应组件中显式声明：
```swift
Button("Edit") { ... }
  .accessibilityIdentifier("flow.button.edit")
```

### 3.3 State Snapshot 模型 (`src/flow/state-snapshot.ts`)

```typescript
export interface ElementSnapshot {
  identifier?: string;
  label?: string;
  elementType: string;
  isEnabled: boolean;
  isHittable: boolean;
  frame: { x: number; y: number; width: number; height: number };
  value?: string;
}

export interface StateSnapshot {
  stepId: string;
  timestamp: string;
  screenshotPath: string;
  /** 实际观测到的路由/页面标识 */
  route?: string;
  /** 键盘是否处于激活可见状态 */
  keyboardVisible: boolean;
  /** 当前顶层 UI 容器 (例如 Sheet / FullScreenCover / Alert) */
  activeOverlay?: string;
  /** 活跃元素列表 */
  elements: ElementSnapshot[];
  error?: string;
}
```

### 3.4 Interaction Driver 接口与结果契约 (`src/flow/interaction-driver.interface.ts`)

```typescript
export interface ActionResult {
  success: boolean;
  error?: string;
  usedFallback?: boolean;
  targetResolvedBy: 'accessibility' | 'predicate' | 'coordinate' | 'none';
  durationMs: number;
}

export interface IInteractionDriver {
  readonly name: string;
  launch(bundleId: string, bootstrap?: FlowDefinition['bootstrap']): Promise<void>;
  tap(target: ActionTarget, allowFallback?: boolean): Promise<ActionResult>;
  input(target: ActionTarget, text: string): Promise<ActionResult>;
  clear(target: ActionTarget): Promise<ActionResult>;
  swipe(direction: 'up' | 'down' | 'left' | 'right', target?: ActionTarget): Promise<ActionResult>;
  scrollTo(target: ActionTarget): Promise<ActionResult>;
  pressBack(): Promise<ActionResult>;
  wait(ms: number): Promise<void>;
  captureSnapshot(stepId: string, screenshotOutputDir: string): Promise<StateSnapshot>;
  terminate(bundleId: string): Promise<void>;
}
```

---

## 4. 通用 AIRE UI Test Harness（Runner）设计

### 4.1 目录结构与零侵入维护
AIRE 在代码库中内置一份轻量、标准、稳定的 Swift 源码模板，位于 `src/harness/swift-template/`：
1. `FlowTestRunner.swift`：继承自 `XCTestCase`，包含主测试入口 `testRunFlow()`；
2. `FlowModels.swift`：定义与 TypeScript 模型完全一一对应的 Swift `Codable` 结构体；
3. `XCUIActionExecutor.swift`：封装 `XCUIApplication` 的元素查找、等待、手势与键盘输入；
4. `SnapshotCapture.swift`：负责 `XCUIScreen.main.screenshot()` 原生截屏与元素层级遍历。

当目标 Xcode 工程缺少 `AIREUITests` target 时，由 `HarnessInstaller` 无感自动挂载，业务 TaskGraph 无需关心 XCTest 内部细节。

### 4.2 Apple 官方标准执行通道
执行由 Node.js 端的 `XCUITestDriver` 触发，通过标准环境变量传递 Flow 文件与产物目录：

```bash
TEST_RUNNER_FLOW_FILE_PATH="<projectPath>/.aire/flows/<flow-id>.json" \
TEST_RUNNER_ARTIFACT_DIR="<projectPath>/.aire/artifacts/flows/<flow-id>" \
xcrun xcodebuild test \
  -project <Project>.xcodeproj \
  -scheme AIREUITests \
  -destination 'id=<simulator-udid>' \
  -only-testing:AIREUITests/FlowTestRunner/testRunFlow
```

### 4.3 结果回传契约与 Fallback 触发边界
测试进程执行完毕后，在 `TEST_RUNNER_ARTIFACT_DIR` 输出权威报告 `flow-execution-report.json`：

```typescript
export interface StepExecutionReport {
  stepId: string;
  action: FlowActionType;
  success: boolean;
  targetResolvedBy: 'accessibility' | 'predicate' | 'coordinate' | 'none';
  durationMs: number;
  snapshot?: StateSnapshot;
  error?: {
    code: 'ELEMENT_NOT_FOUND' | 'ELEMENT_NOT_HITTABLE' | 'TIMEOUT' | 'ASSERTION_FAILED';
    message: string;
    targetIdentifier?: string;
  };
}

export interface FlowExecutionReport {
  flowId: string;
  success: boolean;
  totalDurationMs: number;
  completedSteps: number;
  totalSteps: number;
  failedStepId?: string;
  stepReports: StepExecutionReport[];
}
```

**Fallback 触发边界**：
若某个 Step 执行失败且 `allowCoordinateFallback === true`，外部 `FlowOrchestrator` 会介入：
1. 从 Analysis IR 中查找该目标元素的建议中心点坐标 `(x, y)`；
2. 调用 `SimctlInputDriver.tap(x, y)` 完成点击；
3. 记录警告日志并标记 `targetResolvedBy: 'coordinate'`，促使后续自愈 Agent 补全 `.accessibilityIdentifier`。

---

## 5. Evaluator 融合与自愈重放闭环

### 5.1 Evaluator 体系升级：`FlowInteractiveEvaluator`
实现统一的 `FlowInteractiveEvaluator`（实现 `IEvaluator` 接口），挂载在 `EvaluatorPipeline` 中：
- 若任务包含 `flowConfig`：运行完整的 Flow 交互与验证；
- 若任务仅包含旧的 `visualConfig.referenceImagePath`：无缝委托给 `VisualReviewEvaluator`；
- 保持 100% 向后兼容。

### 5.2 双轨缺陷模型（Dual-track Defects）
评估结果中结构化区分两类缺陷：

```typescript
export interface StateDefect {
  stepId: string;
  category: 'ELEMENT_MISSING' | 'STATE_MISMATCH' | 'ROUTE_MISMATCH' | 'ACTION_TIMEOUT';
  targetIdentifier?: string;
  expected: string;
  actual: string;
  message: string;
}

export interface EvaluationResult {
  passed: boolean;
  type: 'XCODE_BUILD' | 'VISUAL_REVIEW' | 'FLOW_INTERACTIVE';
  summary: string;
  errors: string[];
  visualDefects?: VisualDefect[];
  stateDefects?: StateDefect[];
  meanDelta?: number;
  flowReport?: FlowExecutionReport;
}
```

### 5.3 完整 Replay 自愈工作流
1. **精准定位（Diagnose）**：
   - `StateDefect`：指导开发 Agent 为指定 View 补充 `.accessibilityIdentifier(...)` 或调整状态逻辑；
   - `VisualDefect`：指导开发 Agent 微调布局间距、圆角与颜色 Token；
2. **修改代码（Fix）**：
   - 遵从单点修改原则，保持修改最小化；
3. **重放全流程（Replay）**：
   - 重新执行完整的 Flow 流程；
   - 只有在 **状态断言全部通过** 且 **各 Checkpoint 视觉容差达标** 时，任务才标记为 `SUCCEEDED`。

---

## 6. 代码结构与模块分工（Files & Directories）

```text
src/
├── flow/
│   ├── types.ts                        # Flow DSL、Step、Target、Report 等全量契约
│   ├── interaction-driver.interface.ts # IInteractionDriver 与 ActionResult 统一接口
│   ├── xcuitest-driver.ts              # XCUITest 主交互驱动实现
│   ├── simctl-input-driver.ts          # simctl 坐标降级兜底驱动实现
│   ├── state-snapshot.ts               # 快照解析与状态断言比对器
│   └── flow-orchestrator.ts            # Flow 流程调度与 Fallback 控制器
├── harness/
│   ├── swift-template/                 # 内置通用的只读 XCUITest 源码模板
│   │   ├── FlowTestRunner.swift
│   │   ├── FlowModels.swift
│   │   ├── XCUIActionExecutor.swift
│   │   └── SnapshotCapture.swift
│   └── harness-installer.ts            # Xcode 工程测试 Target 挂载与脚手架工具
├── evaluator/
│   └── flow/
│       └── flow-interactive-evaluator.ts # 双轨缺陷评估器（实现 IEvaluator）
├── planner/
│   └── task-graph-compiler.ts          # 升级：为多页面任务生成 flow 验证节点与 flows/*.json
└── core/
    └── types.ts                        # 升级：扩展 TaskContext 支持 FlowVerificationConfig
```

---

## 7. 验收标准与验证方案（Acceptance Criteria & Verification Plan）

### 7.1 单元测试（Unit Tests）
1. `tests/unit/flow/flow-types.test.ts`：验证 Flow DSL Schema 解析与校验；
2. `tests/unit/flow/interaction-driver.test.ts`：验证 `XCUITestDriver` 与 `SimctlInputDriver` 交互及 Fallback 机制；
3. `tests/unit/flow/state-snapshot.test.ts`：验证状态断言比对逻辑（Route, Elements, Keyboard）；
4. `tests/unit/evaluator/flow-interactive-evaluator.test.ts`：验证双轨缺陷（StateDefect / VisualDefect）生成。

### 7.2 集成测试（Integration Tests）
1. `tests/integration/flow-orchestrator.test.ts`：Mock 模式下端到端执行多步 Flow 并产出正确报告；
2. `tests/integration/flow-self-healing.test.ts`：验证 StateDefect 驱动自愈修复并 Replay 成功的闭环；
3. 现有 179 个既有单元与集成测试必须 100% 保持通过，零破坏现有功能。
