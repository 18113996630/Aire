# AIRE Sub-project 4: 上游智能分析与任务图自生成引擎（Upstream Multi-Agent Planner & Analysis IR）设计规范

- **文档状态**：Validated Design Spec
- **编写日期**：2026-09-19
- **所属项目**：AI iOS App Replica Engine (AIRE)
- **阶段定位**：Phase 4 / Sub-project 4（多模态输入解析、Analysis IR 机器事实源、累进水合多 Agent 分析、6 层确定性工程语义校验、任务图编译器与 Plan-to-Run CLI 闭环）
- **参考规范**：[`docs/tech.md`](../../tech.md)、[`AGENTS.md`](../../../AGENTS.md)、[`docs/ui-verification-rules.md`](../../ui-verification-rules.md)

---

## 1. 目标与范围（Goals & Scope）

### 1.1 背景与目标
在 Sub-project 1～3 中，AIRE 成功构建了下游可靠执行与自愈链：
- **Sub-project 1（Walking Skeleton）**：单任务「编码 → 编译报错清洗 → 自动修复 → Git 原子提交/回滚」；
- **Sub-project 2（Simulator & Visual QA）**：单任务「模拟器控制 → 探针生成 → Refkit 像素级度量 → 视觉缺陷量化自愈」；
- **Sub-project 3（Task Graph & DAG Orchestrator）**：多任务拓扑依赖调度、分支失败隔离与级联阻断、WAL 风格防漂移断点续跑与直接前置契约交接。

然而，执行引擎面临最核心的上游瓶颈：
> **我为什么要执行这些任务？这些任务从何而来？谁负责将杂乱的多模态竞品截图或 PRD 需求文档转化为确定性、高可靠的工程任务图？**

如果上游仅仅使用若干 LLM Agent 通过自然语言 Markdown 级联串联（Product Analyst → UI Analyst → Architect → Planner → YAML），必然面临严重的传话游戏效应：信息有损衰减、组件与文件边界幻觉漂移、缺乏物理证据支撑、无法进行确定性机器裁决。

**Sub-project 4 的核心目标**：
1. **统一中间表示层（`Analysis IR / Evidence Model`）**：定义强类型的机器事实源（JSON），将人类可读文档（`docs/*.md`）作为只读投影，实现类比 LLVM 的 Frontend / IR / Backend 解耦；
2. **多 Agent 累进水合（Progressive Hydration）**：通过确定性代码采集物理证据（像素尺寸、直方图、OCR、PRD AST），再由 Product Analyst、UI Analyst、Architect 依次对 IR 的局部字段进行富化，严格践行 AGENTS.md 的 *“No evidence, no token”* 原则；
3. **6 层确定性工程语义校验器（Deterministic Graph Validator）**：LLM 负责生成，确定性代码负责裁决。对生成的任务图进行 Schema 结构、DAG 拓扑、文件边界排他性/因果连续性、非空防呆、验证可行性等严格审查；
4. **端到端一键贯通（Plan-to-Run Bridge）**：新增 `aire plan` 子命令，支持 `--reference`、`--prd`、`--output` 及 `--auto-run`，无缝对接下游 `SerialDagScheduler`。

### 1.2 非目标（Non-goals）
- 本阶段**不设计**过度庞大、包含数百个 CSS 渲染属性的通用 UI AST（AIRE 是 Task Planner，不是浏览器渲染引擎）；
- 本阶段**不引入**重量级图形界面（GUI）或网页端编辑器，保持纯 Node.js / CLI 高效嵌入式运行；
- 本阶段**不修改**已稳定运行且 100% 绿色通过的 Sub-project 1~3 调度与自愈内核。

---

## 2. 系统总体架构与数据流

```text
┌────────────────────────────────────────────────────────┐
│ Input Sources (/references/*.png, /requirements/prd.md)│
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ 1. Deterministic Evidence Collector                    │
│    (PNG Binary Header Parser, Markdown AST Extractor)  │
└───────────────────────────┬────────────────────────────┘
                            │ RawEvidence (Physical Bounds, ColorSpace)
                            ▼
┌────────────────────────────────────────────────────────┐
│ 2. Progressive Hydration Multi-Agent Pipeline          │
│    ├── ProductAnalyst: flows[], requirements[]         │
│    ├── UiAnalyst: screens[], tokens[], probes[]        │
│    └── Architect: entities[], architecture contract     │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ 3. Machine Single-Source-of-Truth: Analysis IR         │
│    (.aire/analysis-ir.json)                            │
│    └── Human Projections: docs/*.spec.md               │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ 4. TaskGraphCompiler                                   │
│    (Maps IR entities, viewmodels, views to TaskNodes)  │
└───────────────────────────┬────────────────────────────┘
                            │ TaskGraphConfig
                            ▼
┌────────────────────────────────────────────────────────┐
│ 5. Deterministic Graph Validator (6-Layer Validation)  │
│    - Schema, Cycles, File Boundary Disjointness,       │
│      Non-Empty Guards, Verification Feasibility        │
└───────────────────────────┬────────────────────────────┘
                            │ Pass
                            ▼
┌────────────────────────────────────────────────────────┐
│ 6. Serialized task-graph.yaml                          │
│    └── aire plan --auto-run → SerialDagScheduler       │
└────────────────────────────────────────────────────────┘
```

---

## 3. Analysis IR 契约规范与物理证据锚定

### 3.1 "No evidence, no token" 探针锚定
在 `VisualToken` 中，每个 Token 必须绑定其物理采样证据：
```typescript
export interface VisualToken {
  id: string;
  category: 'color' | 'typography' | 'spacing' | 'radius' | 'shadow';
  name: string;
  value: string | number;
  swiftValue: string;
  evidence: {
    sourceFile: string;
    probeBox?: [number, number, number, number]; // [x1, y1, x2, y2]
    samplingMethod: 'flat_fill' | 'ink_core' | 'hairline' | 'manual';
  };
}
```

### 3.2 6 层确定性工程语义校验矩阵
1. **Schema 结构校验**：`version`, `project.name`, `project.targetScheme`, `tasks` 必填；
2. **DAG 拓扑一致性**：无重复任务 ID，依赖 ID 全部合法存在，无有向环；
3. **文件边界防冲突与因果连续性**：
   - 严禁 `allowed_files: []`；
   - 若独立平行任务（无依赖路径）修改相同文件，立即报错阻断并发污染；
   - 若有依赖路径，则允许因果连续性修改；
4. **非空防呆**：`goal`、`role`、`acceptance_criteria` 严禁为空；
5. **验证可行性**：必须声明 `build`、`test` 或 `visual`；若声明 `visual` 必须提供 `reference` 图像路径；
6. **诊断报告**：输出结构化 `ValidationDiagnostic[]`（含 rule, taskId, severity, message）。
