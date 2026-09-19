# AIRE Sub-project 5: 交互流与状态驱动的视觉 QA 引擎（Interactive Flow & State-driven Visual QA Engine）设计规范

- **文档状态**：Validated Design Spec (Revised)
- **编写日期**：2026-09-19
- **所属项目**：AI iOS App Replica Engine (AIRE)
- **阶段定位**：Phase 5 / Sub-project 5（Flow DSL、XCUITest 语义化主交互通道、Bootstrap 状态启动加速、双层坐标降级兜底、多维 State Snapshot、双轨缺陷模型与 Replay 自愈闭环）
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
1. **三层驱动优先级与无缝降级**：
   `Bootstrap (LaunchArgs / DeepLink 设定已知起点)` → `XCUITest / XCUIAutomation (语义化控件主交互通道)` → `XCUITest 原生坐标降级 / simctl 外部断点兜底`。严禁反向猜测。
2. **Identifier Contract（系统契约）**：
   `.accessibilityIdentifier` 不只是测试辅助，而是贯穿 `Analysis IR → TaskGraph → App Code (SwiftUI) → Flow DSL → Interaction Driver → Self-Healing` 的全局强类型系统契约。
3. **多维 State Snapshot**：
   快照结合 `Screenshot + UI 状态树 (Elements, Route, Keyboard, Active Sheet, Hittable)` 的多维快照。
4. **统一内置 Test Harness**：
   由 AIRE 维护一个通用的、只读的 `AIREUITests` Harness，明确 Target、Shared Scheme 与 Test Bundle 关系，运行时通过 Apple 官方标准环境变量 `TEST_RUNNER_FLOW_FILE_PATH` 和 `TEST_RUNNER_ARTIFACT_DIR` 动态加载 Flow。
5. **Schema SSOT（单一事实源）**：
   通过 `schemas/flow-definition.schema.json` 约束 TS 类型与 Swift `FlowModels.swift`，杜绝双语言模型漂移。
6. **双轨缺陷与完整 Replay 自愈**：
   状态缺陷（`StateDefect`）与视觉缺陷（`VisualDefect`）双轨输出；修复代码后必须进行完整的 `Flow Replay`，状态与视觉全部通过后才允许提交 Git。

### 1.3 非目标（Non-goals）
- 本阶段**不引入** Appium、WebDriverAgent 等外部常驻 HTTP 服务进程，完全基于 Apple 原生命令行工具链；
- 本阶段**不覆盖**并发多设备并行测试（保留至 Sub-project 6）；
- 本阶段**不破坏** Sub-project 2 中已建立的静态单页视觉验证逻辑，保持 100% 向后兼容。

---

## 2. 系统总体架构与分层职责

系统采用严格的 4 层分层架构：

```text
┌────────────────────────────────────────────────────────────────────────┐
│ Layer 1: Flow Definition (DSL)                                         │
│   - 定义 Flow DSL 规范 (.aire/flows/<flow-id>.json)                    │
│   - JSON Schema 单一事实源保证 TS 与 Swift 模型一致                      │
│   - 描述 Bootstrap 起点、动作序列 (ActionTarget)、期望状态与检查点        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Layer 2: Flow Orchestrator & Interaction Driver                        │
│   - Bootstrap: 通过 launchArguments / DeepLink 快速就位                │
│   - Primary: XCUITest 语义化 Identifier 交互                           │
│   - Fallback Level 1: XCUITest 原生 In-process 坐标点击 (不中断流程)    │
│   - Fallback Level 2: simctl 外部物理点击 + 断点续跑 (TEST_RUNNER_START) │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Layer 3: State Snapshot (多维快照采集)                                  │
│   - 原生 @3x 截屏保存                                                   │
│   - Route 三级推断 (Root Identifier -> Nav Bar -> Bootstrap)            │
│   - 运行时 UI 状态树导出 (Elements, Keyboard, Active Sheet)             │
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

### 3.1 坐标系系统规范（Coordinate Space Contract）
为了保证跨设备、Scale 与 Fallback 的确定性，系统所有坐标严格遵循以下约定：
1. **基准坐标系**：所有 Flow DSL、ActionTarget 与 IR 探针在交互时，一律以 **SwiftUI 逻辑点（Logical Points, pt）** 为唯一标准单位，以设备视口左上角为 `(0, 0)`。
2. **像素换算规则**：
   - 参考图像或 Simulator 物理截图像素（Captured Pixels, px）转换为逻辑点：
     $$\text{Point (pt)} = \frac{\text{Pixel (px)}}{\text{Scale factor (例如 3.0)}}$$
   - `simctl io booted tap <x> <y>` 原生接收的就是 Points (pt)，无需二次放缩。
3. **屏幕方向**：默认为 Portrait（竖屏），坐标系随 UI 窗口方向动态对齐。

### 3.2 Flow Definition DSL 契约 (`src/flow/types.ts`)

```typescript
export type TargetType = 'accessibility' | 'coordinate' | 'predicate';

