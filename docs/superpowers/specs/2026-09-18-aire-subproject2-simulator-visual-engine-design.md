# AIRE Sub-project 2: iOS 模拟器自动化与视觉质检引擎（Simulator & Visual QA Engine）设计规范

- **文档状态**：Validated Design Spec
- **编写日期**：2026-09-18
- **所属项目**：AI iOS App Replica Engine (AIRE)
- **阶段定位**：Phase 2 / Sub-project 2（真机模拟器运行、像素级视觉质检与量化自愈闭环）
- **参考基准**：[`docs/reference-project/super-prototyping`](../../reference-project/super-prototyping) 与 [`docs/ui-verification-rules.md`](../../ui-verification-rules.md)

---

## 1. 目标与范围（Goals & Scope）

### 1.1 背景与目标
在 Sub-project 1（Walking Skeleton）中，AIRE 成功实现了单任务「编码 → 构建 → 编译报错清洗 → 自动修复 → 安全提交」的闭环。然而，仅靠静态编译成功（`xcodebuild PASS`）无法保障界面真实渲染效果。

根据 AIRE 的核心使命与 `ui-verification-rules.md` 规范：
> **“可辩护的复刻（Defensible Replica）：无探针即流言（A defect without a probe is a rumour）。”**

Sub-project 2 的核心目标：
在现有架构上纵向打通 **「iOS 模拟器自动化启动/安装/运行 → 原生截屏 → 尺度与色彩校准 → 内部算法探针自动合成 → Refkit 像素级度量 → 量化容差判定 → 视觉缺陷自愈修复」** 完整闭环，让 AI 真正具备“在真实模拟器中看见界面、基于定量探针发现 UI 偏差并自主修复 SwiftUI 代码”的核心工程能力。

### 1.2 非目标（Non-goals）
- 本阶段**不实现**复杂的多步骤连续手势导航与跨页面链路交互（系统底层已通过驱动接口预留扩展点，规划至下一阶段）。
- 本阶段**不强求**用户手动编写复杂的 `probes.json`，用户仅需提供参考截图与目标说明，内部全自动合成测量探针。
- 本阶段**不引入**外部重量级测试编排平台，完全利用 macOS 原生 `xcrun simctl` 与轻量 Python `refkit` 算法内核。

### 1.3 验收条件（Acceptance Criteria）
1. **CLI 参数与配置全面可配**：
   - 支持传入参考图：`--reference <path>`；
   - 支持传入关注重点：`--focus <description>`（可选）；
   - 支持配置重试上限：`--max-retries <n>`（默认 3 次）；
   - 支持配置容差指标：`--container-delta-max <val>`（默认 7.0）、`--spacing-pt-max <val>`（默认 2.0pt）；
   - 支持配置目标设备：`--device <name>`（默认 iPhone 16 Pro 或当前已启动设备）。
2. **模拟器自动化驱动（`SimulatorManager`）**：
   - 自动检测并复用已处于 `Booted` 状态的 iOS 模拟器，若无则自动安全 `boot` 目标设备；
   - 自动将 `xcodebuild` 产出的 `.app` bundle 安装到模拟器并拉起进程；
   - 自动截取模拟器屏幕并保存为干净的 PNG 产物。
3. **高精度探针度量（`RefkitBridge` & `AutoProbeGenerator`）**：
   - 自动计算 capture px 与 SwiftUI pt 的缩放比例（`@3x -> pt`），校准偏差 $< 1\%$；
   - 自动统一转换至 sRGB 色彩空间，消除伪色差；
   - 内部自动提取基础平铺底色（Flat Fills）、文字墨水核（Ink Core）、边距扫描（Scan）与差异色带（Worst Bands）探针；
   - 通过 `uv run tools/refkit.py batch` 驱动毫秒级测量，输出量化 Delta。
4. **视觉自愈与安全回滚**：
   - 当视觉探针超标时，自动将带具体坐标、期望值、实际值与 Delta 的缺陷清单注入 `FixPrompt` 回传给 AI Coding Agent；
   - 修复后重新触发构建、重新截屏与重新评估，直至满足容差矩阵；若重试超限，执行 Git 原子回滚。
5. **三层测试金字塔完备**：
   - 单元测试（模拟器输出解析、探针生成、提示词格式化）；
   - 集成测试（基于 Mock 模拟器截屏的 2 轮视觉自愈闭环）；
   - 端到端测试（基于真实 `xcrun simctl` 与 `fixtures/MiniApp` 的实跑验证）。

