import type { BuildError } from '../core/types.ts';

const SWIFT_ERROR_REGEX = /^(?<file>.+\.swift):(?<line>\d+):(?<column>\d+):\s+error:\s+(?<message>.+)$/gm;

export function parseSwiftErrors(rawLog: string): BuildError[] {
  const errors: BuildError[] = [];
  const lines = rawLog.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    SWIFT_ERROR_REGEX.lastIndex = 0;
    const match = SWIFT_ERROR_REGEX.exec(line);
    if (match && match.groups) {
      // 尝试捕获代码片段上下文（如果有下一行）
      let snippet: string | undefined;
      if (i + 1 < lines.length && !lines[i + 1].includes(': error:')) {
        snippet = lines[i + 1].trim();
      }

      errors.push({
        file: match.groups.file,
        line: parseInt(match.groups.line, 10),
        column: parseInt(match.groups.column, 10),
        message: match.groups.message.trim(),
        rawSnippet: snippet
      });
    }
  }

  return errors;
}
