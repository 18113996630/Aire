# AIRE Sub-project 4: 上游智能分析与任务图自生成引擎 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 AIRE 上游智能分析与任务图自生成引擎，打通从多模态原始输入（竞品切图 `/references/*.png` 与需求文档 `/requirements/prd.md`）到高可靠任务图（`task-graph.yaml`）的自动化桥梁。

**Architecture:** 引入 `Analysis IR / Evidence Model`（机器事实源）解耦输入与下游执行拓扑；采用确定性物理证据采集 + 多 Agent 累进水合（Progressive Hydration）杜绝 LLM 传话损耗；引入 6 层确定性工程语义校验器（`GraphValidator`）严格裁决任务边界与可行性，并提供 CLI 命令（`aire plan`）与 `--auto-run` 一键闭环。

**Tech Stack:** TypeScript (Node.js `--experimental-strip-types`), `yaml` npm 包, Node.js 原生 Buffer PNG 头解析, Git 原生 CLI.

**Spec:** [`docs/superpowers/specs/2026-09-19-aire-subproject4-upstream-planner-analysis-ir-design.md`](../specs/2026-09-19-aire-subproject4-upstream-planner-analysis-ir-design.md)

## Global Constraints

- **Node.js 执行环境**：使用 `node --experimental-strip-types` 原生运行 TypeScript，无需额外打包步骤。
- **环境 PATH**：所有 Node/npm 命令必须确保包含 `/Users/huangrong/.nvm/versions/node/v25.3.0/bin:$PATH`。
- **向后兼容性**：Sub-project 1、2、3 已有的全部 150 个单元与集成测试必须持续保持 100% 通过。
- **机器事实源**：以 `.aire/analysis-ir.json` 为唯一权威中间数据模型，`docs/*.md` 仅为人类可读导出投影。
- **物理证据锚定**：每个 VisualToken 必须具备采样来源 `evidence`（"No evidence, no token"）。
- **确定性语义校验**：任务图生成后必须通过 `GraphValidator` 的 6 层校验（Schema, 环检测, 文件并发防冲突, 因果连续性, 非空防呆, 验证可行性）。

---

## Completed Milestones

- [x] **Step 0: MiniApp Dogfooding Benchmark**
  - 实测已有 Sub-project 1~3 执行链在 `fixtures/MiniApp/task-graph.yaml` 上的真实执行表现；
  - 发现并修复调度器与适配器的调用摩擦点，确立下游真实胃口与 Prompt 契约基准。
- [x] **Step 1: Analysis IR & Evidence Model Schema (`src/analysis/types.ts`)**
  - 定义 `RawEvidence`, `VisualToken`, `ComponentSpec`, `ScreenSpec`, `ProductFlowSpec`, `RequirementSpec`, `DataEntitySpec`, `ArchitectureContract`, `AnalysisIR`。
- [x] **Step 2: Deterministic Evidence Collector (`src/analysis/evidence-collector.ts`)**
  - 实现零依赖 PNG 二进制解析（IHDR 宽高、sRGB/DisplayP3 色彩空间）；
  - 实现 Markdown PRD 标题与层级树提取。
- [x] **Step 3: Multi-Agent Analysis Pipeline (`src/analysis/`)**
  - 实现 `ProductAnalyst`, `UiAnalyst`, `Architect`, `AnalysisPipeline` 累进水合；
  - 导出机器事实源 `.aire/analysis-ir.json` 与人类规格投影 `docs/*.md`。
- [x] **Step 4: Deterministic Graph Validator (`src/planner/graph-validator.ts`)**
  - 实现 6 层强语义校验：Schema, DAG 拓扑, 文件重叠因果与并发防冲突, 非空防呆, 验证可行性。
- [x] **Step 5: TaskGraphCompiler & PlannerOrchestrator (`src/planner/`)**
  - 将 `AnalysisIR` 自动编译为分层 DAG，并通过 `GraphValidator` 校验。
- [x] **Step 6: CLI Integration & E2E Verification (`bin/aire.ts`, `tests/e2e/plan-to-run-e2e.test.ts`)**
  - 新增 `aire plan` 命令，支持 `--reference`, `--prd`, `--output`, `--auto-run`；
  - E2E 测试全绿通过。
