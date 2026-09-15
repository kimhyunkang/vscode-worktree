import { GitCli, GitError, GitResult } from '../git';
import { BranchRef, WorktreeInfo, parseWorktreeList } from '../porcelain';

export interface FakeGitOptions {
  /** Raw `git worktree list --porcelain` output the fake replies with. */
  readonly worktreeListOutput?: string;
  readonly branches?: readonly BranchRef[];
  /** Names `git check-ref-format --branch` should reject. */
  readonly invalidBranchNames?: readonly string[];
  readonly status?: string;
  readonly commonDir?: string;
  readonly topLevel?: string;
  readonly currentBranch?: string;
  /** Args prefix -> stderr the command fails with. */
  readonly failures?: ReadonlyArray<{ readonly match: string; readonly stderr: string }>;
}

/**
 * Hand-written GitCli double. It records every argument array so tests can
 * assert on the exact git command a flow produced.
 */
export class FakeGitCli implements GitCli {
  readonly calls: string[][] = [];

  constructor(private readonly options: FakeGitOptions = {}) {}

  private record(args: readonly string[]): void {
    this.calls.push([...args]);
  }

  private failureFor(args: readonly string[]): string | undefined {
    const joined = args.join(' ');
    return this.options.failures?.find((failure) => joined.includes(failure.match))?.stderr;
  }

  async run(args: readonly string[], _cwd: string): Promise<string> {
    this.record(args);
    const stderr = this.failureFor(args);
    if (stderr !== undefined) {
      throw new GitError(`git ${args.join(' ')} failed: ${stderr}`, args, 128, '', stderr);
    }
    return '';
  }

  async tryRun(args: readonly string[], _cwd: string): Promise<GitResult> {
    this.record(args);
    const stderr = this.failureFor(args);
    return stderr === undefined
      ? { exitCode: 0, stdout: '', stderr: '' }
      : { exitCode: 128, stdout: '', stderr };
  }

  async version(_cwd: string): Promise<string> {
    return 'git version 2.44.0';
  }

  async commonDir(_cwd: string): Promise<string> {
    return this.options.commonDir ?? '/repo/.git';
  }

  async topLevel(_cwd: string): Promise<string> {
    return this.options.topLevel ?? '/repo';
  }

  async currentBranch(_cwd: string): Promise<string | undefined> {
    return this.options.currentBranch;
  }

  async listWorktrees(_cwd: string): Promise<WorktreeInfo[]> {
    this.record(['worktree', 'list', '--porcelain', '-z']);
    return parseWorktreeList(this.options.worktreeListOutput ?? '');
  }

  async listBranches(_cwd: string): Promise<BranchRef[]> {
    this.record(['for-each-ref']);
    return [...(this.options.branches ?? [])];
  }

  async addWorktree(cwd: string, args: readonly string[]): Promise<void> {
    await this.run(args, cwd);
  }

  async removeWorktree(cwd: string, worktreePath: string, force: boolean): Promise<void> {
    const args = force
      ? ['worktree', 'remove', '--force', worktreePath]
      : ['worktree', 'remove', worktreePath];
    await this.run(args, cwd);
  }

  async prune(cwd: string): Promise<void> {
    await this.run(['worktree', 'prune'], cwd);
  }

  async deleteBranch(cwd: string, branch: string, force: boolean): Promise<void> {
    await this.run(['branch', force ? '-D' : '-d', branch], cwd);
  }

  async status(_cwd: string): Promise<string> {
    this.record(['status', '--porcelain']);
    return this.options.status ?? '';
  }

  async checkRefFormatBranch(_cwd: string, name: string): Promise<boolean> {
    this.record(['check-ref-format', '--branch', name]);
    return !(this.options.invalidBranchNames ?? []).includes(name);
  }
}
