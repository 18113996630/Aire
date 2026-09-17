import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export class GitManager {
  private readonly repoPath: string;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
  }

  private async runGit(cmd: string): Promise<string> {
    const { stdout } = await execAsync(`git ${cmd}`, { cwd: this.repoPath });
    return stdout.trim();
  }

  async isClean(): Promise<boolean> {
    const status = await this.runGit('status --porcelain');
    return status.length === 0;
  }

  async getHeadSha(): Promise<string> {
    return this.runGit('rev-parse HEAD');
  }

  async createAndCheckoutBranch(branchName: string): Promise<void> {
    await this.runGit(`checkout -b ${branchName}`);
  }

  async commitChanges(message: string): Promise<string> {
    await this.runGit('add -A');
    await this.runGit(`commit -m "${message.replace(/"/g, '\\"')}"`);
    return this.getHeadSha();
  }

  async hardReset(targetSha: string): Promise<void> {
    await this.runGit(`reset --hard ${targetSha}`);
    await this.runGit('clean -fd');
  }
}
