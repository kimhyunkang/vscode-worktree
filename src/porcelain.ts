/**
 * Pure parsers for git plumbing output. No I/O, no vscode imports, so this
 * module is directly unit testable with fixture strings.
 */

export interface WorktreeInfo {
  /** Absolute path of the worktree. */
  readonly path: string;
  /** HEAD sha, absent for a bare repository. */
  readonly head?: string;
  /** Full ref name, e.g. `refs/heads/main`. Absent when detached or bare. */
  readonly branch?: string;
  readonly detached: boolean;
  readonly bare: boolean;
  /** Present when the worktree is locked. Empty string when git gave no reason. */
  readonly locked?: string;
  /** Present when the worktree is prunable. Empty string when git gave no reason. */
  readonly prunable?: string;
}

/** `refs/heads/feature/x` -> `feature/x`, `refs/remotes/origin/x` -> `origin/x`. */
export function shortenRef(ref: string): string {
  if (ref.startsWith('refs/heads/')) {
    return ref.slice('refs/heads/'.length);
  }
  if (ref.startsWith('refs/remotes/')) {
    return ref.slice('refs/remotes/'.length);
  }
  if (ref.startsWith('refs/tags/')) {
    return ref.slice('refs/tags/'.length);
  }
  return ref;
}

/** Branch name of a worktree, short form, or undefined when detached or bare. */
export function worktreeBranch(worktree: WorktreeInfo): string | undefined {
  return worktree.branch === undefined ? undefined : shortenRef(worktree.branch);
}

interface Attribute {
  readonly key: string;
  readonly value: string;
}

function splitAttribute(record: string): Attribute {
  const space = record.indexOf(' ');
  if (space === -1) {
    return { key: record, value: '' };
  }
  return { key: record.slice(0, space), value: record.slice(space + 1) };
}

/**
 * Parses `git worktree list --porcelain -z`. Records are NUL terminated and an
 * empty record ends a stanza. Plain `--porcelain` output (newline terminated,
 * blank line between stanzas) parses too, so callers may pass either.
 */
export function parseWorktreeList(output: string): WorktreeInfo[] {
  const records = output.includes('\0') ? output.split('\0') : output.split('\n');
  const worktrees: WorktreeInfo[] = [];
  let current: Mutable | undefined;

  const flush = (): void => {
    if (current !== undefined) {
      worktrees.push(freeze(current));
      current = undefined;
    }
  };

  for (const raw of records) {
    const record = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (record === '') {
      flush();
      continue;
    }
    const { key, value } = splitAttribute(record);
    if (key === 'worktree') {
      flush();
      current = { path: value, detached: false, bare: false };
      continue;
    }
    if (current === undefined) {
      // Attribute before any `worktree` line: malformed, ignore it.
      continue;
    }
    applyAttribute(current, key, value);
  }
  flush();
  return worktrees;
}

interface Mutable {
  path: string;
  head?: string;
  branch?: string;
  detached: boolean;
  bare: boolean;
  locked?: string;
  prunable?: string;
}

function applyAttribute(target: Mutable, key: string, value: string): void {
  switch (key) {
    case 'HEAD':
      target.head = value;
      return;
    case 'branch':
      target.branch = value;
      return;
    case 'detached':
      target.detached = true;
      return;
    case 'bare':
      target.bare = true;
      return;
    case 'locked':
      target.locked = value;
      return;
    case 'prunable':
      target.prunable = value;
      return;
    default:
      return;
  }
}

function freeze(value: Mutable): WorktreeInfo {
  return { ...value };
}

export interface BranchRef {
  /** Full ref name. */
  readonly ref: string;
  /** Short name: `main`, `feature/x`, `origin/main`. */
  readonly name: string;
  readonly isRemote: boolean;
  readonly sha: string;
  readonly shortSha: string;
  /** Short upstream name, empty when the branch tracks nothing. */
  readonly upstream: string;
  /** First line of the commit message. */
  readonly subject: string;
}

/**
 * Field order the `--format` string must use. Fields are separated by NUL and
 * records by newline; git rejects newlines in ref names and `contents:subject`
 * is a single line, so newline is a safe record separator.
 */
export const FOR_EACH_REF_FORMAT =
  '%(refname)%00%(objectname)%00%(objectname:short)%00%(upstream:short)%00%(contents:subject)';

/** Parses output produced with {@link FOR_EACH_REF_FORMAT}. */
export function parseForEachRef(output: string): BranchRef[] {
  const refs: BranchRef[] = [];
  for (const rawLine of output.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line === '') {
      continue;
    }
    const fields = line.split('\0');
    const ref = fields[0];
    if (ref === undefined || ref === '') {
      continue;
    }
    refs.push({
      ref,
      name: shortenRef(ref),
      isRemote: ref.startsWith('refs/remotes/'),
      sha: fields[1] ?? '',
      shortSha: fields[2] ?? '',
      upstream: fields[3] ?? '',
      subject: fields[4] ?? ''
    });
  }
  return refs;
}
