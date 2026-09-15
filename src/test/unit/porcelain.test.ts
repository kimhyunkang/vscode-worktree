import { describe, expect, it } from 'vitest';

import {
  FOR_EACH_REF_FORMAT,
  parseForEachRef,
  parseWorktreeList,
  shortenRef,
  worktreeBranch
} from '../../porcelain';

/** Builds `--porcelain -z` output: every record NUL terminated, stanzas separated by an empty record. */
function nulTerminated(stanzas: readonly string[][]): string {
  return stanzas.map((records) => records.map((record) => `${record}\0`).join('')).join('\0');
}

describe('parseWorktreeList', () => {
  it('parses main, branch, detached, locked and prunable stanzas', () => {
    const output = nulTerminated([
      ['worktree /Users/me/project/skool-be', 'HEAD 3f2a9c1e0000000000000000000000000000abcd', 'branch refs/heads/main'],
      [
        'worktree /Users/me/project/skool-be.worktrees/fix-login',
        'HEAD 91b0d4f20000000000000000000000000000abcd',
        'branch refs/heads/fix-login',
        'locked reason text'
      ],
      [
        'worktree /Users/me/project/skool-be.worktrees/spike',
        'HEAD 77e1aa000000000000000000000000000000abcd',
        'detached',
        'prunable gitdir file points to non-existent location'
      ]
    ]);

    const worktrees = parseWorktreeList(output);

    expect(worktrees).toEqual([
      {
        path: '/Users/me/project/skool-be',
        head: '3f2a9c1e0000000000000000000000000000abcd',
        branch: 'refs/heads/main',
        detached: false,
        bare: false
      },
      {
        path: '/Users/me/project/skool-be.worktrees/fix-login',
        head: '91b0d4f20000000000000000000000000000abcd',
        branch: 'refs/heads/fix-login',
        detached: false,
        bare: false,
        locked: 'reason text'
      },
      {
        path: '/Users/me/project/skool-be.worktrees/spike',
        head: '77e1aa000000000000000000000000000000abcd',
        detached: true,
        bare: false,
        prunable: 'gitdir file points to non-existent location'
      }
    ]);
  });

  it('parses a bare main worktree', () => {
    const output = nulTerminated([
      ['worktree /Users/me/project/skool-be.git', 'bare'],
      ['worktree /Users/me/project/wt/main', 'HEAD abc0000000000000000000000000000000000000', 'branch refs/heads/main']
    ]);

    const worktrees = parseWorktreeList(output);

    expect(worktrees[0]).toEqual({ path: '/Users/me/project/skool-be.git', detached: false, bare: true });
    expect(worktrees[0]?.head).toBeUndefined();
    expect(worktrees).toHaveLength(2);
  });

  it('keeps paths that contain spaces and newlines intact', () => {
    const output = nulTerminated([
      ['worktree /Users/me/my projects/skool be', 'HEAD abc0000000000000000000000000000000000000', 'branch refs/heads/main'],
      ['worktree /Users/me/wt/odd\nname', 'HEAD def0000000000000000000000000000000000000', 'detached']
    ]);

    const worktrees = parseWorktreeList(output);

    expect(worktrees.map((worktree) => worktree.path)).toEqual([
      '/Users/me/my projects/skool be',
      '/Users/me/wt/odd\nname'
    ]);
  });

  it('records locked and prunable without a reason as an empty reason', () => {
    const output = nulTerminated([
      ['worktree /wt/a', 'HEAD abc0000000000000000000000000000000000000', 'branch refs/heads/a', 'locked'],
      ['worktree /wt/b', 'HEAD def0000000000000000000000000000000000000', 'detached', 'prunable']
    ]);

    const worktrees = parseWorktreeList(output);

    expect(worktrees[0]?.locked).toBe('');
    expect(worktrees[1]?.prunable).toBe('');
  });

  it('parses newline terminated output from git without -z support', () => {
    const output = [
      'worktree /Users/me/project/repo',
      'HEAD 1111111111111111111111111111111111111111',
      'branch refs/heads/main',
      '',
      'worktree /Users/me/project/repo.worktrees/feature-login',
      'HEAD 2222222222222222222222222222222222222222',
      'branch refs/heads/feature/login',
      '',
      ''
    ].join('\n');

    const worktrees = parseWorktreeList(output);

    expect(worktrees).toHaveLength(2);
    expect(worktreeBranch(worktrees[1]!)).toBe('feature/login');
  });

  it('returns nothing for empty output', () => {
    expect(parseWorktreeList('')).toEqual([]);
    expect(parseWorktreeList('\0')).toEqual([]);
  });

  it('ignores attributes that appear before any worktree line', () => {
    expect(parseWorktreeList(nulTerminated([['HEAD abc', 'worktree /wt/a']]))).toEqual([
      { path: '/wt/a', detached: false, bare: false }
    ]);
  });
});

describe('shortenRef', () => {
  it('strips the ref namespace', () => {
    expect(shortenRef('refs/heads/main')).toBe('main');
    expect(shortenRef('refs/heads/feature/login')).toBe('feature/login');
    expect(shortenRef('refs/remotes/origin/main')).toBe('origin/main');
    expect(shortenRef('refs/tags/v1')).toBe('v1');
    expect(shortenRef('HEAD')).toBe('HEAD');
  });
});

describe('parseForEachRef', () => {
  it('parses local and remote branches in the documented field order', () => {
    expect(FOR_EACH_REF_FORMAT.split('%00')).toHaveLength(5);
    const output = [
      ['refs/heads/main', 'aaaa111', 'aaaa111', '', 'initial commit'].join('\0'),
      ['refs/heads/feature/login', 'bbbb222', 'bbbb222', 'origin/feature/login', 'add login form'].join('\0'),
      ['refs/remotes/origin/main', 'aaaa111', 'aaaa111', '', 'initial commit'].join('\0'),
      ['refs/remotes/origin/HEAD', 'aaaa111', 'aaaa111', '', ''].join('\0'),
      ''
    ].join('\n');

    const refs = parseForEachRef(output);

    expect(refs).toHaveLength(4);
    expect(refs[0]).toEqual({
      ref: 'refs/heads/main',
      name: 'main',
      isRemote: false,
      sha: 'aaaa111',
      shortSha: 'aaaa111',
      upstream: '',
      subject: 'initial commit'
    });
    expect(refs[1]?.upstream).toBe('origin/feature/login');
    expect(refs[2]?.isRemote).toBe(true);
    expect(refs[3]?.name).toBe('origin/HEAD');
  });

  it('tolerates missing trailing fields', () => {
    const refs = parseForEachRef('refs/heads/wip\n');
    expect(refs[0]).toEqual({
      ref: 'refs/heads/wip',
      name: 'wip',
      isRemote: false,
      sha: '',
      shortSha: '',
      upstream: '',
      subject: ''
    });
  });
});