---

## 2. 总体架构与模块划分（Architecture）

系统采用 **责任链评估管道（EvaluatorPipeline）** 模式，实现基础设施的彻底解耦。

### 2.1 架构流水线拓扑
```text
                  ┌────────────────────────┐
                  │      StateMachine      │
                  └───────────┬────────────┘
                              │ triggers evaluate(context)
                              ▼
                  ┌────────────────────────┐
                  │   EvaluatorPipeline    │
                  └───────────┬────────────┘
                              │
              ┌───────────────┴───────────────┐
              │ 1. Short-circuit if failed    │ 2. Trigger on build passed
              ▼                               ▼
     ┌─────────────────┐           ┌──────────────────────┐
     │ XcodeBuild      │           │ VisualReview         │
     │ Evaluator       │           │ Evaluator            │
     └─────────────────┘           └──────────┬───────────┘
                                              │ coordinates
                              ┌───────────────┴───────────────┐
                              ▼                               ▼
                     ┌──────────────────┐           ┌──────────────────┐
                     │ SimulatorManager │           │   RefkitBridge   │
                     │  (xcrun simctl)  │           │   (uv / python)  │
                     └──────────────────┘           └─────────┬────────┘
                                                              │ generates
                                                              ▼
                                                    ┌──────────────────┐
                                                    │ AutoProbeGen     │
                                                    └──────────────────┘
```

### 2.2 目录与文件职责划分

```text
aire/
├── bin/
│   └── aire.ts                           # CLI 入口：新增 --reference, --focus, --max-retries 等参数
├── src/
│   ├── core/
│   │   ├── types.ts                      # 扩充 VisualDefect、EvaluationResult (支持 VISUAL_REVIEW)
│   │   ├── context.ts                    # 扩充 TaskContext 视觉字段与容差矩阵配置
│   │   ├── prompt-builder.ts             # 扩展支持视觉量化缺陷提示词组装
│   │   └── state-machine.ts              # 有限状态机（消费统一定量结果，无需感知底层是编译还是视觉）
│   ├── evaluator/
│   │   ├── evaluator.interface.ts        # IEvaluator 统一抽象接口
│   │   ├── pipeline.ts                   # [NEW] EvaluatorPipeline 责任链执行器与短路控制
│   │   ├── xcodebuild.ts                 # 现有编译评估器，补充产出 .app Bundle 路径
│   │   ├── swift-error-parser.ts         # 现有 Swift 编译错误提取器
│   │   └── visual/                       # [NEW] 视觉质检子包
│   │       ├── visual-evaluator.ts       # VisualReviewEvaluator：调度截屏与度量比对
│   │       ├── auto-probe-generator.ts   # 确定性算法探针合成器
│   │       └── refkit-bridge.ts          # uv run tools/refkit.py 子进程桥接器
│   ├── ios/                              # [NEW] iOS 设施驱动抽象层
│   │   ├── simulator-manager.ts          # xcrun simctl 封装（boot, install, launch, screenshot, terminate）
│   │   └── types.ts                      # 设备状态、命令响应类型
│   ├── runtime/                          # ICliAdapter 体系（Codex, Antigravity, Cursor, Mock）
│   └── vcs/                              # GitManager 安全提交与原子回滚
├── tools/
│   └── refkit.py                         # 测量算法内核（纯色平铺、墨水核、发丝求解、探针批处理）
├── fixtures/
│   └── MiniApp/                          # 内置靶场工程，补充基准参考图
└── tests/
    ├── unit/                             # Pipeline、SimulatorManager、RefkitBridge 单元测试
    ├── integration/                      # visual-fix-loop 视觉自愈流转集成测试
    └── e2e/                              # live-simulator 真实模拟器端到端验证
```

---

## 3. 数据契约与核心接口（Data Models & Interfaces）

### 3.1 视觉缺陷与评估结果（`src/core/types.ts`）

