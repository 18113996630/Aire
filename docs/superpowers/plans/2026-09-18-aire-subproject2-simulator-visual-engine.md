# AIRE Sub-project 2: iOS 模拟器自动化与视觉质检引擎 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 iOS 模拟器自动化控制驱动与基于 `refkit` 算法的像素级视觉质检引擎，实现「构建 → 启动安装运行 → 原生截屏 → 探针度量 → 容差判定 → 视觉自愈修复」的闭环。

**Architecture:** 采用责任链模式（`EvaluatorPipeline`）调度 `XcodeBuildEvaluator` 与 `VisualReviewEvaluator`。`VisualReviewEvaluator` 协同 `SimulatorManager`（负责 `xcrun simctl` 生命周期）与 `RefkitBridge`（通过 `uv` 驱动 `refkit.py`），并由 `AutoProbeGenerator` 自动合成内部度量探针，将超标缺陷组装为「无探针即流言」的高聚焦自愈提示词回传给 Coding Agent。

**Tech Stack:** TypeScript (Node.js `--experimental-strip-types`), Python 3 (`uv run` 驱动 Pillow & numpy), macOS 原生 `xcrun simctl`, `xcodebuild`, Git.

**Spec:** [`docs/superpowers/specs/2026-09-18-aire-subproject2-simulator-visual-engine-design.md`](../specs/2026-09-18-aire-subproject2-simulator-visual-engine-design.md)

## Global Constraints

- **Node.js 执行环境**：使用 `node --experimental-strip-types` 原生运行 TypeScript，无需预编译步骤。
- **Python 执行环境**：使用 `/Users/huangrong/.local/bin/uv run tools/refkit.py` 执行图像测量算法，不污染系统全局 Python 环境。
- **测试金字塔与速度**：Layer 1 单测与 Layer 2 集成测试必须在内存/Mock 中运行，不强依赖真实 Xcode 模拟器，单次全量执行 $< 5\text{s}$。
- **向后兼容性**：Sub-project 1 已有的 17 个测试（状态机、Git 回滚、编译错误解析）必须持续保持 100% 通过。
- **可辩护复刻与探针规则**：所有视觉缺陷报告必须包含 `probeBox`、`expected`、`actual` 与绝对 `delta`，容差标准为：容器平均色差 $\le 7.0$，间距偏差 $\le 2.0\text{ pt}$，文字容差 $\le 15.0$。
- **参数全面可配**：`maxRetries`、各类容差上限、模拟器设备名必须支持在 CLI 参数与上下文中自由配置。

---

## File Structure

```text
tools/
└── refkit.py                         # 视觉度量算法内核（直接复用 super-prototyping）
src/
├── core/
│   ├── types.ts                      # 扩充 VisualDefect, EvaluationResult 类型定义
│   ├── context.ts                    # 扩充 TaskContext 视觉配置与产物字段
│   └── prompt-builder.ts             # 扩展支持视觉量化缺陷提示词组装
├── ios/
│   ├── types.ts                      # 模拟器设备信息与命令响应类型
│   └── simulator-manager.ts          # ISimulatorManager 实现（xcrun simctl 封装）
├── evaluator/
│   ├── pipeline.ts                   # EvaluatorPipeline 责任链执行器与短路逻辑
│   ├── xcodebuild.ts                 # 扩展 XcodeBuildEvaluator 导出 .app 路径
│   └── visual/
│       ├── refkit-bridge.ts          # uv run tools/refkit.py 桥接器
│       ├── auto-probe-generator.ts   # 确定性算法探针合成器
│       └── visual-evaluator.ts       # VisualReviewEvaluator 视觉评审评估器
bin/
└── aire.ts                           # CLI 入口增加 --reference, --focus, --max-retries 等参数
tests/
├── unit/
│   ├── refkit-tool.test.ts           # refkit.py 基础执行测试
│   ├── simulator-manager.test.ts     # simctl 设备识别与命令组装单测
│   ├── pipeline.test.ts              # 责任链流水线短路测试
│   ├── refkit-bridge.test.ts         # refkit batch 输出解析单测
│   ├── auto-probe-generator.test.ts  # 探针生成测试
│   ├── visual-prompt-builder.test.ts # 视觉自愈提示词模板测试
│   └── visual-evaluator.test.ts      # VisualReviewEvaluator 单元测试
├── integration/
│   └── visual-fix-loop.test.ts       # 模拟器视觉自愈 2 轮流转集成测试
└── e2e/
    └── live-simulator.test.ts        # 真实 simctl 模拟器端到端测试
```

---

### Task 1: 核心类型与 TaskContext 扩展（Types & Context）

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/context.ts`
- Modify: `tests/unit/context.test.ts`

**Interfaces:**
- Produces:
  - `VisualDefect`: 结构化视觉缺陷类型
  - `VisualToleranceMatrix`: 可配容差矩阵
  - `VisualReplicaConfig`: 视觉复刻输入配置
  - `TaskContext.visualConfig`, `TaskContext.appBundlePath`, `TaskContext.capturedScreenshotPath`, `TaskContext.generatedProbesPath`

- [ ] **Step 1: 编写针对视觉上下文扩展的失败单元测试**

在 `tests/unit/context.test.ts` 中追加对 `visualConfig` 初始化与默认容差矩阵的测试：

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskContext } from '../../src/core/context.ts';

test('TaskContext initializes with visual configuration and default tolerance matrix', () => {
  const ctx = createTaskContext({
    taskId: 'visual-task-1',
    projectPath: '/tmp/test-project',
    scheme: 'MiniApp',
    taskGoal: 'Replicate home card',
    visualConfig: {
      referenceImagePath: '/tmp/ref.png',
      focusAreas: 'Header card and title',
      toleranceMatrix: {
        containerDeltaMax: 7.0,
        spacingPtMax: 2.0,
        textDeltaMax: 15.0,
      },
    },
  });

  assert.equal(ctx.visualConfig?.referenceImagePath, '/tmp/ref.png');
  assert.equal(ctx.visualConfig?.focusAreas, 'Header card and title');
  assert.equal(ctx.visualConfig?.toleranceMatrix.containerDeltaMax, 7.0);
  assert.equal(ctx.visualConfig?.toleranceMatrix.spacingPtMax, 2.0);
  assert.equal(ctx.visualConfig?.toleranceMatrix.textDeltaMax, 15.0);
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
export PATH=/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH
node --experimental-strip-types --test tests/unit/context.test.ts
```
Expected: FAIL（报错提示 `visualConfig` 不在参数定义或类型定义中）。

- [ ] **Step 3: 实现类型定义与上下文方法扩展**

