import { execFile } from 'node:child_process';
import * as path from 'node:path';
import * as vscode from 'vscode';

import {
  BranchRef,
  FOR_EACH_REF_FORMAT,
  WorktreeInfo,
  parseForEachRef,
  parseWorktreeList
} from './porcelain';

export interface GitResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export class GitError extends Error {
  constructor(
    message: string,
    readonly args: readonly string[],
    readonly exitCode: number,
    readonly stdout: string,
    readonly stderr: string
  ) {
    super(message);
    this.name = 'GitError';
  }
}

/**
 * Every git call the extension makes. Commands take an explicit cwd because a
 * window may act on a worktree other than its own.
 */
export interface GitCli {
  /** Runs git and returns trimmed stdout. Throws {@link GitError} on failure. */
  run(args: readonly string[], cwd: string): Promise<string>;
  /** Runs git and reports the exit code instead of throwing. */
  tryRun(args: readonly string[], cwd: string): Promise<GitResult>;
  version(cwd: string): Promise<string>;
  commonDir(cwd: string): Promise<string>;
  topLevel(cwd: string): Promise<string>;
  currentBranch(cwd: string): Promise<string | undefined>;
  listWorktrees(cwd: string): Promise<WorktreeInfo[]>;
  listBranches(cwd: string): Promise<BranchRef[]>;
  addWorktree(cwd: string, args: readonly string[]): Promise<void>;
  removeWorktree(cwd: string, worktreePath: string, force: boolean): Promise<void>;
  prune(cwd: string): Promise<void>;
  deleteBranch(cwd: string, branch: string, force: boolean): Promise<void>;
  /** `git status --porcelain`, raw stdout. Empty means clean. */
  status(cwd: string): Promise<string>;
  /** True when `git check-ref-format --branch <name>` accepts the name. */
  checkRefFormatBranch(cwd: string, name: string): Promise<boolean>;
}

/** Reads the `git.path` setting shared with the built-in Git extension. */
export function configuredGitPath(): string {
  const configured = vscode.workspace.getConfiguration('git').get<string | string[]>('path');
  if (typeof configured === 'string' && configured.trim() !== '') {
    return configured;
  }
  if (Array.isArray(configured)) {
    const first = configured.find((entry) => typeof entry === 'string' && entry.trim() !== '');
    if (first !== undefined) {
      return first;
    }
  }
  return 'git';
}

const MAX_BUFFER = 32 * 1024 * 1024;

/** GitCli backed by execFile. Arguments are always an array, never a shell string. */
export class ExecGitCli implements GitCli {
  constructor(private readonly gitPath: () => string = configuredGitPath) {}

  async tryRun(args: readonly string[], cwd: string): Promise<GitResult> {
    const binary = this.gitPath();
    return new Promise<GitResult>((resolve, reject) => {
      execFile(
        binary,
        [...args],
        {
          cwd,
          maxBuffer: MAX_BUFFER,
          env: {
            ...process.env,
            // Stable, parseable git messages and no credential prompt that
            // would hang an extension host command.
            LC_ALL: 'C',
            GIT_TERMINAL_PROMPT: '0'
          }
        },
        (error, stdout, stderr) => {
          if (error === null) {
            resolve({ exitCode: 0, stdout, stderr });
            return;
          }
          const code = (error as NodeJS.ErrnoException & { code?: number | string }).code;
          if (typeof code === 'string') {
            // Spawn failure: git itself is missing or not executable.
            reject(new GitError(`${binary} ${args.join(' ')}: ${error.message}`, args, -1, stdout, stderr));
            return;
          }
          resolve({ exitCode: typeof code === 'number' ? code : 1, stdout, stderr });
        }
      );
    });
  }

  async run(args: readonly string[], cwd: string): Promise<string> {
    const result = await this.tryRun(args, cwd);
    if (result.exitCode !== 0) {
      throw new GitError(
        formatFailure(args, result),
        args,
        result.exitCode,
        result.stdout,
        result.stderr
      );
    }
    return result.stdout.trim();
  }

  async version(cwd: string): Promise<string> {
    return this.run(['--version'], cwd);
  }

  async commonDir(cwd: string): Promise<string> {
    const output = await this.run(['rev-parse', '--git-common-dir'], cwd);
    return path.resolve(cwd, output);
  }

  async topLevel(cwd: string): Promise<string> {
    return path.resolve(await this.run(['rev-parse', '--show-toplevel'], cwd));
  }

  async currentBranch(cwd: string): Promise<string | undefined> {
    const result = await this.tryRun(['symbolic-ref', '--short', 'HEAD'], cwd);
    if (result.exitCode !== 0) {
      return undefined;
    }
    const name = result.stdout.trim();
    return name === '' ? undefined : name;
  }

  async listWorktrees(cwd: string): Promise<WorktreeInfo[]> {
    const nulTerminated = await this.tryRun(['worktree', 'list', '--porcelain', '-z'], cwd);
    if (nulTerminated.exitCode === 0) {
      return parseWorktreeList(nulTerminated.stdout);
    }
    // git older than 2.36 has no -z for `worktree list`; the parser reads both.
    const lineTerminated = await this.run(['worktree', 'list', '--porcelain'], cwd);
    return parseWorktreeList(lineTerminated);
  }

  async listBranches(cwd: string): Promise<BranchRef[]> {
    const output = await this.run(
      ['for-each-ref', `--format=${FOR_EACH_REF_FORMAT}`, 'refs/heads', 'refs/remotes'],
      cwd
    );
    return parseForEachRef(output);
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

  async status(cwd: string): Promise<string> {
    return this.run(['status', '--porcelain'], cwd);
  }

  async checkRefFormatBranch(cwd: string, name: string): Promise<boolean> {
    const result = await this.tryRun(['check-ref-format', '--branch', name], cwd);
    return result.exitCode === 0;
  }
}

function formatFailure(args: readonly string[], result: GitResult): string {
  const details = result.stderr.trim() !== '' ? result.stderr.trim() : result.stdout.trim();
  const command = `git ${args.join(' ')}`;
  return details === ''
    ? `${command} failed with exit code ${result.exitCode}`
    : `${command} failed: ${details}`;
}

/** Message of an error from any source, for showErrorMessage. */
export function errorMessage(error: unknown): string {
  if (error instanceof GitError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