export interface ActionTarget {
  /** 首选 accessibility；coordinate 仅作为 fallback/特殊场景 */
  type: TargetType;
  /** 语义命名空间规范，如 "flow.button.edit", "flow.field.title" */
  identifier?: string;
  /** 逻辑点坐标 (pt)，仅在 fallback 或非标准控件时使用 */
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
  checkpoint?: boolean;
  referenceImage?: string;
  state?: StateAssertion;
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
  /** 是否允许降级到坐标点击（默认 false） */
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

### 3.3 Identifier Contract（全局命名空间规范）

在 Analysis IR 与 SwiftUI 代码中强制执行统一的命名空间契约：

| 命名空间前缀 | 语义类别 | 示例 |
| :--- | :--- | :--- |
| `flow.screen.<name>` | 页面/容器根视图（兼具 Route 标识） | `flow.screen.home`, `flow.screen.detail` |
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

### 3.4 State Snapshot 模型与 Route 三级推断机制 (`src/flow/state-snapshot.ts`)

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
  /** 当前观测到的路由/页面 */
  route?: string;
  routeConfidence: 'exact_identifier' | 'nav_title_inferred' | 'bootstrap_assumed';
  keyboardVisible: boolean;
  activeOverlay?: string;
  elements: ElementSnapshot[];
  error?: string;
}
```

**Route 观测三级推断逻辑**：
1. **Tier 1 (Root Identifier 强契约)**：遍历当前窗口根元素，若存在 `identifier` 以 `flow.screen.` 开头（如 `flow.screen.detail`），精确提取 `detail`，置 `routeConfidence = 'exact_identifier'`；
2. **Tier 2 (Navigation Title 启发式推断)**：若无根 identifier，查找 `navigationBars.firstMatch` 的 title，与 `AnalysisIR.screens` 匹配对应的 `route`，置 `routeConfidence = 'nav_title_inferred'`；
3. **Tier 3 (Bootstrap 预期假设)**：若以上均未命中且当前处于 Bootstrap 启动阶段，继承 Bootstrap 预期的目标路由，置 `routeConfidence = 'bootstrap_assumed'`。

### 3.5 Interaction Driver 统一接口与结果契约 (`src/flow/interaction-driver.interface.ts`)

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

## 4. 通用 AIRE UI Test Harness（Runner）与双层 Fallback 架构

### 4.1 Target、Shared Scheme 与 Test Bundle 规范
为了消除 Target 与 Scheme 的概念混乱，确保 `HarnessInstaller` 稳定落地：
1. **Test Bundle (Target: `AIREUITests`)**：
   - 工程中独立创建 `AIREUITests` Target，`productType = com.apple.product-type.bundle.ui-testing`；
   - 依赖主 App Target，设置 Build Setting `TEST_TARGET_NAME = <AppTargetName>`；
   - 源码包含内置只读的 4 个 Swift 文件：`FlowTestRunner.swift`, `FlowModels.swift`, `XCUIActionExecutor.swift`, `SnapshotCapture.swift`。
2. **Shared Scheme (`AIREUITests.xcscheme`)**：
   - 独立生成并保存于 `<Project>.xcodeproj/xcshareddata/xcschemes/AIREUITests.xcscheme`；
   - 在 `<TestAction>` 中唯一配置 `AIREUITests` Test Target；
   - 这样 CI 与 CLI 调用 `xcodebuild -scheme AIREUITests` 能够 100% 确定性命中，不污染主 App Scheme。
3. **HarnessInstaller 机制**：
   - 提供 `HarnessInstaller.ensureHarness(projectPath, targetScheme)`，使用 `pbxproj` 分析工具检测工程；
   - 若未配置，自动向 `.pbxproj` 注入 Target、Build Configurations 与共享 Scheme XML，零人工干预。

### 4.2 避免断裂的双层 Fallback 恢复模型

```text
Step 执行请求 (Action: tap, Target: flow.button.edit)
       │
       ▼
   XCUITest 原生查找 (app.buttons["flow.button.edit"])
       │
   ┌───┴───────────────────────────────┐
   │ 找到                              │ 未找到
   ▼                                   ▼
