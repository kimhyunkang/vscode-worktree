import * as path from 'node:path';
import * as vscode from 'vscode';

import { GitCli } from './git';
import { WorktreeInfo } from './porcelain';
import { expandBaseDirectory, samePath } from './paths';

export const DEFAULT_BASE_DIRECTORY = '${repoParent}/${repoName}.worktrees';

/** A repository, identified by its git common dir so every worktree agrees. */
export interface Repository {
  /** Absolute `git rev-parse --git-common-dir`. */
  readonly commonDir: string;
  /** Absolute root of the worktree this window has open for the repository. */
  readonly currentRoot: string;
  /** Workspace folder the repository was discovered from. */
  readonly folder: vscode.WorkspaceFolder;
}

/** A worktree plus the facts the tree needs that git output does not carry. */
export interface WorktreeNode {
  readonly info: WorktreeInfo;
  readonly repo: Repository;
  /** First stanza of `git worktree list` is the main worktree. */
  readonly isMain: boolean;
  /** The worktree this window has open. */
  readonly isCurrent: boolean;
}

export type ModelState = 'noFolder' | 'noRepository' | 'noGit' | 'ready';

/** What every command needs: the git binary wrapper and the cached model. */
export interface CommandContext {
  readonly git: GitCli;
  readonly model: WorktreeModel;
}

const DEBOUNCE_MS = 250;
const MIN_GIT_VERSION: readonly [number, number] = [2, 7];

export class WorktreeModel implements vscode.Disposable {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange: vscode.Event<void> = this.onDidChangeEmitter.event;

  private readonly disposables: vscode.Disposable[] = [];
  private watchers: vscode.FileSystemWatcher[] = [];
  /** Repositories the current watchers cover, so a refresh does not rewire them. */
  private watchedRepositories = '';
  private repositories: Repository[] = [];
  private worktrees: WorktreeNode[] = [];
  private state: ModelState = 'noFolder';
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshing: Promise<void> | undefined;
  private pending = false;

