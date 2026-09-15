import * as path from 'node:path';

/**
 * Pure path helpers: `worktree.baseDirectory` variable expansion and directory
 * name sanitising. No I/O, no vscode imports.
 */

export interface RepoPaths {
  /** Absolute path of the repository root the command was invoked from. */
  readonly repoRoot: string;
}

const VARIABLE = /\$\{(repoRoot|repoParent|repoName)\}/g;

/**
 * Expands `${repoRoot}`, `${repoParent}` and `${repoName}` in a
 * `worktree.baseDirectory` value and returns an absolute path. A relative
 * result is resolved against the repository root.
 */
export function expandBaseDirectory(template: string, repo: RepoPaths): string {
  const repoRoot = path.normalize(repo.repoRoot);
  const values: Record<string, string> = {
    repoRoot,
    repoParent: path.dirname(repoRoot),
    repoName: path.basename(repoRoot)
  };
  const expanded = template.replace(VARIABLE, (_match, name: string) => values[name] ?? '');
  if (expanded === '') {
    return repoRoot;
  }
  return path.resolve(repoRoot, expanded);
}

/**
 * Turns a branch name into a directory name. `/` becomes `-` so
 * `feature/login` lands at `<base>/feature-login`; the branch keeps its name.
 */
export function sanitizeDirectoryName(branch: string): string {
  const replaced = branch
    .replace(/[/\\]/g, '-')
    .replace(/[\0:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^\.+/, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return replaced;
}

/** Absolute path a new worktree directory would get. */
export function worktreePath(baseDirectory: string, directoryName: string): string {
  return path.join(baseDirectory, directoryName);
}

/**
 * Tree item description: the path relative to the base directory when the
 * worktree lives inside it, the absolute path otherwise.
 */
export function describeWorktreePath(worktreeAbsPath: string, baseDirectory: string): string {
  const relative = path.relative(baseDirectory, worktreeAbsPath);
  if (relative === '') {
    return worktreeAbsPath;
  }
  const escapes = relative.startsWith('..') || path.isAbsolute(relative);
  return escapes ? worktreeAbsPath : relative;
}

/** True when `child` is `parent` or lives underneath it. */
export function isInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** Case-insensitive on macOS and Windows, exact elsewhere. */
export function samePath(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  if (process.platform === 'linux') {
    return left === right;
  }
  return left.toLowerCase() === right.toLowerCase();
}