执行语义 tap()                  allowCoordinateFallback == true?
targetResolvedBy: accessibility        │
                                   ┌───┴───────────────────────────────┐
                                   │ 是                                │ 否
                                   ▼                                   ▼
                       【Level 1: 进程内坐标点击】                  Step 失败中断
                       XCUITest 原生 coordinate.tap()               输出 partial report
                       targetResolvedBy: coordinate                failedStepId: step-3
                       [流程不中断，顺畅继续下一步]                            │
                                                                       ▼
                                                           【Level 2: 外部断点续跑】
                                                           1. simctl tap(x, y) 物理点击
                                                           2. 重新拉起 Runner:
                                                              TEST_RUNNER_START_STEP=step-4
                                                           3. 执行后续 Steps 并合并报告
```

1. **Level 1（进程内原生坐标降级，首选）**：
   - XCUITest 本身具备坐标点击能力：`app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x, dy: y)).tap()`；
   - 当 `allowCoordinateFallback: true` 且提供/推导了 `coordinate` 时，Runner 内部直接以坐标点击屏幕，记录 `targetResolvedBy: 'coordinate'`，**测试进程不退出，流程毫秒级顺畅执行下一步**。
2. **Level 2（外部物理点击 + 断点续跑恢复，兜底）**：
   - 针对进程异常、系统权限弹窗或 Level 1 失败的情况，Runner 写入包含已完成步骤的报告并标明 `failedStepId`；
   - 外部 `FlowOrchestrator` 接管，调用 `simctl io booted tap <x> <y>` 击穿弹窗或完成补救动作；
   - 注入环境变量 `TEST_RUNNER_START_STEP_ID="step-4"` 重新拉起 Runner，从断点继续跑完剩余步骤，并无缝合并快照。

### 4.3 执行调用规范（Apple 标准环境变量）

```bash
TEST_RUNNER_FLOW_FILE_PATH="<projectPath>/.aire/flows/<flow-id>.json" \
TEST_RUNNER_ARTIFACT_DIR="<projectPath>/.aire/artifacts/flows/<flow-id>" \
TEST_RUNNER_START_STEP_ID="<optional-resume-step-id>" \
xcrun xcodebuild test \
  -project <Project>.xcodeproj \
  -scheme AIREUITests \
  -destination 'id=<simulator-udid>' \
  -only-testing:AIREUITests/FlowTestRunner/testRunFlow
