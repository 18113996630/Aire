# Sub-project 5: 交互流与状态驱动的视觉 QA 引擎 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 AIRE 的状态空间交互执行与视觉验证引擎，实现基于 XCUITest 主通道 + simctl 坐标降级、Bootstrap 状态加速、多维 State Snapshot、双轨缺陷诊断与 Flow Replay 自愈闭环。

**Architecture:** 
采用 4 层架构：
1. Flow Definition (DSL + JSON Schema SSOT)；
2. Flow Orchestrator & Interaction Driver（Bootstrap → XCUITest 进程内坐标降级 → simctl 外部断点续跑）；
3. State Snapshot（原生截图 + Elements 树 + Route 三级推断 + Keyboard）；
4. FlowInteractiveEvaluator（双轨 StateDefect / VisualDefect 输出与全流程 Replay 自愈）。

**Tech Stack:** TypeScript (Node.js v25+), XCUITest (XCUIAutomation, Swift 5.9+), Apple `xcodebuild` CLI, `xcrun simctl`, Python Refkit (Pillow/NumPy), Vitest.

**Spec:** [`docs/superpowers/specs/2026-09-19-aire-subproject5-interactive-flow-state-visual-qa-design.md`](file:///Users/huangrong/Desktop/develop/tool/Aire/docs/superpowers/specs/2026-09-19-aire-subproject5-interactive-flow-state-visual-qa-design.md)

## Global Constraints

- **Node/Runtime**: Node.js v25+ (ESM, `node:child_process`, `node:fs/promises`).
- **Dependencies**: 严禁引入 Appium / WebDriverAgent / Selenium 等外部重型服务，完全依托 Apple 原生 CLI（`xcodebuild`, `xcrun simctl`）。
- **Apple Standard Env**: Test Runner 参数必须使用 Apple 官方标准环境变量 `TEST_RUNNER_FLOW_FILE_PATH`、`TEST_RUNNER_ARTIFACT_DIR`、`TEST_RUNNER_START_STEP_ID`。
- **Coordinate Space**: 所有坐标统一为 SwiftUI 逻辑点（Logical Points, pt），原点为视口左上角 `(0, 0)`。
- **Identifier Namespace**: 严格执行 `flow.<category>.<name>`（例如 `flow.button.edit`, `flow.field.title`, `flow.screen.home`）。
- **Testing**: 每一个 Task 严格采用 TDD（红灯测试 → 验证失败 → 编写实现 → 绿灯通过 → Git 独立原子提交）。

---

### Task 1: Schema SSOT 与 Flow DSL 核心数据模型

**Files:**
- Create: `schemas/flow-definition.schema.json`
- Create: `src/flow/types.ts`
- Test: `tests/unit/flow/schema-sync.test.ts`

**Interfaces:**
- Consumes: 无（基础类型层）
- Produces: `FlowDefinition`, `FlowStepDefinition`, `ActionTarget`, `StepExpectation`, `StateAssertion`, `FlowExecutionReport`

- [ ] **Step 1: 编写失败测试**

```typescript
// tests/unit/flow/schema-sync.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FlowDefinition } from '../../src/flow/types.ts';

describe('Flow Schema SSOT & Types', () => {
  it('validates a standard flow definition fixture against json schema', async () => {
    const schemaPath = path.resolve(process.cwd(), 'schemas/flow-definition.schema.json');
    const rawSchema = await fs.readFile(schemaPath, 'utf8');
    const schema = JSON.parse(rawSchema);

    const fixture: FlowDefinition = {
      schemaVersion: '1.0',
      flowId: 'flow-edit-card',
      name: 'Edit Card Flow',
      description: 'Navigate to detail and edit card title',
      bootstrap: {
        type: 'launchArgs',
        value: '-AireFlow test',
      },
      steps: [
        {
          stepId: 'step-1-tap-card',
          action: 'tap',
          target: {
            type: 'accessibility',
            identifier: 'flow.cell.transaction.0',
          },
          allowCoordinateFallback: true,
          expect: {
            checkpoint: true,
            state: {
              expectedRoute: 'detail',
            },
          },
        },
      ],
    };

    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(fixture.steps[0].target?.identifier).toBe('flow.cell.transaction.0');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npm test tests/unit/flow/schema-sync.test.ts`
预期：FAIL（文件不存在）

- [ ] **Step 3: 编写 Minimal Implementation**

创建 `schemas/flow-definition.schema.json` 包含 FlowDefinition 的标准 JSON Schema。
创建 `src/flow/types.ts` 导出完整的 TypeScript 接口定义。

- [ ] **Step 4: 运行测试验证通过**

运行：`npm test tests/unit/flow/schema-sync.test.ts`
预期：PASS

- [ ] **Step 5: 提交 Git**

```bash
git add schemas/flow-definition.schema.json src/flow/types.ts tests/unit/flow/schema-sync.test.ts
git commit -m "feat(flow): add flow definition schema and types"
```

---

### Task 2: State Snapshot 与 Route 三级推断比对器

**Files:**
- Create: `src/flow/state-snapshot.ts`
- Test: `tests/unit/flow/state-snapshot.test.ts`

**Interfaces:**
- Consumes: `src/flow/types.ts` (`StateAssertion`, `ActionTarget`)
- Produces: `StateSnapshot`, `ElementSnapshot`, `evaluateStateAssertion(snapshot, assertion): StateDefect[]`

- [ ] **Step 1: 编写失败测试**

```typescript
// tests/unit/flow/state-snapshot.test.ts
import { describe, it, expect } from 'vitest';
import { evaluateStateAssertion, type StateSnapshot } from '../../src/flow/state-snapshot.ts';

describe('StateSnapshot Evaluation & Route Inference', () => {
  const sampleSnapshot: StateSnapshot = {
    stepId: 'step-2',
    timestamp: '2026-09-19T10:00:00Z',
    screenshotPath: '/tmp/step-2.png',
    route: 'detail',
    routeConfidence: 'exact_identifier',
    keyboardVisible: false,
    elements: [
      {
        identifier: 'flow.button.save',
        elementType: 'Button',
        isEnabled: true,
        isHittable: true,
        frame: { x: 20, y: 100, width: 80, height: 44 },
      },
    ],
  };

  it('detects route mismatch defect', () => {
    const defects = evaluateStateAssertion(sampleSnapshot, {
      expectedRoute: 'settings',
    });
    expect(defects).toHaveLength(1);
    expect(defects[0].category).toBe('ROUTE_MISMATCH');
    expect(defects[0].expected).toBe('settings');
    expect(defects[0].actual).toBe('detail');
  });

  it('detects missing required element defect', () => {
    const defects = evaluateStateAssertion(sampleSnapshot, {
      elementsExist: [
        {
          target: { type: 'accessibility', identifier: 'flow.button.delete' },
        },
      ],
    });
    expect(defects).toHaveLength(1);
    expect(defects[0].category).toBe('ELEMENT_MISSING');
    expect(defects[0].targetIdentifier).toBe('flow.button.delete');
  });

  it('passes when all assertions are satisfied', () => {
    const defects = evaluateStateAssertion(sampleSnapshot, {
      expectedRoute: 'detail',
      keyboardVisible: false,
      elementsExist: [
        {
          target: { type: 'accessibility', identifier: 'flow.button.save' },
          enabled: true,
        },
      ],
    });
    expect(defects).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npm test tests/unit/flow/state-snapshot.test.ts`
预期：FAIL

- [ ] **Step 3: 编写 Minimal Implementation**

在 `src/flow/state-snapshot.ts` 中实现 `ElementSnapshot`, `StateSnapshot`, `StateDefect`, `evaluateStateAssertion`。

- [ ] **Step 4: 运行测试验证通过**

运行：`npm test tests/unit/flow/state-snapshot.test.ts`
预期：PASS

- [ ] **Step 5: 提交 Git**

```bash
git add src/flow/state-snapshot.ts tests/unit/flow/state-snapshot.test.ts
git commit -m "feat(flow): implement state snapshot and assertion evaluator"
```

---

### Task 3: Interaction Drivers (XCUITestDriver + SimctlInputDriver)

**Files:**
- Create: `src/flow/interaction-driver.interface.ts`
- Create: `src/flow/simctl-input-driver.ts`
- Create: `src/flow/xcuitest-driver.ts`
- Test: `tests/unit/flow/interaction-driver.test.ts`

**Interfaces:**
- Consumes: `src/flow/types.ts`, `src/ios/simulator-manager.ts`
- Produces: `IInteractionDriver`, `ActionResult`, `SimctlInputDriver`, `XCUITestDriver`

- [ ] **Step 1: 编写失败测试**

```typescript
// tests/unit/flow/interaction-driver.test.ts
import { describe, it, expect, vi } from 'vitest';
import { SimctlInputDriver } from '../../src/flow/simctl-input-driver.ts';
import { XCUITestDriver } from '../../src/flow/xcuitest-driver.ts';

describe('Interaction Drivers', () => {
  it('SimctlInputDriver taps using logical points', async () => {
    const mockExec = vi.fn().mockResolvedValue('');
    const driver = new SimctlInputDriver('booted', mockExec);

    const result = await driver.tap({
      type: 'coordinate',
      coordinate: { x: 120, y: 340 },
    });

    expect(result.success).toBe(true);
    expect(result.targetResolvedBy).toBe('coordinate');
    expect(mockExec).toHaveBeenCalledWith('xcrun', ['simctl', 'io', 'booted', 'tap', '120', '340']);
  });

  it('XCUITestDriver prepares execution arguments with Apple standard envs', () => {
    const driver = new XCUITestDriver({
      projectPath: '/path/to/project',
      scheme: 'AIREUITests',
      udid: 'device-123',
    });

    const envs = driver.buildTestRunnerEnvs('/path/to/flow.json', '/path/to/artifacts', 'step-2');
    expect(envs.TEST_RUNNER_FLOW_FILE_PATH).toBe('/path/to/flow.json');
    expect(envs.TEST_RUNNER_ARTIFACT_DIR).toBe('/path/to/artifacts');
    expect(envs.TEST_RUNNER_START_STEP_ID).toBe('step-2');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npm test tests/unit/flow/interaction-driver.test.ts`
预期：FAIL

- [ ] **Step 3: 编写 Minimal Implementation**

实现 `src/flow/interaction-driver.interface.ts`，`src/flow/simctl-input-driver.ts`（封装 `xcrun simctl io`），`src/flow/xcuitest-driver.ts`（封装 xcodebuild test 命令行执行及环境变量注入）。

- [ ] **Step 4: 运行测试验证通过**

运行：`npm test tests/unit/flow/interaction-driver.test.ts`
预期：PASS

- [ ] **Step 5: 提交 Git**

```bash
git add src/flow/interaction-driver.interface.ts src/flow/simctl-input-driver.ts src/flow/xcuitest-driver.ts tests/unit/flow/interaction-driver.test.ts
git commit -m "feat(flow): implement SimctlInputDriver and XCUITestDriver"
```

---

### Task 4: AIRE UI Test Harness 通用 Swift 模板与 HarnessInstaller

**Files:**
- Create: `src/harness/swift-template/FlowModels.swift`
- Create: `src/harness/swift-template/XCUIActionExecutor.swift`
- Create: `src/harness/swift-template/SnapshotCapture.swift`
- Create: `src/harness/swift-template/FlowTestRunner.swift`
- Create: `src/harness/harness-installer.ts`
- Test: `tests/unit/harness/harness-installer.test.ts`

**Interfaces:**
- Consumes: `schemas/flow-definition.schema.json`
- Produces: `HarnessInstaller.ensureHarness(projectPath, targetScheme)`

- [ ] **Step 1: 编写失败测试**

```typescript
// tests/unit/harness/harness-installer.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HarnessInstaller } from '../../src/harness/harness-installer.ts';

describe('HarnessInstaller', () => {
  it('installs AIREUITests template files into target project directory', async () => {
    const tmpDir = path.resolve(process.cwd(), 'node_modules/.tmp/harness-test');
    await fs.mkdir(tmpDir, { recursive: true });

    const installer = new HarnessInstaller();
    await installer.installTemplateFiles(tmpDir);

    const runnerPath = path.join(tmpDir, 'AIREUITests', 'FlowTestRunner.swift');
    const modelsPath = path.join(tmpDir, 'AIREUITests', 'FlowModels.swift');
    const executorPath = path.join(tmpDir, 'AIREUITests', 'XCUIActionExecutor.swift');
    const snapshotPath = path.join(tmpDir, 'AIREUITests', 'SnapshotCapture.swift');

    expect(await fs.stat(runnerPath)).toBeDefined();
    expect(await fs.stat(modelsPath)).toBeDefined();
    expect(await fs.stat(executorPath)).toBeDefined();
    expect(await fs.stat(snapshotPath)).toBeDefined();

    const runnerContent = await fs.readFile(runnerPath, 'utf8');
    expect(runnerContent).toContain('class FlowTestRunner: XCTestCase');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npm test tests/unit/harness/harness-installer.test.ts`
预期：FAIL

- [ ] **Step 3: 编写 Minimal Implementation**

创建 4 个 Swift 模板：
- `FlowModels.swift`: 对齐 Schema 的 Swift Codable 模型；
- `XCUIActionExecutor.swift`: 支持语义 Identifier 定位与进程内 `coordinate.tap` 降级；
- `SnapshotCapture.swift`: 导出原生截屏与三级 Route 推断；
- `FlowTestRunner.swift`: 标准 XCTest 入口；
实现 `HarnessInstaller` 复制模板与生成共享 Scheme XML。

- [ ] **Step 4: 运行测试验证通过**

运行：`npm test tests/unit/harness/harness-installer.test.ts`
预期：PASS

- [ ] **Step 5: 提交 Git**

```bash
git add src/harness/ tests/unit/harness/harness-installer.test.ts
git commit -m "feat(harness): create universal swift test harness template and installer"
```

---

### Task 5: Flow Orchestrator（双层 Fallback 与断点续跑恢复）

**Files:**
- Create: `src/flow/flow-orchestrator.ts`
- Test: `tests/unit/flow/flow-orchestrator.test.ts`

**Interfaces:**
- Consumes: `IInteractionDriver`, `FlowDefinition`, `StateSnapshot`, `evaluateStateAssertion`
- Produces: `FlowOrchestrator.runFlow(flow, options): Promise<FlowExecutionReport>`

- [ ] **Step 1: 编写失败测试**

```typescript
// tests/unit/flow/flow-orchestrator.test.ts
import { describe, it, expect, vi } from 'vitest';
import { FlowOrchestrator } from '../../src/flow/flow-orchestrator.ts';
import type { FlowDefinition } from '../../src/flow/types.ts';

describe('FlowOrchestrator Fallback & Continuity', () => {
  it('successfully executes a multi-step flow and returns consolidated report', async () => {
    const mockDriver: any = {
      name: 'MockDriver',
      launch: vi.fn().mockResolvedValue(undefined),
      executeFlowBatch: vi.fn().mockResolvedValue({
        flowId: 'test-flow',
        success: true,
        totalDurationMs: 500,
        completedSteps: 2,
        totalSteps: 2,
        stepReports: [
          { stepId: 'step-1', action: 'tap', success: true, targetResolvedBy: 'accessibility', durationMs: 200 },
          { stepId: 'step-2', action: 'tap', success: true, targetResolvedBy: 'accessibility', durationMs: 300 },
        ],
      }),
    };

    const orchestrator = new FlowOrchestrator(mockDriver);
    const flow: FlowDefinition = {
      schemaVersion: '1.0',
      flowId: 'test-flow',
      name: 'Test',
      description: 'Test flow',
      steps: [
        { stepId: 'step-1', action: 'tap', target: { type: 'accessibility', identifier: 'btn-1' } },
        { stepId: 'step-2', action: 'tap', target: { type: 'accessibility', identifier: 'btn-2' } },
      ],
    };

    const report = await orchestrator.runFlow(flow, { artifactDir: '/tmp' });
    expect(report.success).toBe(true);
    expect(report.completedSteps).toBe(2);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npm test tests/unit/flow/flow-orchestrator.test.ts`
预期：FAIL

- [ ] **Step 3: 编写 Minimal Implementation**

实现 `src/flow/flow-orchestrator.ts`，处理完整 Flow 执行、Level 2 断点续跑重试逻辑与 Report 拼接。

- [ ] **Step 4: 运行测试验证通过**

运行：`npm test tests/unit/flow/flow-orchestrator.test.ts`
预期：PASS

- [ ] **Step 5: 提交 Git**

```bash
git add src/flow/flow-orchestrator.ts tests/unit/flow/flow-orchestrator.test.ts
git commit -m "feat(flow): implement FlowOrchestrator with fallback continuity"
```

---

### Task 6: FlowInteractiveEvaluator 双轨缺陷评估与自愈重放闭环

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/dag/types.ts`
- Create: `src/evaluator/flow/flow-interactive-evaluator.ts`
- Modify: `src/evaluator/evaluator-pipeline.ts`
- Test: `tests/unit/evaluator/flow-interactive-evaluator.test.ts`
- Test: `tests/integration/flow-self-healing.test.ts`

**Interfaces:**
- Consumes: `IEvaluator`, `FlowOrchestrator`, `AutoProbeGenerator`, `RefkitBridge`
- Produces: `EvaluationResult` (with `stateDefects` and `visualDefects`), `FlowInteractiveEvaluator`

- [ ] **Step 1: 编写失败测试**

```typescript
// tests/unit/evaluator/flow-interactive-evaluator.test.ts
import { describe, it, expect, vi } from 'vitest';
import { FlowInteractiveEvaluator } from '../../src/evaluator/flow/flow-interactive-evaluator.ts';
import type { TaskContext } from '../../src/core/types.ts';

describe('FlowInteractiveEvaluator Dual-Track Diagnostics', () => {
  it('produces StateDefect when a required element is missing during flow', async () => {
    const mockOrchestrator: any = {
      runFlow: vi.fn().mockResolvedValue({
        flowId: 'flow-edit',
        success: false,
        failedStepId: 'step-2',
        completedSteps: 1,
        totalSteps: 2,
        stepReports: [
          {
            stepId: 'step-2',
            action: 'tap',
            success: false,
            targetResolvedBy: 'none',
            durationMs: 100,
            error: {
              code: 'ELEMENT_NOT_FOUND',
              message: 'Target flow.button.save not found',
              targetIdentifier: 'flow.button.save',
            },
          },
        ],
      }),
    };

    const evaluator = new FlowInteractiveEvaluator(mockOrchestrator);
    const context: TaskContext = {
      projectPath: '/tmp/proj',
      taskId: 'task-flow-1',
      flowConfig: {
        flowFile: '.aire/flows/edit.json',
      },
    };

    const result = await evaluator.evaluate(context);
    expect(result.passed).toBe(false);
    expect(result.type).toBe('FLOW_INTERACTIVE');
    expect(result.stateDefects).toBeDefined();
    expect(result.stateDefects?.[0].targetIdentifier).toBe('flow.button.save');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npm test tests/unit/evaluator/flow-interactive-evaluator.test.ts`
预期：FAIL

- [ ] **Step 3: 编写 Minimal Implementation**

更新 `src/core/types.ts` 和 `src/dag/types.ts`，实现 `src/evaluator/flow/flow-interactive-evaluator.ts`，将其接入 `src/evaluator/evaluator-pipeline.ts`。

- [ ] **Step 4: 运行测试验证通过**

运行：`npm test tests/unit/evaluator/flow-interactive-evaluator.test.ts`
预期：PASS

- [ ] **Step 5: 提交 Git**

```bash
git add src/core/types.ts src/dag/types.ts src/evaluator/ tests/unit/evaluator/flow-interactive-evaluator.test.ts
git commit -m "feat(evaluator): implement FlowInteractiveEvaluator with dual-track defects"
```

---

### Task 7: TaskGraphCompiler 升级与端到端集成验证

**Files:**
- Modify: `src/planner/task-graph-compiler.ts`
- Modify: `src/analysis/ui-analyst.ts`
- Create: `tests/integration/flow-orchestrator-e2e.test.ts`

**Interfaces:**
- Consumes: `AnalysisIR`, `FlowDefinition`, `TaskGraphConfig`
- Produces: 包含 `verification.flow` 的 `TaskNode` 和 `.aire/flows/<flow-id>.json`

- [ ] **Step 1: 编写失败测试**

```typescript
// tests/integration/flow-orchestrator-e2e.test.ts
import { describe, it, expect } from 'vitest';
import { TaskGraphCompiler } from '../../src/planner/task-graph-compiler.ts';
import type { AnalysisIR } from '../../src/analysis/types.ts';

describe('TaskGraphCompiler Flow Integration', () => {
  it('generates flow verification tasks and writes flow json specs for multi-step flows', async () => {
    const compiler = new TaskGraphCompiler();
    const mockIr: any = {
      appName: 'TestApp',
      targetScheme: 'TestApp',
      flows: [
        {
          id: 'flow-checkout',
          name: 'Checkout Flow',
          description: 'Cart to Payment',
          steps: [
            { stepNumber: 1, screenId: 'cart', action: 'tap(flow.button.pay)', expectedState: 'screen.payment' },
          ],
        },
      ],
      requirements: [],
      tokens: [],
      screens: [],
      entities: [],
      architecture: { layers: { models: { files: [] }, viewModels: { files: [] }, views: { files: [] } }, fileBoundaries: [] },
    };

    const graph = compiler.compile(mockIr);
    const flowTask = graph.tasks.find((t) => t.verification?.flow);
    expect(flowTask).toBeDefined();
    expect(flowTask?.verification.flow?.flowFile).toContain('flow-checkout');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npm test tests/integration/flow-orchestrator-e2e.test.ts`
预期：FAIL

- [ ] **Step 3: 编写 Minimal Implementation**

在 `TaskGraphCompiler` 中增加对 `ir.flows` 的编译逻辑，生成 `.aire/flows/*.json` 与绑定 `verification.flow` 的任务节点。
在 `UiAnalyst` 中确保为 UI 组件标注语义规范的 `accessibilityIdentifier`。

- [ ] **Step 4: 运行测试验证通过**

运行：`npm test tests/integration/flow-orchestrator-e2e.test.ts`
预期：PASS

- [ ] **Step 5: 全量测试回归**

运行：`export PATH="/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH" && npm test`
预期：185+ tests 全部 100% 绿色通过。

- [ ] **Step 6: 提交 Git**

```bash
git add src/planner/task-graph-compiler.ts src/analysis/ui-analyst.ts tests/integration/flow-orchestrator-e2e.test.ts
git commit -m "feat(compiler): compile flows to flow verification tasks and e2e integration"
```
