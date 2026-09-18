import type { TaskContext } from './context.ts';
import type { EvaluationResult, BuildError } from './types.ts';

export function buildFixPrompt(context: TaskContext, lastResult: EvaluationResult): string;
export function buildFixPrompt(errors: BuildError[]): string;
export function buildFixPrompt(
  contextOrErrors: TaskContext | BuildError[],
  maybeResult?: EvaluationResult
): string {
  let lastResult: EvaluationResult;

  if (maybeResult) {
    lastResult = maybeResult;
  } else if (Array.isArray(contextOrErrors)) {
    lastResult = {
      passed: false,
      type: 'BUILD',
      summary: 'Xcode build failed',
      errors: contextOrErrors,
    };
  } else {
    lastResult = {
      passed: false,
      type: 'BUILD',
      summary: 'Unknown error',
      errors: [],
    };
  }

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
