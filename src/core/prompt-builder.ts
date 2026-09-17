import type { BuildError } from './types.ts';

export function buildFixPrompt(errors: BuildError[]): string {
  const errorList = errors
    .map((e, index) => `${index + 1}. 文件: ${e.file} (第 ${e.line} 行)\n   报错: ${e.message}${e.rawSnippet ? `\n   上下文: ${e.rawSnippet}` : ''}`)
    .join('\n\n');

  return `【自动修复任务】
你上一轮的代码修改导致 Xcode 编译失败。请根据以下具体的 Swift 编译器报错进行修复：

[错误清单]
${errorList}

[修复要求]
1. 仅修改与解决上述报错直接相关的代码文件。
2. 确保类型、函数签名和作用域引用正确，保持其他功能不受影响。
3. 请直接更新文件，完成后无需输出多余的客套文字。`;
}