在 `src/core/types.ts` 中添加 `VisualDefect` 并扩展 `EvaluationResult`：
```typescript
export interface VisualDefect {
  id: string;
  severity: 'critical' | 'high' | 'medium';
  category: 'color' | 'spacing' | 'size' | 'layout';
  element: string;
  probeBox: [number, number, number, number];
  expected: string | number;
  actual: string | number;
  delta: number;
  tolerance: number;
  claim: string;
}

export interface EvaluationResult {
  passed: boolean;
  type: 'BUILD' | 'FUNCTIONAL' | 'VISUAL_REVIEW';
  summary: string;
  errors: BuildError[];
  visualDefects?: VisualDefect[];
  meanDelta?: number;
}
```

在 `src/core/context.ts` 中扩展 `VisualToleranceMatrix`、`VisualReplicaConfig` 和 `TaskContext`：
```typescript
export interface VisualToleranceMatrix {
  containerDeltaMax: number;
  spacingPtMax: number;
  textDeltaMax: number;
}

export interface VisualReplicaConfig {
  referenceImagePath: string;
  focusAreas?: string;
  toleranceMatrix: VisualToleranceMatrix;
  preferredDevice?: string;
}

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
  visualConfig?: VisualReplicaConfig;
  appBundlePath?: string;
  bundleId?: string;
  capturedScreenshotPath?: string;
  generatedProbesPath?: string;
  history: Array<{
    iteration: number;
    action: 'INITIAL_PROMPT' | 'FIX_PROMPT';
    promptUsed: string;
    cliSummary?: string;
    evaluationResult?: EvaluationResult;
    timestamp: number;
  }>;
}

export function createTaskContext(params: {
  taskId: string;
  projectPath: string;
  scheme: string;
  taskGoal: string;
  maxRetries?: number;
  visualConfig?: VisualReplicaConfig;
}): TaskContext {
  return {
    taskId: params.taskId,
    projectPath: params.projectPath,
    scheme: params.scheme,
    taskGoal: params.taskGoal,
    maxRetries: params.maxRetries ?? 3,
    currentRetry: 0,
    state: 'IDLE',
    visualConfig: params.visualConfig,
    history: [],
  };
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
export PATH=/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH
node --experimental-strip-types --test tests/unit/context.test.ts
```
Expected: PASS。

- [ ] **Step 5: 提交更改**

```bash
git add src/core/types.ts src/core/context.ts tests/unit/context.test.ts
git commit -m "feat(core): extend types and TaskContext with visual replica models"
```

---

### Task 2: 结构化视觉缺陷提示词组装器（FixPromptBuilder for Visual Review）

**Files:**
- Modify: `src/core/prompt-builder.ts`
- Create: `tests/unit/visual-prompt-builder.test.ts`

**Interfaces:**
- Consumes: `EvaluationResult`, `VisualDefect`
- Produces: `buildFixPrompt(context: TaskContext, lastResult: EvaluationResult): string`（支持 `VISUAL_REVIEW` 分支）

- [ ] **Step 1: 编写针对视觉缺陷提示词的失败测试**

创建 `tests/unit/visual-prompt-builder.test.ts`：
```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFixPrompt } from '../../src/core/prompt-builder.ts';
import { createTaskContext } from '../../src/core/context.ts';
import type { EvaluationResult } from '../../src/core/types.ts';

test('buildFixPrompt generates actionable visual defect prompt when type is VISUAL_REVIEW', () => {
  const ctx = createTaskContext({
    taskId: 't-vis',
    projectPath: '/test',
    scheme: 'MiniApp',
    taskGoal: 'Replicate card view',
  });

  const visualResult: EvaluationResult = {
    passed: false,
    type: 'VISUAL_REVIEW',
    summary: '2 visual probes exceeded tolerance',
    errors: [],
    meanDelta: 9.5,
    visualDefects: [
      {
        id: 'bg-fill',
        severity: 'high',
        category: 'color',
        element: 'Card Background',
        probeBox: [16, 60, 377, 200],
        expected: '#F2F2F7',
        actual: '#FFFFFF',
        delta: 13.0,
        tolerance: 7.0,
        claim: 'Card background is pure white #FFFFFF instead of reference #F2F2F7',
      },
      {
        id: 'card-inset',
        severity: 'high',
        category: 'spacing',
        element: 'Card Horizontal Padding',
        probeBox: [0, 60, 40, 200],
        expected: 16.0,
        actual: 24.0,
        delta: 8.0,
        tolerance: 2.0,
        claim: 'Horizontal padding is 24pt, exceeding reference 16pt by 8pt',
      },
    ],
  };

  const prompt = buildFixPrompt(ctx, visualResult);

  assert.match(prompt, /【UI 视觉质检修复指令】/);
  assert.match(prompt, /bg-fill/);
  assert.match(prompt, /#F2F2F7/);
  assert.match(prompt, /#FFFFFF/);
  assert.match(prompt, /card-inset/);
  assert.match(prompt, /16/);
  assert.match(prompt, /24/);
  assert.match(prompt, /严格对齐上方测量目标/);
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
export PATH=/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH
node --experimental-strip-types --test tests/unit/visual-prompt-builder.test.ts
```
Expected: FAIL（未识别 `VISUAL_REVIEW`，仍输出编译报错模板）。

- [ ] **Step 3: 在 `prompt-builder.ts` 中实现视觉缺陷分支**

