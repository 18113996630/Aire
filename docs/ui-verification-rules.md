# AIRE UI 对比校验与像素级复刻规范

> **参考基准项目**：[`docs/reference-project/super-prototyping`](file:///Users/huangrong/Desktop/develop/tool/Aire/docs/reference-project/super-prototyping)  
> **核心工具集**：`refkit.py`（网格、采样、墨水核、基线带、色彩扫描、发丝求解、字体比对、探针批处理）  
> **指导思想**：**Observe → Plan → Act → Verify → Fix**，以可量化的证据支撑界面还原。

---

## 1. 核心原则：可辩护的复刻（Defensible Replica）

1. **数值可溯源（Traceable Metrics）**：
   - 最终生成的 SwiftUI 代码中，每一个设计 Token（颜色 hex、间距 pt、字号 size、圆角 radius、元素宽高等）都必须追溯到对参考截图（Reference Capture）的定量测量证据（Evidence）。
   - **禁止主观凭空猜测**：“看起来差不多”是复刻质量失控的根源（*"Values that 'look about right' are how a replica quietly stops being one"*）。
   - **No evidence, no token**：没有测量探针与证据，就不能随意在代码中引入任意魔数。

2. **同屏并置与对齐直观比对（Direct Alignment）**：
   - 生成的 Simulator 实际截图（Actual/Mine）必须与参考基准（Reference）在相同比例、相同屏幕尺寸和圆角遮罩下并置对齐比对，达到“一眼可辨差异”的标准。

---

## 2. 图像前置预处理与尺度校准

在进行任何比对与采样之前，必须严格执行两项校准：

### 2.1 尺度校准（Scale Calibration）
- 计算设备物理截图像素（capture px）与 SwiftUI 逻辑点（pt）的缩放比例：
  $$\text{scale} = \frac{\text{screen\_width\_px}}{\text{device\_pt\_width}}$$
  例如在 iPhone 15/16 Pro（393 × 852 pt）的 `@3x` 截图下为 `1179 / 393 = 3.0`。
- 分别校验宽度与高度比例，两者的计算偏差必须 $< 1\%$。如果偏差超标，说明截图裁剪存在异常，必须重新规范裁剪再进行后续测量。

### 2.2 色彩空间统一（Color Space Normalization）
- iOS 真机/Simulator 截图经常包含未标记的 Display P3 广色域。
- 在采样比对前，必须统一转换至 **sRGB** 色彩空间，避免同一界面在不同批次截图中产生 5~10 levels 的伪色彩偏差。

---

## 3. 分层度量与证据采样策略（Hierarchical Sampling）

针对界面中不同类型的 UI 元素，借鉴 `super-prototyping` 的 `refkit` 算法体系，采用分层采样策略：

| 元素类型 | 采样方法 | 核心算法原理 | 采样目标 |
|---|---|---|---|
| **页面/卡片底色** | **Flat Fills（纯色平铺）** | 寻找与上下左右 4 邻域像素完全一致的区域，自动剔除边缘抗锯齿与渐变过渡 | 精确的容器填充 hex |
| **小标记/徽标/图标** | **Core Only Modes** | 针对无法形成大面积纯色的小元素，截取中心内核区域并提取直方图峰值 | 图标基准主色 |
| **文本内容** | **Ink Core（墨水核）** | 绝不能直接取众数（众数通常是背景底色），提取区域中最暗的前 2%~5% 像素 | 文字真实字色与对比度 |
| **边框与分割线** | **Hairline Deficit 求解** | 亚像素/1pt 细线经缩放后难以直接取色；通过邻近背景与墨量亏损（Ink Deficit）逆向求解 | 真实分割线色彩与粗细 |
| **行高与排版节奏** | **Bands（墨斑剖面）** | 统计垂直方向上的墨水覆盖率投影，自动计算波峰/波谷间距（Pitch） | 列表行高、间距节奏、基线位置 |
| **容器边缘与内边距** | **Scan（单行/单列扫描）** | 沿指定行或列扫描颜色突变点，定位色块切换的像素边界 | 真实 Card Inset、Sheet 顶点坐标 |
| **系统字体识别** | **Font Matching** | 在已知候选字库（SF Pro, New York 等）中按相同大写字高（Cap Height）比对字形轮廓 | 确定字体家族、字重与排版样式 |

---

## 4. 探针机制与量化容差（Probe-based Verification）

### 4.1 无探针即流言（"A defect without a probe is a rumour"）
任何 Visual Reviewer 或 QA Agent 报告视觉缺陷时，**必须提供可复现的结构化探针数据**，严禁使用“间距有点大”、“颜色好像不太对”等模糊主观描述。

每个缺陷项必须包含：
```json
{
  "id": "defect-001",
  "severity": "high",
  "category": "spacing",
  "element": "header_profile_card",
  "probe_box": [16, 120, 377, 180],
  "expected": { "top_inset": 16, "fill": "#F2F2F7" },
  "actual": { "top_inset": 24, "fill": "#FFFFFF" },
  "delta": { "spacing": 8, "delta_rgb": 13.0 },
  "claim": "Header card top inset is 24pt, exceeding reference 16pt by 8pt."
}
```

### 4.2 容差矩阵标准（Tolerance Matrix）

根据元素类型划分可接受的平均绝对偏差（Mean Absolute Delta）：

1. **系统原生 Chrome / 容器 / 结构控件**：
   - 平均绝对偏差控制在 **3 ~ 7** 之间即视为达到上线/验收标准。
   - 几何间距（Padding/Spacing）误差须 $\le 2\text{pt}$。
2. **纯文本与字体替换区域**：
   - 当遇到特定定制商业字体由系统标准字体替代时，文字区域的总体 Delta 允许在 **10 ~ 25** 之间。
   - **禁止为了强行降低文字区域的色差/像素差而扭曲已测量的精准几何布局**。
3. **结构性缺陷（Structural Defects）零容忍**：
   - 元素缺失、层次重叠遮挡、严重截断（Text Overflow/Clipping）、对齐错位等，属于最高优先级阻塞性问题，必须彻底修复。

---

## 5. Agent 协作与职责划分

借鉴 `super-prototyping` 经过大规模实践验证的分工原则：

> **"Fan out the looking, not the editing."（审阅并行发散，修改单一收敛）**

1. **Visual Reviewer（视觉审阅者）**：
   - 负责：截屏、比对、度量探针、输出量化 Delta 与缺陷列表。
   - **只看、只测、只报 Delta，绝不直接编写修复代码**。
   - 允许多个 Reviewer Agent 并发针对不同屏幕或不同流程进行独立校验。

2. **iOS Developer（开发者/修复者）**：
   - 负责：统一收敛所有缺陷清单，基于探针证据修改 SwiftUI 代码。
   - **单点写入**：保持代码修改的单一职责，避免多个 Agent 并发改动导致代码冲突与样式回滚。
   - 任何样式调整必须基于设计 Token 与测量数据，禁止硬编码未经测量的魔数。

---

## 6. Auto Fix Loop 验证闭环

任何 UI 修复任务必须遵循闭环铁律：

> **"A correction you have not re-rendered is not a correction."**  
> （任何未经重新在 Simulator 中渲染截屏并跑探针检验的修改，都不算完成修复。）

```text
       ┌────────────────────────┐
       │   Reference Capture    │
       └───────────┬────────────┘
                   ↓
         Scale & Color Calib
                   ↓
        Run Simulator & Shoot
                   ↓
         Visual QA (refkit diff)
                   │
           ┌───────┴───────┐
      Pass │               │ Delta Exceeded
           ↓               ↓
      [Completed]    Generate Fix Task with Probes
                           ↓
                     Developer Fix
                           ↓
                    Re-build & Re-shoot
                           ↓
                     (Loop Verify)
```

1. **触发 Simulator 真实截屏**；
2. **执行探针批处理比对**；
3. **判断 Delta 是否在允许容差矩阵内**；
4. **若超标，生成携带 Probe 坐标的 Fix Task**；
5. **Developer 执行精准代码微调**；
6. **再次构建、启动 Simulator 截屏验证，直到全部指标达标**。
