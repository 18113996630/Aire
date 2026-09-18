# AIRE 参考开源项目索引与元数据规范

本目录用于存放 AIRE 在架构设计、Agent 编排、Visual QA、UI 复刻及开发执行过程中所**对标和参考的优秀开源项目**。

为避免将庞大的第三方仓库源码与历史提交直接混入 AIRE 的版本库，本目录下的所有子项目均被 `.gitignore` 忽略（`/docs/reference-project/*/`）。**本目录下的元数据文件（`manifest.json` 与 `README.md`）作为唯一的持久化记录源，保障跨开发环境、CI/CD 与不同团队成员能够准确追溯、理解并还原参考项目**。

---

## 1. 原则与红线

依据 [`AGENTS.md`](file:///Users/huangrong/Desktop/develop/tool/Aire/AGENTS.md) 的规定：
1. **不直接复制代码**：严禁直接拷贝参考项目的业务源码，仅学习其架构设计、接口规范、度量算法与工程思想。
2. **证据与规范优先**：参考项目的方法论需沉淀为 AIRE 的内部规范（如 [`docs/ui-verification-rules.md`](file:///Users/huangrong/Desktop/develop/tool/Aire/docs/ui-verification-rules.md)）。
3. **元数据同步**：每当引入新的参考项目，必须在此文件和 `manifest.json` 中登记其仓库 URL、本地目录与参考模块说明。

---

## 2. 参考项目总览

| 项目名称 | 类别 / 领域 | 仓库源地址 | 本地存储路径 | 核心参考价值 | 状态 |
|---|---|---|---|---|---|
| **super-prototyping** | Visual QA / UI 校验 | [GitHub 仓库](https://github.com/18113996630/super-prototyping.git) | `docs/reference-project/super-prototyping` | 像素级复刻方法论、`refkit` 度量算法体系、探针校验机制 | 已就绪 (Installed) |

---

## 3. 项目详细参考内容说明

### 3.1 super-prototyping

- **仓库地址**：`https://github.com/18113996630/super-prototyping.git`
- **本地相对路径**：`docs/reference-project/super-prototyping`
- **项目定位**：基于 tldraw 画布的像素级 UI 复刻工具箱与 Agent 工作流系统。
- **重点参考与借鉴内容**：
  1. **`tools/refkit.py` 定量度量工具链**：
     - `grid`：网格坐标叠加与可视化人工/Agent 双重校验；
     - `sample` / `flat fills`：四邻域纯色平铺点算法，滤除边缘抗锯齿噪点；
     - `ink core`：最暗百分位提取，精准获取文本字体颜色而非底色；
     - `bands` / `pitch`：垂直方向墨斑覆盖率分析，提取组件行高、间距节奏与基线；
     - `scan`：单行/单列像素扫描，毫厘级定位卡片与 Sheet 边缘；
     - `hairline`：细线发丝亏损逆向求解，精准还原亚像素边框；
     - `font`：在 SF Pro 等候选系统字库中按 cap height 进行字形比对匹配。
  2. **探针机制（Probe-based Verification）**：
     - 坚持“无探针即流言”（*"A defect without a probe is a rumour"*）；
     - 任何 UI 问题报告必须具备包围盒坐标 `[x1, y1, x2, y2]`、预期值、实际值和量化 Delta。
  3. **可辩护的复刻哲学（Defensible Replica）**：
     - 坚持“无证据无 Token”（*"No evidence, no token"*）；
     - 严禁靠肉眼猜测魔数，代码中所有尺寸与颜色均须具备测量证据。
  4. **Agent 协作分工**：
     - “Fan out the looking, not the editing”：审阅并行，修改单一收敛。

---

## 4. 跨环境恢复指南

在新的环境（或全新克隆的 AIRE 仓库）中，若需要恢复参考项目，可通过以下命令按需或全量恢复：

### 4.1 单个项目拉取
```bash
# 从项目根目录执行
git clone https://github.com/18113996630/super-prototyping.git docs/reference-project/super-prototyping
```

### 4.2 基于 manifest.json 自动恢复脚本 (Shell / Python)
在项目根目录运行以下 Python 片段，即可自动解析 `manifest.json` 并拉取所有未就绪的参考项目：

```bash
python3 -c '
import json, os, subprocess

manifest_path = "docs/reference-project/manifest.json"
if not os.path.exists(manifest_path):
    print("Manifest not found.")
    exit(1)

with open(manifest_path, "r", encoding="utf-8") as f:
    data = json.load(f)

for proj in data.get("projects", []):
    name = proj["name"]
    repo = proj["repository"]
    target_dir = proj["local_directory"]
    if os.path.exists(target_dir):
        print(f"[OK] {name} already exists at {target_dir}")
    else:
        print(f"[CLONING] {name} from {repo} into {target_dir}...")
        subprocess.run(["git", "clone", repo, target_dir], check=True)
'
```

---

## 5. 格式规范说明（新增参考项目时）

当未来引入新的开源参考项目时，请执行以下步骤：
1. 运行 `git clone <repo_url> docs/reference-project/<project-name>`；
2. 在 `docs/reference-project/manifest.json` 中的 `projects` 数组追加条目；
3. 更新本文件（`docs/reference-project/README.md`）中的总览表格与详细借鉴内容段落；
4. 提交 `manifest.json` 与 `README.md` 变更，切勿将子项目自身的内容提交到 AIRE 主仓库。