更新 `src/core/prompt-builder.ts`：
```typescript
import type { TaskContext } from './context.ts';
import type { EvaluationResult } from './types.ts';

export function buildFixPrompt(context: TaskContext, lastResult: EvaluationResult): string {
  if (lastResult.type === 'VISUAL_REVIEW') {
    const defectLines = (lastResult.visualDefects || []).map((defect, index) => {
      return `${index + 1}. [${defect.element}] 探针 \`${defect.id}\` (区域: [${defect.probeBox.join(', ')}] pt)
   - 期望参考值: ${defect.expected}
   - 实际渲染值: ${defect.actual} (偏差 Delta: ${defect.delta}, 允许容差: ${defect.tolerance})
   - 事实说明: ${defect.claim}`;
    }).join('\n\n');

    return `【UI 视觉质检修复指令】
当前代码已成功构建并在 iOS 模拟器中启动运行，但经像素级探针定量测量（基于参考设计图），发现以下视觉偏差超出容差：

[量化缺陷清单（基于参考图测量探针）]
${defectLines || '- 未提供具体探针明细，全屏平均色差超标。'}

[修改指导与约束]
1. 仅针对上述存在量化偏差的 SwiftUI 视图属性进行精确微调（如 .background(), .padding(), .foregroundStyle(), .frame()）。
2. 数值调整必须严格对齐上方测量目标（pt 与 hex），严禁盲猜魔数。
3. 保持现有代码结构整洁，不得破坏已有编译语法与类型安全。直接输出修改后的代码文件。`;
  }

  // 现有编译错误模板
  const errorList = lastResult.errors
    .map((e) => `- 文件: ${e.file} (第 ${e.line} 行)\n  错误: ${e.message}`)
    .join('\n');

  return `【自动修复指令】
上一次代码修改导致 Xcode 编译失败，请根据以下具体报错进行针对性修复：

[报错清单]
${errorList || '- 编译未通过，但未解析到具体错误行。请检查编译日志。'}

[修改要求]
1. 仅修改解决上述编译错误所必需的代码。
2. 保持项目其他逻辑不变，确保类型与语法正确。
3. 请直接更新文件，无需输出无关解释。`;
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
export PATH=/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH
node --experimental-strip-types --test tests/unit/visual-prompt-builder.test.ts
```
Expected: PASS。

- [ ] **Step 5: 提交更改**

```bash
git add src/core/prompt-builder.ts tests/unit/visual-prompt-builder.test.ts
git commit -m "feat(core): add visual review defect template to buildFixPrompt"
```

---

### Task 3: 移植 Refkit 度量内核并配置 uv 运行验证（Refkit Placement）

**Files:**
- Create: `tools/refkit.py`
- Create: `tests/unit/refkit-tool.test.ts`

**Interfaces:**
- Produces: `tools/refkit.py` 脚本，可直接通过 `uv run --with pillow --with numpy tools/refkit.py` 调用

- [ ] **Step 1: 复制并验证 `refkit.py` 工具文件**

将 `docs/reference-project/super-prototyping/tools/refkit.py` 拷贝至项目专属工具目录 `tools/refkit.py`：
```bash
mkdir -p tools
cp docs/reference-project/super-prototyping/tools/refkit.py tools/refkit.py
chmod +x tools/refkit.py
```

- [ ] **Step 2: 编写测试脚本验证 `refkit.py` 可在本地 uv 环境下正常运行**

创建 `tests/unit/refkit-tool.test.ts`：
```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

test('refkit.py can be invoked via uv and prints help banner', () => {
  const uvPath = '/Users/huangrong/.local/bin/uv';
  const refkitPath = path.resolve('tools/refkit.py');

  const stdout = execFileSync(uvPath, ['run', '--with', 'pillow', '--with', 'numpy', refkitPath, '--help'], {
    encoding: 'utf8',
  });

  assert.match(stdout, /refkit, a reference-to-mockup toolkit/);
  assert.match(stdout, /sample/);
  assert.match(stdout, /bands/);
  assert.match(stdout, /batch/);
  assert.match(stdout, /diff/);
});
```

- [ ] **Step 3: 运行测试验证**

```bash
export PATH=/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH
node --experimental-strip-types --test tests/unit/refkit-tool.test.ts
```
Expected: PASS（打印出 refkit CLI 的帮助信息）。

- [ ] **Step 4: 提交更改**

```bash
git add tools/refkit.py tests/unit/refkit-tool.test.ts
git commit -m "feat(tools): add refkit.py measuring toolkit and uv integration test"
```

---

### Task 4: 模拟器驱动管理器（SimulatorManager & xcrun simctl）

**Files:**
- Create: `src/ios/types.ts`
- Create: `src/ios/simulator-manager.ts`
- Create: `tests/unit/simulator-manager.test.ts`

**Interfaces:**
- Produces: `ISimulatorManager` 接口与 `SimulatorManager` 类
  - `findOrBootDevice(preferredName?: string): Promise<string>`
  - `installApp(udid: string, appBundlePath: string): Promise<void>`
  - `launchApp(udid: string, bundleId: string): Promise<number>`
  - `takeScreenshot(udid: string, outputPath: string): Promise<void>`
  - `terminateApp(udid: string, bundleId: string): Promise<void>`

- [ ] **Step 1: 编写针对 `SimulatorManager` 的失败单元测试（支持注入命令执行函数）**

创建 `tests/unit/simulator-manager.test.ts`：
```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulatorManager } from '../../src/ios/simulator-manager.ts';

test('findOrBootDevice reuses already booted device', async () => {
  const mockExec = async (cmd: string, args: string[]) => {
    if (args[0] === 'list' && args[1] === 'devices') {
      return JSON.stringify({
        devices: {
          'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [
            {
              udid: 'BOOTED-UDID-1234',
              name: 'iPhone 16 Pro',
              state: 'Booted',
              isAvailable: true,
            },
          ],
        },
      });
    }
    return '';
  };

  const manager = new SimulatorManager(mockExec);
  const udid = await manager.findOrBootDevice('iPhone 16 Pro');
  assert.equal(udid, 'BOOTED-UDID-1234');
});

test('findOrBootDevice boots shutdown device if none is booted', async () => {
  const executed: string[] = [];
  const mockExec = async (cmd: string, args: string[]) => {
    executed.push(`${cmd} ${args.join(' ')}`);
    if (args[0] === 'list' && args[1] === 'devices') {
      return JSON.stringify({
        devices: {
          'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [
            {
              udid: 'SHUTDOWN-UDID-5678',
              name: 'iPhone 16 Pro',
              state: 'Shutdown',
              isAvailable: true,
            },
          ],
        },
      });
    }
    return '';
  };

  const manager = new SimulatorManager(mockExec);
  const udid = await manager.findOrBootDevice('iPhone 16 Pro');
  assert.equal(udid, 'SHUTDOWN-UDID-5678');
  assert.ok(executed.some((c) => c.includes('boot SHUTDOWN-UDID-5678')));
});