```

---

## 5. Schema SSOT 与模型同步机制

为了彻底消除 TypeScript 与 Swift 双语言数据模型之间的漂移风险：
1. **单一事实源（Single Source of Truth）**：
   在 `schemas/flow-definition.schema.json` 中统一定义 Flow DSL 的完整 JSON Schema 规范；
2. **契约校验测试（Contract Sync Test）**：
   在 `tests/unit/flow/schema-sync.test.ts` 中建立双向校验闸门：
   - 构造标准的 `flow-contract-fixture.json`；
   - TypeScript 端通过 JSON Schema 严格校验；
   - Swift 端通过 `JSONDecoder().decode(FlowDefinition.self)` 反序列化校验；
   - 任何一方发生字段缺失、类型变化或命名不匹配，CI 立即红灯拦截，确保 TS/Swift 强同步。

---

## 6. Evaluator 融合与自愈重放闭环

### 6.1 Evaluator 体系升级：`FlowInteractiveEvaluator`
实现统一的 `FlowInteractiveEvaluator`（实现 `IEvaluator` 接口），挂载在 `EvaluatorPipeline` 中：
- 若任务包含 `flowConfig`：运行完整的 Flow 交互与验证；
- 若任务仅包含旧的 `visualConfig.referenceImagePath`：无缝委托给 `VisualReviewEvaluator`；
- 保持 100% 向后兼容。

### 6.2 双轨缺陷模型（Dual-track Defects）
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

### 6.3 完整 Replay 自愈工作流
1. **精准定位（Diagnose）**：
   - `StateDefect`：指导开发 Agent 为指定 View 补充 `.accessibilityIdentifier(...)` 或调整状态逻辑；
   - `VisualDefect`：指导开发 Agent 微调布局间距、圆角与颜色 Token；
2. **修改代码（Fix）**：
   - 遵从单点修改原则，保持修改最小化；
3. **重放全流程（Replay）**：
   - 重新执行完整的 Flow 流程；
   - 只有在 **状态断言全部通过** 且 **各 Checkpoint 视觉容差达标** 时，任务才标记为 `SUCCEEDED`。

---

## 7. 代码结构与模块分工（Files & Directories）

```text
schemas/
└── flow-definition.schema.json         # 权威单事实源 (JSON Schema)
src/
├── flow/
│   ├── types.ts                        # Flow DSL、Step、Target、Report 等全量契约 (对齐 Schema)
│   ├── interaction-driver.interface.ts # IInteractionDriver 与 ActionResult 统一接口
│   ├── xcuitest-driver.ts              # XCUITest 主交互驱动实现 (支持环境变量注入与重试)
│   ├── simctl-input-driver.ts          # simctl 坐标降级兜底驱动实现
│   ├── state-snapshot.ts               # 快照解析与 Route 三级推断比对器
│   └── flow-orchestrator.ts            # Flow 流程调度与双层 Fallback 断点续跑控制器
├── harness/
│   ├── swift-template/                 # 内置通用的只读 XCUITest 源码模板
│   │   ├── FlowTestRunner.swift
│   │   ├── FlowModels.swift            # 对齐 Schema 的 Swift Codable 结构体
│   │   ├── XCUIActionExecutor.swift    # 支持进程内坐标降级 (coordinate.tap)
│   │   └── SnapshotCapture.swift       # 截屏与 Route 三级推断提取
│   └── harness-installer.ts            # Target、Shared Scheme 挂载与脚手架工具
├── evaluator/
│   └── flow/
│       └── flow-interactive-evaluator.ts # 双轨缺陷评估器（实现 IEvaluator）
├── planner/
│   └── task-graph-compiler.ts          # 升级：为多页面任务生成 flow 验证节点与 flows/*.json
└── core/
    └── types.ts                        # 升级：扩展 TaskContext 支持 FlowVerificationConfig
```

---

## 8. 验收标准与验证方案（Acceptance Criteria & Verification Plan）

### 8.1 单元测试（Unit Tests）
1. `tests/unit/flow/schema-sync.test.ts`：TS 与 Swift 模型对齐测试，验证 JSON Schema SSOT；
2. `tests/unit/flow/interaction-driver.test.ts`：验证 XCUITestDriver 与 SimctlInputDriver 交互及双层 Fallback 机制；
3. `tests/unit/flow/state-snapshot.test.ts`：验证 Route 三级推断逻辑（Root Identifier / Nav Title / Bootstrap）；
4. `tests/unit/evaluator/flow-interactive-evaluator.test.ts`：验证双轨缺陷（StateDefect / VisualDefect）生成。

### 8.2 集成测试（Integration Tests）
1. `tests/integration/flow-orchestrator.test.ts`：端到端验证多步 Flow、断点续跑与快照合并；
2. `tests/integration/flow-self-healing.test.ts`：验证 StateDefect 驱动自愈修复并完整 Replay 的闭环；
3. 现有 179 个既有单元与集成测试必须 100% 保持通过，零破坏现有功能。
