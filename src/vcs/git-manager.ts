import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class DirtyWorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DirtyWorkspaceError';
  }
}

export class GitManager {
  private readonly repoPath: string;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
  }

  private async runGit(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, { cwd: this.repoPath });
    return stdout.trim();
  }

  async isClean(): Promise<boolean> {
    const status = await this.runGit(['status', '--porcelain']);
    return status.length === 0;
  }

  async assertClean(): Promise<void> {
    if (!(await this.isClean())) {
      throw new DirtyWorkspaceError(
        'Working directory is dirty. AIRE requires a clean git workspace to ensure atomic execution and rollback safety.'
      );
    }
  }

  async getHeadSha(): Promise<string> {
    return this.runGit(['rev-parse', 'HEAD']);
  }

  async createAndCheckoutBranch(branchName: string): Promise<void> {
    await this.runGit(['checkout', '-b', branchName]);
  }

  async commitChanges(message: string): Promise<string> {
    await this.runGit(['add', '-A']);
    await this.runGit(['commit', '-m', message]);
    return this.getHeadSha();
  }

  async hardReset(targetSha: string): Promise<void> {
    await this.runGit(['reset', '--hard', targetSha]);
    await this.runGit(['clean', '-fd']);
  }
}