  constructor(private readonly git: GitCli) {
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refresh()),
      vscode.window.onDidChangeWindowState((windowState) => {
        if (windowState.focused) {
          this.scheduleRefresh();
        }
      })
    );
  }

  getState(): ModelState {
    return this.state;
  }

  getWorktrees(): readonly WorktreeNode[] {
    return this.worktrees;
  }

  getRepositories(): readonly Repository[] {
    return this.repositories;
  }

  /** The node for the worktree this window has open, when there is one. */
  getCurrent(): WorktreeNode | undefined {
    return this.worktrees.find((node) => node.isCurrent);
  }

  /** Repository owning a path, used when a command is given a folder. */
  repositoryFor(target: string): Repository | undefined {
    return this.repositories.find((repo) => samePath(repo.currentRoot, target));
  }

  /** Coalesces bursts of watcher events into one refresh. */
  scheduleRefresh(): void {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      void this.refresh();
    }, DEBOUNCE_MS);
  }

  /** Rediscovers repositories and reloads the cached worktree list. */
  async refresh(): Promise<void> {
    if (this.refreshing !== undefined) {
      this.pending = true;
      return this.refreshing;
    }
    this.refreshing = this.doRefresh();
    try {
      await this.refreshing;
    } finally {
      this.refreshing = undefined;
    }
    if (this.pending) {
      this.pending = false;
      await this.refresh();
    }
  }

  private async doRefresh(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      this.apply('noFolder', [], []);
      return;
    }
    const localFolder = folders.find((folder) => folder.uri.scheme === 'file');
    if (localFolder === undefined) {
      // Only virtual or remote folders: git cannot run against them.
      this.apply('noRepository', [], []);
      return;
    }
    if (!(await this.hasUsableGit(localFolder.uri.fsPath))) {
      this.apply('noGit', [], []);
      return;
    }

    const repositories = await this.discoverRepositories(folders);
    if (repositories.length === 0) {
      this.apply('noRepository', [], []);
      return;
    }

    const nodes: WorktreeNode[] = [];
    for (const repo of repositories) {
      let infos: WorktreeInfo[];
      try {
        infos = await this.git.listWorktrees(repo.currentRoot);
      } catch {
        continue;
      }
      infos.forEach((info, index) => {
        nodes.push({
          info,
          repo,
          isMain: index === 0,
          isCurrent: samePath(info.path, repo.currentRoot)
        });
      });
    }
    this.apply('ready', repositories, nodes);
  }

  private async hasUsableGit(cwd: string): Promise<boolean> {
    try {
      const output = await this.git.version(cwd);
      return isVersionAtLeast(output, MIN_GIT_VERSION);
    } catch {
      return false;
    }
  }

  private async discoverRepositories(
    folders: readonly vscode.WorkspaceFolder[]
  ): Promise<Repository[]> {
    const byCommonDir = new Map<string, Repository>();
    for (const folder of folders) {
      if (folder.uri.scheme !== 'file') {
        continue;
      }
      try {
        const cwd = folder.uri.fsPath;
        const commonDir = await this.git.commonDir(cwd);
        const currentRoot = await this.git.topLevel(cwd);
        const key = keyFor(commonDir);
        if (!byCommonDir.has(key)) {
          byCommonDir.set(key, { commonDir, currentRoot, folder });
        }
      } catch {
        // Folder is not inside a git repository.
        continue;
      }
    }
    return [...byCommonDir.values()];
  }

  private apply(state: ModelState, repositories: Repository[], worktrees: WorktreeNode[]): void {
    this.state = state;
    this.repositories = repositories;
    this.worktrees = worktrees;
    void vscode.commands.executeCommand('setContext', 'worktree.state', state);
    this.rewireWatchers();
    this.onDidChangeEmitter.fire();
  }

  /** One watcher per repository on `<commonDir>/worktrees/**`. */
  private rewireWatchers(): void {
    const wanted = this.repositories.map((repo) => keyFor(repo.commonDir)).join('\n');
    if (wanted === this.watchedRepositories) {
      return;
    }
    this.watchedRepositories = wanted;
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers = this.repositories.map((repo) => {
      const pattern = new vscode.RelativePattern(
        vscode.Uri.file(path.join(repo.commonDir, 'worktrees')),
        '**'
      );
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      watcher.onDidCreate(() => this.scheduleRefresh());
      watcher.onDidDelete(() => this.scheduleRefresh());
      watcher.onDidChange(() => this.scheduleRefresh());
      return watcher;
    });
  }

  dispose(): void {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
    }
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers = [];
    this.watchedRepositories = '';
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.onDidChangeEmitter.dispose();
  }
}

/**
 * The main worktree root of a repository. Variable expansion uses it rather
 * than the folder this window has open, so every window agrees on the base
 * directory even when it has a linked worktree open.
 */
export function mainRootOf(model: WorktreeModel, repo: Repository): string {
  // Compared by common dir, not by identity: a refresh in the background
  // replaces the Repository objects while a command is mid-flight.
  const main = model
    .getWorktrees()
    .find((node) => sameRepository(node.repo, repo) && node.isMain);
  return main?.info.path ?? repo.currentRoot;
}

/** True when two Repository values describe the same repository. */
export function sameRepository(a: Repository, b: Repository): boolean {
  return keyFor(a.commonDir) === keyFor(b.commonDir);
}

/** Expanded `worktree.baseDirectory` for a repository. */
export function baseDirectoryFor(model: WorktreeModel, repo: Repository): string {
  const template =
    vscode.workspace.getConfiguration('worktree').get<string>('baseDirectory') ??
    DEFAULT_BASE_DIRECTORY;
  return expandBaseDirectory(template, { repoRoot: mainRootOf(model, repo) });
}

function keyFor(commonDir: string): string {
  return process.platform === 'linux' ? commonDir : commonDir.toLowerCase();
}

/** `git version 2.39.3 (Apple Git-146)` -> compares 2.39 against the minimum. */
export function isVersionAtLeast(versionOutput: string, minimum: readonly [number, number]): boolean {
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(versionOutput);
  if (match === null) {
    return false;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major !== minimum[0]) {
    return major > minimum[0];
  }
  return minor >= minimum[1];
}
