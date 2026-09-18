import type { TaskNode, TaskResult } from './types.ts';

/**
 * Assembles a structured markdown prompt for a DAG task execution.
 * Mounts current task declarations, acceptance criteria, and direct predecessor contract indexing.
 *
 * @param task The TaskNode to be executed
 * @param directDependencyResults Results of direct dependencies (predecessors), if any
 * @returns Formatted markdown prompt string
 */
export function buildDagTaskPrompt(
  task: TaskNode,
  directDependencyResults: TaskResult[] = []
): string {
  const sections: string[] = [];

  // 1. Current Task Declaration
  const declarationLines: string[] = [
    '# 任务目标与上下文（Task Context）',
    '',
    '## 当前任务声明',
    `- **任务 ID**: \`${task.id}\``,
    `- **任务名称**: ${task.title}`,
    `- **执行角色**: ${task.role}`,
    `- **核心目标**: ${task.goal}`,
  ];

  if (task.non_goals && task.non_goals.length > 0) {
    declarationLines.push('- **非目标（Non-Goals）**:');
    for (const nonGoal of task.non_goals) {
      declarationLines.push(`  - ${nonGoal}`);
    }
  }

  declarationLines.push('- **允许修改的文件清单（Allowed Files）**:');
  if (task.allowed_files && task.allowed_files.length > 0) {
    for (const file of task.allowed_files) {
      declarationLines.push(`  - \`${file}\``);
    }
  } else {
    declarationLines.push('  - (无限制)');
  }

  sections.push(declarationLines.join('\n'));

  // 2. Acceptance Criteria
  const criteriaLines: string[] = [
    '## 验收条件（Acceptance Criteria）',
  ];
  if (task.acceptance_criteria && task.acceptance_criteria.length > 0) {
    task.acceptance_criteria.forEach((criterion, idx) => {
      criteriaLines.push(`${idx + 1}. ${criterion}`);
    });
  } else {
    criteriaLines.push('1. 完成核心目标并保证项目编译与测试通过。');
  }

  sections.push(criteriaLines.join('\n'));

  // 3. Direct Dependencies Section (only when non-empty)
  if (directDependencyResults && directDependencyResults.length > 0) {
    const depLines: string[] = [
      '## 前置直接依赖产物与契约（Direct Dependencies）',
      '> **核心准则**：Git 工作区代码是唯一的真实事实源。请参考上述变更文件直接查阅源码与模型定义。',
    ];

    for (const dep of directDependencyResults) {
      depLines.push('');
      depLines.push(`### 依赖任务: [${dep.taskId}] ${dep.title}`);
      depLines.push(`- **任务 ID**: \`${dep.taskId}\``);
      depLines.push(`- **核心目标**: ${dep.goal}`);
      depLines.push(`- **Commit Sha**: \`${dep.commit}\``);
      depLines.push(`- **成果摘要 (Summary)**: ${dep.summary}`);

      depLines.push('- **改动文件清单 (Changed Files)**:');
      if (dep.changedFiles && dep.changedFiles.length > 0) {
        for (const file of dep.changedFiles) {
          depLines.push(`  - \`${file}\``);
        }
      } else {
        depLines.push('  - (无改动文件)');
      }

      if (dep.apiContracts && dep.apiContracts.length > 0) {
        depLines.push('- **导出 API 契约 (API Contracts)**:');
        for (const contract of dep.apiContracts) {
          depLines.push(`  - \`${contract}\``);
        }
      }

      if (dep.artifacts && dep.artifacts.length > 0) {
        depLines.push('- **文档产物 (Artifacts)**:');
        for (const artifact of dep.artifacts) {
          depLines.push(`  - \`${artifact}\``);
        }
      }
    }

    sections.push(depLines.join('\n'));
  }

  return sections.join('\n\n') + '\n';
}