```typescript
export interface VisualDefect {
  id: string;                                 // 探针 ID，如 'bg-fill', 'card-inset', 'title-ink'
  severity: 'critical' | 'high' | 'medium';   // 严重度：结构错位=critical，色差/边距超标=high
  category: 'color' | 'spacing' | 'size' | 'layout';
  element: string;                            // 元素语义描述
  probeBox: [number, number, number, number]; // [x0, y0, x1, y1] 测量区域 (pt)
  expected: string | number;                  // 预期参考值 (如 "#F2F2F7" 或 53.4)
  actual: string | number;                    // 实际测量值 (如 "#FFFFFF" 或 44.0)
  delta: number;                              // 绝对偏差 (色差 Levels 或 间距 pt 差)
  tolerance: number;                          // 设定的允许容差
  claim: string;                              // 事实性描述，如 "Card inset is 24pt, exceeding ref 16pt by 8pt"
}

export interface EvaluationResult {
  passed: boolean;
  type: 'BUILD' | 'FUNCTIONAL' | 'VISUAL_REVIEW';
  summary: string;
  errors: BuildError[];                       // 编译错误
  visualDefects?: VisualDefect[];             // 视觉缺陷列表
  meanDelta?: number;                         // 全屏平均绝对色彩偏差 (Mean Absolute Delta)
}
```

### 3.2 任务上下文与可配容差（`src/core/context.ts`）

```typescript
export interface VisualToleranceMatrix {
  containerDeltaMax: number;                  // 原生容器/色块平均色差上限（默认 7.0）
  spacingPtMax: number;                       // 边距与尺寸几何偏差上限（默认 2.0 pt）
  textDeltaMax: number;                       // 文字墨水核容差上限（默认 15.0）
}

export interface VisualReplicaConfig {
  referenceImagePath: string;                 // 参考基准截图
  focusAreas?: string;                        // 用户指定的复刻/对比重点说明
  toleranceMatrix: VisualToleranceMatrix;     // 可配容差矩阵
  preferredDevice?: string;                   // 目标模拟器设备名（默认 'iPhone 16 Pro'）
}

export interface TaskContext {
  taskId: string;
  projectPath: string;
  scheme: string;
  taskGoal: string;
  maxRetries: number;
  currentRetry: number;
  state: TaskState;
  // 视觉复刻扩展
  visualConfig?: VisualReplicaConfig;
  appBundlePath?: string;
  bundleId?: string;
  capturedScreenshotPath?: string;
  generatedProbesPath?: string;
}
```

### 3.3 模拟器驱动接口（`src/ios/simulator-manager.ts`）

```typescript
export interface ISimulatorManager {
  findOrBootDevice(preferredName?: string): Promise<string>; // 返回 UDID
  installApp(udid: string, appBundlePath: string): Promise<void>;
  launchApp(udid: string, bundleId: string): Promise<number>; // 返回 PID
  takeScreenshot(udid: string, outputPath: string): Promise<void>;
  terminateApp(udid: string, bundleId: string): Promise<void>;
  
  // 预留交互测试扩展点（未来即插即用）
  sendInput?(udid: string, action: string, params: Record<string, any>): Promise<void>;
}
```

### 3.4 Refkit 算法内核桥接（`src/evaluator/visual/refkit-bridge.ts`）

```typescript
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

export interface IRefkitBridge {
  runBatch(probesJsonPath: string, againstDir: string, scale: number): Promise<RefkitBatchReport>;
  runDiff(mineImage: string, refImage: string): Promise<{ meanDelta: number }>;
}
```

---

## 4. 探针自动生成与度量流程（Auto-Probes & Refkit Execution Flow）

### 4.1 尺度校准与色彩归一化
1. **尺度比求解**：  
   从目标设备（iPhone 16 Pro, $393 \times 852\text{ pt}$）与实际物理截图像素（$1179 \times 2556\text{ px}$）中计算 $\text{scale} = 3.0$。  
   严格校验高宽比例误差 $< 1\%$，确保后续坐标以逻辑点（pt）对齐。
2. **色彩空间转换**：  
   `refkit` 打开图像时将未标记的 Display P3 转换为标准 sRGB，避免伪色差。

### 4.2 内部算法探针合成（`AutoProbeGenerator`）
无需用户手动撰写坐标，系统基于确定性算法合成内部 `.aire/artifacts/probes.json`：
- **`bg-fill`**：取 $y \in [65, 100]\text{ pt}$，避开灵动岛和状态栏，以 `cmd: sample, only: flat` 提取纯底色；
- **`title-ink`**：通过 `bands` 墨斑投影定位顶部主标题的第一行墨水，以 `cmd: sample, only: ink, ink: 8` 提取最暗 8% 墨水核；
- **`card-inset`**：沿 $x \in [0, 40]\text{ pt}$ 进行色块边缘扫描，以 `cmd: scan, axis: row` 定位卡片水平外边距；
- **`worst-bands`**：结合初次截屏的像素差矩阵，提取前 2~3 个最大色差带生成监测探针。