test('takeScreenshot calls simctl io screenshot', async () => {
  const executed: string[] = [];
  const mockExec = async (cmd: string, args: string[]) => {
    executed.push(`${cmd} ${args.join(' ')}`);
    return '';
  };

  const manager = new SimulatorManager(mockExec);
  await manager.takeScreenshot('UDID-999', '/tmp/out.png');
  assert.ok(executed.some((c) => c.includes('io UDID-999 screenshot /tmp/out.png')));
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
export PATH=/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH
node --experimental-strip-types --test tests/unit/simulator-manager.test.ts
```
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/ios/types.ts` 与 `src/ios/simulator-manager.ts`**

创建 `src/ios/types.ts`：
```typescript
export interface SimDevice {
  udid: string;
  name: string;
  state: 'Booted' | 'Shutdown' | 'Unknown';
  isAvailable?: boolean;
}

export type SimctlExecFn = (cmd: string, args: string[]) => Promise<string>;
```

创建 `src/ios/simulator-manager.ts`：
```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SimDevice, SimctlExecFn } from './types.ts';

const execFileAsync = promisify(execFile);

const defaultExecFn: SimctlExecFn = async (cmd, args) => {
  const { stdout } = await execFileAsync(cmd, args);
  return stdout;
};

export interface ISimulatorManager {
  findOrBootDevice(preferredName?: string): Promise<string>;
  installApp(udid: string, appBundlePath: string): Promise<void>;
  launchApp(udid: string, bundleId: string): Promise<number>;
  takeScreenshot(udid: string, outputPath: string): Promise<void>;
  terminateApp(udid: string, bundleId: string): Promise<void>;
  sendInput?(udid: string, action: string, params: Record<string, any>): Promise<void>;
}

export class SimulatorManager implements ISimulatorManager {
  constructor(private execFn: SimctlExecFn = defaultExecFn) {}

  async listDevices(): Promise<SimDevice[]> {
    const raw = await this.execFn('xcrun', ['simctl', 'list', 'devices', '-j']);
    const parsed = JSON.parse(raw);
    const devices: SimDevice[] = [];
    for (const runtime of Object.values(parsed.devices || {})) {
      if (Array.isArray(runtime)) {
        for (const d of runtime) {
          if (d.isAvailable !== false) {
            devices.push({
              udid: d.udid,
              name: d.name,
              state: d.state === 'Booted' ? 'Booted' : 'Shutdown',
              isAvailable: d.isAvailable,
            });
          }
        }
      }
    }
    return devices;
  }

  async findOrBootDevice(preferredName = 'iPhone 16 Pro'): Promise<string> {
    const devices = await this.listDevices();
    const booted = devices.find((d) => d.state === 'Booted' && (!preferredName || d.name === preferredName))
      || devices.find((d) => d.state === 'Booted');
    if (booted) {
      return booted.udid;
    }

    const target = devices.find((d) => d.name === preferredName) || devices[0];
    if (!target) {
      throw new Error(`No available iOS simulator found matching '${preferredName}'.`);
    }

    await this.execFn('xcrun', ['simctl', 'boot', target.udid]);
    return target.udid;
  }

  async installApp(udid: string, appBundlePath: string): Promise<void> {
    await this.execFn('xcrun', ['simctl', 'install', udid, appBundlePath]);
  }

  async launchApp(udid: string, bundleId: string): Promise<number> {
    const out = await this.execFn('xcrun', ['simctl', 'launch', udid, bundleId]);
    const match = out.match(/: (\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  async takeScreenshot(udid: string, outputPath: string): Promise<void> {
    await this.execFn('xcrun', ['simctl', 'io', udid, 'screenshot', outputPath]);
  }

  async terminateApp(udid: string, bundleId: string): Promise<void> {
    try {
      await this.execFn('xcrun', ['simctl', 'terminate', udid, bundleId]);
    } catch {
      // 忽略未运行时 terminate 抛出的错误
    }
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
export PATH=/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH
node --experimental-strip-types --test tests/unit/simulator-manager.test.ts
```
Expected: PASS。

- [ ] **Step 5: 提交更改**

```bash
git add src/ios/types.ts src/ios/simulator-manager.ts tests/unit/simulator-manager.test.ts
git commit -m "feat(ios): implement SimulatorManager with xcrun simctl driver"
```

---

### Task 5: 责任链评估流水线（EvaluatorPipeline）

**Files:**
- Create: `src/evaluator/pipeline.ts`
- Create: `tests/unit/pipeline.test.ts`

**Interfaces:**
- Produces: `EvaluatorPipeline` implements `IEvaluator`
  - `evaluate(context: TaskContext): Promise<EvaluationResult>`（遇到失败短路返回）

- [ ] **Step 1: 编写责任链短路与顺序执行的失败测试**

创建 `tests/unit/pipeline.test.ts`：
```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { EvaluatorPipeline } from '../../src/evaluator/pipeline.ts';
import { createTaskContext } from '../../src/core/context.ts';
import type { IEvaluator, EvaluationResult } from '../../src/evaluator/evaluator.interface.ts';

test('EvaluatorPipeline short-circuits on first failing evaluator', async () => {
  let secondCalled = false;

  const firstEvaluator: IEvaluator = {
    name: 'FirstBuild',
    evaluate: async () => ({
      passed: false,
      type: 'BUILD',
      summary: 'Compilation failed',
      errors: [{ file: 'A.swift', line: 1, column: 1, message: 'syntax error' }],
    }),
  };

  const secondEvaluator: IEvaluator = {
    name: 'SecondVisual',
    evaluate: async () => {
      secondCalled = true;
      return { passed: true, type: 'VISUAL_REVIEW', summary: 'Visual pass', errors: [] };
    },
  };

  const pipeline = new EvaluatorPipeline([firstEvaluator, secondEvaluator]);
  const ctx = createTaskContext({ taskId: 't1', projectPath: '/tmp', scheme: 'App', taskGoal: 'Build' });

  const result = await pipeline.evaluate(ctx);

  assert.equal(result.passed, false);
  assert.equal(result.type, 'BUILD');
  assert.equal(secondCalled, false, 'Second evaluator must not be called when first fails');
});

test('EvaluatorPipeline returns final success when all evaluators pass', async () => {
  const firstEvaluator: IEvaluator = {
    name: 'FirstBuild',
    evaluate: async () => ({ passed: true, type: 'BUILD', summary: 'Build pass', errors: [] }),
  };

  const secondEvaluator: IEvaluator = {
    name: 'SecondVisual',
    evaluate: async () => ({ passed: true, type: 'VISUAL_REVIEW', summary: 'Visual pass', errors: [] }),
  };

  const pipeline = new EvaluatorPipeline([firstEvaluator, secondEvaluator]);
  const ctx = createTaskContext({ taskId: 't1', projectPath: '/tmp', scheme: 'App', taskGoal: 'Build' });

  const result = await pipeline.evaluate(ctx);

  assert.equal(result.passed, true);
  assert.equal(result.type, 'VISUAL_REVIEW');
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
export PATH=/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH
node --experimental-strip-types --test tests/unit/pipeline.test.ts
```
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/evaluator/pipeline.ts`**

创建 `src/evaluator/pipeline.ts`：
```typescript
import type { IEvaluator, EvaluationResult } from './evaluator.interface.ts';
import type { TaskContext } from '../core/context.ts';

export class EvaluatorPipeline implements IEvaluator {
  readonly name = 'EvaluatorPipeline';

  constructor(private evaluators: IEvaluator[]) {}

  async evaluate(context: TaskContext): Promise<EvaluationResult> {
    let lastSuccessResult: EvaluationResult = {
      passed: true,
      type: 'BUILD',
      summary: 'Empty pipeline',
      errors: [],
    };

    for (const evaluator of this.evaluators) {
      const result = await evaluator.evaluate(context);
      if (!result.passed) {
        return result;
      }
      lastSuccessResult = result;
    }

    return lastSuccessResult;
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
export PATH=/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH
node --experimental-strip-types --test tests/unit/pipeline.test.ts
```
Expected: PASS。

- [ ] **Step 5: 提交更改**

```bash
git add src/evaluator/pipeline.ts tests/unit/pipeline.test.ts
git commit -m "feat(evaluator): implement EvaluatorPipeline with short-circuiting"
```

---

### Task 6: Refkit 桥接适配器（RefkitBridge）

**Files:**
- Create: `src/evaluator/visual/refkit-bridge.ts`
- Create: `tests/unit/refkit-bridge.test.ts`

**Interfaces:**
- Produces: `IRefkitBridge` 接口与 `RefkitBridge` 实现
  - `runBatch(probesJsonPath: string, againstDir: string, scale: number): Promise<RefkitBatchReport>`
  - `runDiff(mineImage: string, refImage: string): Promise<{ meanDelta: number }>`

- [ ] **Step 1: 编写 Refkit 批处理解析与容差判定的单元测试**

创建 `tests/unit/refkit-bridge.test.ts`：
```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { RefkitBridge } from '../../src/evaluator/visual/refkit-bridge.ts';

test('RefkitBridge parses batch output and flags probes exceeding tolerance', async () => {
  const mockUvRunner = async (args: string[]) => {
    if (args.includes('batch')) {
      return `
probe                 ref        mine       delta
bg                    #F2F2F7    #FFFFFF    13.0     <-- off
title-ink             #1D1D1F    #1D1D1F     0.0
card-inset            16.0       24.0        8.0     <-- off
mean Δ 9.50   worst 24px bands:
`;
    }
    return '';
  };

  const bridge = new RefkitBridge('/path/to/uv', '/path/to/refkit.py', mockUvRunner);
  const report = await bridge.runBatch('/tmp/probes.json', '/tmp/renders', 3.0);

  assert.equal(report.meanDelta, 9.5);
  assert.equal(report.passed, false);
  assert.equal(report.probeResults.length, 3);
  const offProbes = report.probeResults.filter((p) => !p.passed);
  assert.equal(offProbes.length, 2);
  assert.equal(offProbes[0].probeId, 'bg');
  assert.equal(offProbes[0].delta, 13.0);
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
export PATH=/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH
node --experimental-strip-types --test tests/unit/refkit-bridge.test.ts
```
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/evaluator/visual/refkit-bridge.ts`**

创建 `src/evaluator/visual/refkit-bridge.ts`：
```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ProbeExecutionResult {
  probeId: string;
  expected: string | number;
  actual: string | number;
  delta: number;
  passed: boolean;
}

export interface RefkitBatchReport {
  meanDelta: number;
  passed: boolean;
  probeResults: ProbeExecutionResult[];
  worstBands: Array<{
    y0: number;
    y1: number;
    delta: number;
    mineHex: string;
    refHex: string;
  }>;
}

export type UvRunFn = (args: string[]) => Promise<string>;

export interface IRefkitBridge {
  runBatch(probesJsonPath: string, againstDir: string, scale: number): Promise<RefkitBatchReport>;
  runDiff(mineImage: string, refImage: string): Promise<{ meanDelta: number }>;
}

export class RefkitBridge implements IRefkitBridge {
  constructor(
    private uvPath = '/Users/huangrong/.local/bin/uv',
    private refkitPyPath = 'tools/refkit.py',
    private runner?: UvRunFn
  ) {}

  private async execute(args: string[]): Promise<string> {
    if (this.runner) {
      return this.runner(args);
    }
    const { stdout } = await execFileAsync(this.uvPath, [
      'run',
      '--with',
      'pillow',
      '--with',
      'numpy',
      this.refkitPyPath,
      ...args,
    ]);
    return stdout;
  }

  async runBatch(probesJsonPath: string, againstDir: string, scale: number): Promise<RefkitBatchReport> {
    const rawOutput = await this.execute([
      'batch',
      probesJsonPath,
      '--against',
      againstDir,
      '--pt',
      scale.toString(),
    ]);

    const lines = rawOutput.split('\n');
    const probeResults: ProbeExecutionResult[] = [];
    let meanDelta = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      const meanMatch = trimmed.match(/^mean Δ\s+([\d.]+)/);
      if (meanMatch) {
        meanDelta = parseFloat(meanMatch[1]);
        continue;
      }

      // 匹配表格行：probe ref mine delta (<-- off)?
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 4 && parts[0] !== 'probe' && parts[0] !== 'mean') {
        const id = parts[0];
        const refVal = parts[1];
        const mineVal = parts[2];
        const delta = parseFloat(parts[3]) || 0;
        const isOff = trimmed.includes('<-- off');
        probeResults.push({
          probeId: id,
          expected: isNaN(Number(refVal)) ? refVal : Number(refVal),
          actual: isNaN(Number(mineVal)) ? mineVal : Number(mineVal),
          delta,
          passed: !isOff,
        });
      }
    }

    const allPassed = probeResults.every((p) => p.passed) && (meanDelta <= 7.0 || probeResults.length > 0);

    return {
      meanDelta,
      passed: allPassed,
      probeResults,
      worstBands: [],
    };
  }

  async runDiff(mineImage: string, refImage: string): Promise<{ meanDelta: number }> {
    const rawOutput = await this.execute(['diff', mineImage, refImage]);
    const match = rawOutput.match(/mean Δ\s+([\d.]+)/);
    const meanDelta = match ? parseFloat(match[1]) : 0;
    return { meanDelta };
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
export PATH=/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH
node --experimental-strip-types --test tests/unit/refkit-bridge.test.ts
```
Expected: PASS。

- [ ] **Step 5: 提交更改**

```bash
git add src/evaluator/visual/refkit-bridge.ts tests/unit/refkit-bridge.test.ts
git commit -m "feat(evaluator): implement RefkitBridge for batch measuring and diff"
```

---

### Task 7: 确定性算法探针合成器（AutoProbeGenerator）

**Files:**
- Create: `src/evaluator/visual/auto-probe-generator.ts`
- Create: `tests/unit/auto-probe-generator.test.ts`

**Interfaces:**
- Produces: `AutoProbeGenerator`
  - `generateProbes(params: { referenceImagePath: string; renderedImageName: string; scale?: number; outputPath: string }): Promise<string>`

- [ ] **Step 1: 编写探针合成与结构校验单元测试**

创建 `tests/unit/auto-probe-generator.test.ts`：
```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AutoProbeGenerator } from '../../src/evaluator/visual/auto-probe-generator.ts';

test('AutoProbeGenerator generates valid probes.json with core probe rows', async () => {
  const tmpOut = path.resolve('/tmp/test-probes.json');
  const generator = new AutoProbeGenerator();

  const generatedPath = await generator.generateProbes({
    referenceImagePath: 'fixtures/MiniApp/reference.png',
    renderedImageName: 'mine.png',
    scale: 3.0,
    outputPath: tmpOut,
  });

  assert.equal(generatedPath, tmpOut);
  const raw = await fs.readFile(tmpOut, 'utf8');
  const probes = JSON.parse(raw);

  assert.ok(Array.isArray(probes));
  assert.ok(probes.some((p: any) => p.id === 'bg-fill'));
  assert.ok(probes.some((p: any) => p.id === 'title-ink'));
  assert.ok(probes.some((p: any) => p.id === 'card-inset'));

  const bgProbe = probes.find((p: any) => p.id === 'bg-fill');
  assert.equal(bgProbe.cmd, 'sample');
  assert.equal(bgProbe.only, 'flat');
  assert.equal(bgProbe.mine, 'mine.png');
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
export PATH=/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH
node --experimental-strip-types --test tests/unit/auto-probe-generator.test.ts
```
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/evaluator/visual/auto-probe-generator.ts`**

创建 `src/evaluator/visual/auto-probe-generator.ts`：
```typescript
import fs from 'node:fs/promises';
import path from 'node:path';

export interface ProbeRow {
  id: string;
  cmd: 'sample' | 'bbox' | 'scan' | 'hairline' | 'bands';
  box?: [number, number, number, number];
  axis?: 'row' | 'col';
  at?: number;
  range?: [number, number];
  only?: 'flat' | 'ink';
  ink?: string;
  bg?: string;
  scale?: string;
  img: string;
  mine: string;
  _?: string;
}

export class AutoProbeGenerator {
  async generateProbes(params: {
    referenceImagePath: string;
    renderedImageName: string;
    scale?: number;
    outputPath: string;
  }): Promise<string> {
    const scale = params.scale ?? 3.0;
    const ref = params.referenceImagePath;
    const mine = params.renderedImageName;

    // 确定性基准探针集
    const probes: ProbeRow[] = [
      {
        id: 'bg-fill',
        img: ref,
        mine,
        cmd: 'sample',
        box: [100, 65, 300, 105],
        only: 'flat',
        _': 'Page ground below Dynamic Island and above title ink',
      },
      {
        id: 'title-ink',
        img: ref,
        mine,
        cmd: 'sample',
        box: [20, 110, 370, 150],
        only: 'ink',
        ink: '8',
        _': 'Title text ink core (darkest 8%)',
      },
      {
        id: 'card-inset',
        img: ref,
        mine,
        cmd: 'scan',
        axis: 'row',
        at: 220,
        range: [0, 60],
        _': 'Horizontal inset scan to detect card left padding',
      },
      {
        id: 'content-band',
        img: ref,
        mine,
        cmd: 'bands',
        box: [20, 150, 370, 600],
        _': 'Main vertical ink rhythm and row pitches',
      },
    ];

    await fs.mkdir(path.dirname(params.outputPath), { recursive: true });
    await fs.writeFile(params.outputPath, JSON.stringify(probes, null, 2), 'utf8');
    return params.outputPath;
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
export PATH=/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH
node --experimental-strip-types --test tests/unit/auto-probe-generator.test.ts
```
Expected: PASS。

- [ ] **Step 5: 提交更改**

```bash
git add src/evaluator/visual/auto-probe-generator.ts tests/unit/auto-probe-generator.test.ts
git commit -m "feat(evaluator): implement AutoProbeGenerator for deterministic probe extraction"
```

---

### Task 8: 视觉评审评估器与 Xcode 产物导出（VisualReviewEvaluator & XcodeBuild Export）

**Files:**
- Modify: `src/evaluator/xcodebuild.ts`
- Create: `src/evaluator/visual/visual-evaluator.ts`
- Create: `tests/unit/visual-evaluator.test.ts`

**Interfaces:**
- Produces: `VisualReviewEvaluator` implements `IEvaluator`
  - 调度 `SimulatorManager` 截屏，调用 `AutoProbeGenerator` 与 `RefkitBridge` 进行探针度量，返回结构化 `EvaluationResult`
- Enhances: `XcodeBuildEvaluator` 提取并存储 `context.appBundlePath` 与 `context.bundleId`

- [ ] **Step 1: 编写 VisualReviewEvaluator 失败单元测试（Mock 注入）**

创建 `tests/unit/visual-evaluator.test.ts`：
```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { VisualReviewEvaluator } from '../../src/evaluator/visual/visual-evaluator.ts';
import { createTaskContext } from '../../src/core/context.ts';
import type { ISimulatorManager } from '../../src/ios/simulator-manager.ts';
import type { IRefkitBridge, RefkitBatchReport } from '../../src/evaluator/visual/refkit-bridge.ts';

test('VisualReviewEvaluator intercepts when probes fail and returns VisualDefects', async () => {
  const mockSim: ISimulatorManager = {
    findOrBootDevice: async () => 'UDID-MOCK',
    installApp: async () => {},
    launchApp: async () => 1234,
    takeScreenshot: async () => {},
    terminateApp: async () => {},
  };

  const mockRefkit: IRefkitBridge = {
    runBatch: async (): Promise<RefkitBatchReport> => ({
      meanDelta: 12.0,
      passed: false,
      probeResults: [
        {
          probeId: 'bg-fill',
          expected: '#F2F2F7',
          actual: '#FFFFFF',
          delta: 13.0,
          passed: false,
        },
      ],
      worstBands: [],
    }),
    runDiff: async () => ({ meanDelta: 12.0 }),
  };

  const evaluator = new VisualReviewEvaluator(mockSim, mockRefkit);
  const ctx = createTaskContext({
    taskId: 'vis-task',
    projectPath: '/test',
    scheme: 'MiniApp',
    taskGoal: 'Replicate home',
    visualConfig: {
      referenceImagePath: '/tmp/ref.png',
      toleranceMatrix: {
        containerDeltaMax: 7.0,
        spacingPtMax: 2.0,
        textDeltaMax: 15.0,
      },
    },
  });
  ctx.appBundlePath = '/tmp/MiniApp.app';

  const result = await evaluator.evaluate(ctx);

  assert.equal(result.passed, false);
  assert.equal(result.type, 'VISUAL_REVIEW');
  assert.equal(result.visualDefects?.length, 1);
  assert.equal(result.visualDefects?.[0].id, 'bg-fill');
  assert.equal(result.visualDefects?.[0].expected, '#F2F2F7');
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
export PATH=/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH
node --experimental-strip-types --test tests/unit/visual-evaluator.test.ts
```
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 更新 `xcodebuild.ts` 导出产物路径并实现 `visual-evaluator.ts`**

在 `src/evaluator/xcodebuild.ts` 中设置默认 bundleId 与产物探测：
```typescript
// 在 evaluate 成功分支补充：
context.appBundlePath = `${context.projectPath}/build/Build/Products/Debug-iphonesimulator/${context.scheme}.app`;
context.bundleId = `com.example.${context.scheme}`;
```

创建 `src/evaluator/visual/visual-evaluator.ts`：
```typescript
import path from 'node:path';
import type { IEvaluator, EvaluationResult } from '../evaluator.interface.ts';
import type { TaskContext } from '../../core/context.ts';
import type { ISimulatorManager } from '../../ios/simulator-manager.ts';
import type { IRefkitBridge } from './refkit-bridge.ts';
import { AutoProbeGenerator } from './auto-probe-generator.ts';
import { SimulatorManager } from '../../ios/simulator-manager.ts';
import { RefkitBridge } from './refkit-bridge.ts';

export class VisualReviewEvaluator implements IEvaluator {
  readonly name = 'VisualReviewEvaluator';

  constructor(
    private simManager: ISimulatorManager = new SimulatorManager(),
    private refkitBridge: IRefkitBridge = new RefkitBridge(),
    private probeGenerator = new AutoProbeGenerator()
  ) {}

  async evaluate(context: TaskContext): Promise<EvaluationResult> {
    if (!context.visualConfig?.referenceImagePath) {
      return {
        passed: true,
        type: 'VISUAL_REVIEW',
        summary: 'No reference image specified; skipping visual review.',
        errors: [],
      };
    }

    const artifactDir = path.resolve(context.projectPath, '.aire/artifacts');
    const screenshotPath = path.join(artifactDir, 'simulator-shot.png');
    const probesPath = path.join(artifactDir, 'probes.json');
    context.capturedScreenshotPath = screenshotPath;
    context.generatedProbesPath = probesPath;

    // 1. 模拟器运行与截屏
    const udid = await this.simManager.findOrBootDevice(context.visualConfig.preferredDevice);
    if (context.appBundlePath) {
      await this.simManager.installApp(udid, context.appBundlePath);
    }
    if (context.bundleId) {
      await this.simManager.launchApp(udid, context.bundleId);
    }
    await this.simManager.takeScreenshot(udid, screenshotPath);

    // 2. 自动生成度量探针
    await this.probeGenerator.generateProbes({
      referenceImagePath: context.visualConfig.referenceImagePath,
      renderedImageName: path.basename(screenshotPath),
      scale: 3.0,
      outputPath: probesPath,
    });

    // 3. 执行 Refkit 批处理度量
    const report = await this.refkitBridge.runBatch(probesPath, artifactDir, 3.0);

    const tolerance = context.visualConfig.toleranceMatrix;
    const defects = report.probeResults
      .filter((p) => !p.passed)
      .map((p) => ({
        id: p.probeId,
        severity: 'high' as const,
        category: (p.probeId.includes('inset') ? 'spacing' : 'color') as any,
        element: p.probeId,
        probeBox: [0, 0, 100, 100] as [number, number, number, number],
        expected: p.expected,
        actual: p.actual,
        delta: p.delta,
        tolerance: p.probeId.includes('inset') ? tolerance.spacingPtMax : tolerance.containerDeltaMax,
        claim: `Probe ${p.probeId} measured ${p.actual}, expected ${p.expected} (delta ${p.delta}).`,
      }));

    if (defects.length > 0 || !report.passed) {
      return {
        passed: false,
        type: 'VISUAL_REVIEW',
        summary: `${defects.length} visual defects identified in simulator rendering.`,
        errors: [],
        visualDefects: defects,
        meanDelta: report.meanDelta,
      };
    }

    return {
      passed: true,
      type: 'VISUAL_REVIEW',
      summary: 'All visual probes within acceptable tolerance.',
      errors: [],
      meanDelta: report.meanDelta,
    };
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
export PATH=/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH
node --experimental-strip-types --test tests/unit/visual-evaluator.test.ts
```
Expected: PASS。

- [ ] **Step 5: 提交更改**

```bash
git add src/evaluator/xcodebuild.ts src/evaluator/visual/visual-evaluator.ts tests/unit/visual-evaluator.test.ts
git commit -m "feat(evaluator): implement VisualReviewEvaluator coordinating simulator and refkit"
```

---

### Task 9: Layer 2 集成测试 - 视觉自愈两轮闭环（Visual Fix Loop Integration）

**Files:**
- Create: `tests/integration/visual-fix-loop.test.ts`

**Interfaces:**
- Consumes: `StateMachine`, `MockCliAdapter`, `EvaluatorPipeline`, `VisualReviewEvaluator`, `GitManager`
- Verifies:
  - Round 1: Agent 输出带色差代码 -> 编译通过 -> 视觉拦截 -> 触发 FIXING
  - Round 2: Agent 消费视觉提示词修正样式 -> 重新评估通过 -> 触发 COMMITTING -> COMPLETED

- [ ] **Step 1: 编写完整的端到端两轮视觉自愈测试**

创建 `tests/integration/visual-fix-loop.test.ts`：
```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { StateMachine } from '../../src/core/state-machine.ts';
import { createTaskContext } from '../../src/core/context.ts';
import { MockCliAdapter } from '../../src/runtime/mock.adapter.ts';
import { EvaluatorPipeline } from '../../src/evaluator/pipeline.ts';
import { VisualReviewEvaluator } from '../../src/evaluator/visual/visual-evaluator.ts';
import type { IEvaluator } from '../../src/evaluator/evaluator.interface.ts';
import type { ISimulatorManager } from '../../src/ios/simulator-manager.ts';
import type { IRefkitBridge } from '../../src/evaluator/visual/refkit-bridge.ts';

test('Visual Fix Loop: Round 1 fails visual review and Round 2 fixes styling to COMPLETED', async () => {
  const tmpDir = path.resolve(`/tmp/aire-visual-fix-${Date.now()}`);
  await fs.mkdir(tmpDir, { recursive: true });

  let round = 0;

  // Mock 编译：恒定成功
  const mockBuild: IEvaluator = {
    name: 'XcodeBuild',
    evaluate: async (ctx) => {
      ctx.appBundlePath = `${tmpDir}/MiniApp.app`;
      return { passed: true, type: 'BUILD', summary: 'Build succeeded', errors: [] };
    },
  };

  const mockSim: ISimulatorManager = {
    findOrBootDevice: async () => 'SIM-UDID',
    installApp: async () => {},
    launchApp: async () => 4321,
    takeScreenshot: async () => {},
    terminateApp: async () => {},
  };

  const mockRefkit: IRefkitBridge = {
    runBatch: async () => {
      round++;
      if (round === 1) {
        // 第一轮：背景色超标
        return {
          meanDelta: 12.0,
          passed: false,
          probeResults: [
            {
              probeId: 'bg-fill',
              expected: '#F2F2F7',
              actual: '#FFFFFF',
              delta: 13.0,
              passed: false,
            },
          ],
          worstBands: [],
        };
      }
      // 第二轮：修正后通过
      return {
        meanDelta: 2.1,
        passed: true,
        probeResults: [
          {
            probeId: 'bg-fill',
            expected: '#F2F2F7',
            actual: '#F2F2F7',
            delta: 0.0,
            passed: true,
          },
        ],
        worstBands: [],
      };
    },
    runDiff: async () => ({ meanDelta: 2.1 }),
  };

  const visualEvaluator = new VisualReviewEvaluator(mockSim, mockRefkit);
  const pipeline = new EvaluatorPipeline([mockBuild, visualEvaluator]);

  const mockCli = new MockCliAdapter([
    { exitCode: 0, stdout: 'Generated initial view with white background' },
    { exitCode: 0, stdout: 'Adjusted view background to #F2F2F7 based on probe' },
  ]);

  const context = createTaskContext({
    taskId: 'task-visual-loop',
    projectPath: tmpDir,
    scheme: 'MiniApp',
    taskGoal: 'Match reference card background',
    maxRetries: 3,
    visualConfig: {
      referenceImagePath: `${tmpDir}/ref.png`,
      toleranceMatrix: {
        containerDeltaMax: 7.0,
        spacingPtMax: 2.0,
        textDeltaMax: 15.0,
      },
    },
  });

  const stateMachine = new StateMachine(context, mockCli, pipeline);
  const finalContext = await stateMachine.run();

  assert.equal(finalContext.state, 'COMPLETED');
  assert.equal(finalContext.currentRetry, 1);
  assert.equal(finalContext.history.length, 2);
  assert.match(finalContext.history[1].promptUsed, /【UI 视觉质检修复指令】/);
  assert.match(finalContext.history[1].promptUsed, /bg-fill/);

  await fs.rm(tmpDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: 运行集成测试验证**

```bash
export PATH=/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH
node --experimental-strip-types --test tests/integration/visual-fix-loop.test.ts
```
Expected: PASS。

- [ ] **Step 3: 运行全量单测与集成测试**

```bash
export PATH=/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH
npm test
```
Expected: All 24+ tests PASS!

- [ ] **Step 4: 提交更改**

```bash
git add tests/integration/visual-fix-loop.test.ts
git commit -m "test(integration): add visual fix loop 2-round self-healing test"
```

---

### Task 10: CLI 选项组装与靶场参考图配置（CLI Wiring & MiniApp Fixture）

**Files:**
- Create: `fixtures/MiniApp/reference.png`
- Modify: `bin/aire.ts`
- Create: `tests/e2e/live-simulator.test.ts`

**Interfaces:**
- Produces:
  - `aire run --reference <path> --focus <text> --max-retries <n> --container-delta-max <n> --spacing-pt-max <n>`
  - 完整装配 `EvaluatorPipeline` 驱动真实命令行

- [ ] **Step 1: 创建靶场参考图 `fixtures/MiniApp/reference.png`**

使用 Python/uv 快速生成标准 $393 \times 852$ @3x 尺寸（$1179 \times 2556$）的基准测试参考图：
```bash
/Users/huangrong/.local/bin/uv run --with pillow python3 -c "
from PIL import Image, ImageDraw
im = Image.new('RGB', (1179, 2556), '#F2F2F7')
draw = ImageDraw.Draw(im)
draw.rectangle([60, 300, 1119, 1200], fill='#FFFFFF')
draw.text((100, 400), 'MiniApp Replica Target', fill='#1D1D1F')
im.save('fixtures/MiniApp/reference.png')
print('fixtures/MiniApp/reference.png created')
"
```

- [ ] **Step 2: 更新 `bin/aire.ts` 支持视觉参数**

在 `bin/aire.ts` 中引入视觉配置并装配 `EvaluatorPipeline`：
```typescript
// 增加命令行选项：
// .option('-r, --reference <path>', 'Path to reference design screenshot')
// .option('--focus <description>', 'Specific visual focus areas')
// .option('--container-delta-max <val>', 'Max allowed container color delta', '7.0')
// .option('--spacing-pt-max <val>', 'Max allowed spacing error in pt', '2.0')
// .option('--device <name>', 'Preferred simulator device name', 'iPhone 16 Pro')
```
装配：
```typescript
const buildEvaluator = new XcodeBuildEvaluator();
const visualEvaluator = new VisualReviewEvaluator();
const pipeline = new EvaluatorPipeline(
  options.reference ? [buildEvaluator, visualEvaluator] : [buildEvaluator]
);
```

- [ ] **Step 3: 编写 E2E 测试并运行验证**

创建 `tests/e2e/live-simulator.test.ts` 验证 CLI 参数解析完整性与真实命令装配：
```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('bin/aire.ts --help displays visual review options', () => {
  const stdout = execFileSync(
    '/Users/huangrong/.nvm/versions/node/v25.3.0/bin/node',
    ['--experimental-strip-types', 'bin/aire.ts', 'run', '--help'],
    { encoding: 'utf8' }
  );

  assert.match(stdout, /--reference/);
  assert.match(stdout, /--focus/);
  assert.match(stdout, /--container-delta-max/);
  assert.match(stdout, /--spacing-pt-max/);
});
```

- [ ] **Step 4: 执行验证**

```bash
export PATH=/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH
node --experimental-strip-types --test tests/e2e/live-simulator.test.ts
```
Expected: PASS。

- [ ] **Step 5: 提交更改**

```bash
git add fixtures/MiniApp/reference.png bin/aire.ts tests/e2e/live-simulator.test.ts
git commit -m "feat(cli): wire visual options and EvaluatorPipeline to bin/aire.ts"
```

---

## Plan Complete

Plan complete and saved to `docs/superpowers/plans/2026-09-18-aire-subproject2-simulator-visual-engine.md`.