### 4.3 容差矩阵判定
- 原生容器/色块平铺：$\Delta \le \text{containerDeltaMax}$（默认 7.0）；
- 几何布局与尺寸：$\text{Error} \le \text{spacingPtMax}$（默认 2.0 pt）；
- 字体替换区域：$\Delta \le \text{textDeltaMax}$（默认 15.0）；
- 全局平均偏差：$\text{Mean }\Delta \le \text{containerDeltaMax}$。

---

## 5. 视觉自愈与 Fix Loop 机制

### 5.1 结构化视觉自愈提示词模板（`FixPromptBuilder`）
当 `EvaluationResult.type === 'VISUAL_REVIEW'` 时，组装高聚焦提示词：

```markdown
【UI 视觉质检修复指令】
当前代码已成功构建并在 iOS 模拟器中启动，但经像素级探针定量测量，发现以下视觉偏差超出容差：

[量化缺陷清单（基于参考图测量探针）]
1. [背景色偏差] 探针 `bg-fill` (区域: [150, 62, 370, 108] pt)
   - 期望参考值: #F2F2F7
   - 实际渲染值: #FFFFFF (色差 Delta: 13.0, 容差上限: 7.0)
   - 事实说明: 容器背景色未应用，当前呈现为纯白底色。

2. [边距错位] 探针 `card-inset`
   - 期望参考边距: 16.0 pt
   - 实际渲染边距: 24.0 pt (偏差: +8.0 pt, 容差上限: 2.0 pt)
   - 事实说明: 卡片水平方向 padding 过大。

[修改指导与约束]
1. 仅修改负责上述界面的 SwiftUI 视图属性（如 .background(), .padding(.horizontal), .foregroundStyle()）。
2. 数值调整必须严格对齐上方测量目标，严禁凭空盲猜魔数。
3. 保持现有代码结构整洁，不得破坏编译语法与类型安全。
```

### 5.2 状态跃迁闭环与回滚保底
- 遵循铁律：**“A correction you have not re-rendered is not a correction”**。
- Agent 修改代码后，强制重新流经：
  `AGENT_CODING` → `BUILDING` → `EVALUATING`（重新启动模拟器并截屏复测）。
- 每次失败累计 `currentRetry++`。
- 若 `currentRetry >= maxRetries` 仍未通过，流转至 `ROLLING_BACK`，执行 `git reset --hard` 清空工作区代码，确保绝不残留半成品。

---

## 6. 测试金字塔与验证方案（Verification Strategy）

### 6.1 Layer 1: 单元测试套件
- `tests/unit/pipeline.test.ts`：验证 EvaluatorPipeline 短路逻辑（编译失败时拦截，绝不调用模拟器）；
- `tests/unit/simulator-manager.test.ts`：验证 `simctl` JSON 解析、设备查找与命令组装；
- `tests/unit/auto-probe-generator.test.ts`：验证对真实参考图片的底色识别与探针生成；
- `tests/unit/refkit-bridge.test.ts`：验证 `refkit batch` 输出解析与容差过滤；
- `tests/unit/prompt-builder.test.ts`：验证编译错误与视觉缺陷两种提示词模板的精确格式化。

### 6.2 Layer 2: 视觉自愈集成测试（`tests/integration/visual-fix-loop.test.ts`）
- 结合 `MockCliAdapter`，模拟两轮流转：
  - Round 1: Agent 输出带背景色偏差与错位内边距的代码，编译通过但视觉拦截，产出 2 个 `VisualDefect`；
  - Round 2: Agent 消费自愈提示词修正样式，二次截屏探针全部通过；
  - 终态: 自动提交 Git 并到达 `COMPLETED`。
- 脱离真机模拟器依赖，在 CI 2 秒内稳定完成验证。

### 6.3 Layer 3: 真实环境 E2E 测试（`tests/e2e/live-simulator.test.ts`）
- 在本地 macOS 真实环境，以 `fixtures/MiniApp` 为靶场，使用真实 `xcrun simctl` 和真实参考图，完整执行真实构建、真机模拟器启动、截屏与自愈提交。
