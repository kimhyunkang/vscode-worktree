import { describe, expect, it } from 'vitest';

import {
  BranchPickItem,
  CreateChoice,
  branchOfChoice,
  buildAddArgs,
  buildBranchItems,
  checkedOutBranches,
  freeTextItem,
  localNameOfRemote,
  validateBranchName,
  validateDirectoryName
} from '../../commands/create';
import { FakeGitCli } from '../fakes';
import { BranchRef, WorktreeInfo } from '../../porcelain';

function local(name: string, subject = ''): BranchRef {
  return {
    ref: `refs/heads/${name}`,
    name,
    isRemote: false,
    sha: 'a'.repeat(40),
    shortSha: 'aaaaaaa',
    upstream: '',
    subject
  };
}

function remote(name: string, subject = ''): BranchRef {
  return {
    ref: `refs/remotes/${name}`,
    name,
    isRemote: true,
    sha: 'b'.repeat(40),
    shortSha: 'bbbbbbb',
    upstream: '',
    subject
  };
}

function worktree(path: string, branch?: string): WorktreeInfo {
  return branch === undefined
    ? { path, head: 'c'.repeat(40), detached: true, bare: false }
    : { path, head: 'c'.repeat(40), branch: `refs/heads/${branch}`, detached: false, bare: false };
}

const BASE = '/Users/me/project/repo.worktrees';

describe('buildAddArgs', () => {
  it('adds an existing local branch without touching refs', () => {
    expect(buildAddArgs({ kind: 'localBranch', branch: 'fix-login' }, `${BASE}/fix-login`)).toEqual([
      'worktree',
      'add',
      `${BASE}/fix-login`,
      'fix-login'
    ]);
  });

  it('creates a new branch from HEAD', () => {
    expect(buildAddArgs({ kind: 'newBranch', branch: 'feature/login' }, `${BASE}/feature-login`)).toEqual([
      'worktree',
      'add',
      '-b',
      'feature/login',
      `${BASE}/feature-login`,
      'HEAD'
    ]);
  });

  it('tracks a remote branch with a local branch of the same name', () => {
    const choice: CreateChoice = {
      kind: 'remoteBranch',
      branch: 'feature/login',
      startPoint: 'origin/feature/login'
    };
    expect(buildAddArgs(choice, `${BASE}/feature-login`)).toEqual([
      'worktree',
      'add',
      '--track',
      '-b',
      'feature/login',
      `${BASE}/feature-login`,
      'origin/feature/login'
    ]);
  });

  it('lets git name the branch when nothing was chosen', () => {
    expect(buildAddArgs({ kind: 'default' }, `${BASE}/spike`)).toEqual([
      'worktree',
      'add',
      `${BASE}/spike`
    ]);
  });

  it('refuses to build arguments for choices that are not an add', () => {
    expect(() =>
      buildAddArgs({ kind: 'checkedOut', branch: 'main', worktreePath: '/repo' }, `${BASE}/main`)
    ).toThrow(/already checked out/);
    expect(() => buildAddArgs({ kind: 'promptNewBranch', from: 'main' }, `${BASE}/x`)).toThrow(
      /must be resolved/
    );
  });
});

describe('the git command each branch choice runs', () => {
  const cases: ReadonlyArray<{ name: string; choice: CreateChoice; expected: string[] }> = [
    {
      name: 'existing local branch',
      choice: { kind: 'localBranch', branch: 'fix-login' },
      expected: ['worktree', 'add', `${BASE}/fix-login`, 'fix-login']
    },
    {
      name: 'new branch',
      choice: { kind: 'newBranch', branch: 'fix-login' },
      expected: ['worktree', 'add', '-b', 'fix-login', `${BASE}/fix-login`, 'HEAD']
    },
    {
      name: 'remote branch',
      choice: { kind: 'remoteBranch', branch: 'release', startPoint: 'origin/release' },
      expected: ['worktree', 'add', '--track', '-b', 'release', `${BASE}/fix-login`, 'origin/release']
    },
    {
      name: 'nothing chosen',
      choice: { kind: 'default' },
      expected: ['worktree', 'add', `${BASE}/fix-login`]
    }
  ];

  for (const testCase of cases) {
    it(`runs git worktree add for ${testCase.name}`, async () => {
      const git = new FakeGitCli();
      await git.addWorktree('/repo', buildAddArgs(testCase.choice, `${BASE}/fix-login`));
      expect(git.calls).toEqual([testCase.expected]);
    });
  }

  it('surfaces the git failure when the target directory exists', async () => {
    const git = new FakeGitCli({
      failures: [{ match: 'worktree add', stderr: `fatal: '${BASE}/fix-login' already exists` }]
    });
    await expect(
      git.addWorktree('/repo', buildAddArgs({ kind: 'default' }, `${BASE}/fix-login`))
    ).rejects.toThrow(/already exists/);
  });
});

describe('branchOfChoice', () => {
  it('reports the branch that seeds the default directory name', () => {
    expect(branchOfChoice({ kind: 'newBranch', branch: 'feature/login' })).toBe('feature/login');
    expect(branchOfChoice({ kind: 'localBranch', branch: 'main' })).toBe('main');
    expect(branchOfChoice({ kind: 'remoteBranch', branch: 'x', startPoint: 'origin/x' })).toBe('x');
    expect(branchOfChoice({ kind: 'default' })).toBeUndefined();
    expect(branchOfChoice({ kind: 'promptNewBranch', from: 'main' })).toBeUndefined();
  });
});

describe('localNameOfRemote', () => {
  it('strips the remote name', () => {
    expect(localNameOfRemote('origin/main')).toBe('main');
    expect(localNameOfRemote('upstream/feature/login')).toBe('feature/login');
    expect(localNameOfRemote('main')).toBe('main');
  });
});

describe('checkedOutBranches', () => {
  it('maps branches git already has checked out to their worktree', () => {
    const map = checkedOutBranches([
      worktree('/repo', 'main'),
      worktree('/wt/detached'),
      worktree('/wt/fix', 'fix-login')
    ]);
    expect([...map.entries()]).toEqual([
      ['main', '/repo'],
      ['fix-login', '/wt/fix']
    ]);
  });
});

describe('buildBranchItems', () => {
  const items = buildBranchItems({
    currentBranch: 'main',
    branches: [
      local('main', 'initial commit'),
      local('fix-login', 'add login form'),
      local('spike', 'try it'),
      remote('origin/main', 'initial commit'),
      remote('origin/release', 'cut release'),
      remote('origin/HEAD', '')
    ],
    worktrees: [worktree('/repo', 'main'), worktree('/wt/spike', 'spike')]
  });

  it('offers the create-new item first, naming the current branch', () => {
    expect(items[0]?.label).toBe('$(add) Create new branch from main');
    expect(items[0]?.choice).toEqual({ kind: 'promptNewBranch', from: 'main' });
  });

  it('lists free local branches with the commit subject', () => {
    expect(items[1]).toEqual({
      label: 'fix-login',
      description: 'add login form',
      choice: { kind: 'localBranch', branch: 'fix-login' }
    });
  });

  it('routes branches already checked out to open, after the free ones', () => {
    const takenLabels = items.slice(2, 4).map((item) => item.label);
    expect(takenLabels).toEqual(['main', 'spike']);
    expect(items[2]).toEqual({
      label: 'main',
      description: 'checked out at /repo',
      choice: { kind: 'checkedOut', branch: 'main', worktreePath: '/repo' }
    });
    expect(items[3]?.choice).toEqual({
      kind: 'checkedOut',
      branch: 'spike',
      worktreePath: '/wt/spike'
    });
  });

  it('lists only remote branches without a local counterpart, and never origin/HEAD', () => {
    const remotes = items.slice(4);
    expect(remotes).toEqual([
      {
        label: 'origin/release',
        description: 'cut release',
        choice: { kind: 'remoteBranch', branch: 'release', startPoint: 'origin/release' }
      }
    ]);
  });

  it('falls back to HEAD in the create-new label when detached', () => {
    const detached = buildBranchItems({ currentBranch: undefined, branches: [], worktrees: [] });
    expect(detached).toEqual([
      {
        label: '$(add) Create new branch from HEAD',
        choice: { kind: 'promptNewBranch', from: undefined }
      }
    ]);
  });
});

describe('freeTextItem', () => {
  const items: BranchPickItem[] = [
    { label: 'fix-login', choice: { kind: 'localBranch', branch: 'fix-login' } }
  ];

  it('turns text that matches no branch into a create-branch item', () => {
    expect(freeTextItem('new-thing', items)).toEqual({
      label: "$(add) Create branch 'new-thing'",
      choice: { kind: 'newBranch', branch: 'new-thing' }
    });
  });

  it('offers nothing for blank text or an exact branch match', () => {
    expect(freeTextItem('', items)).toBeUndefined();
    expect(freeTextItem('   ', items)).toBeUndefined();
    expect(freeTextItem('fix-login', items)).toBeUndefined();
  });

  it('trims the typed text', () => {
    expect(freeTextItem('  spike ', items)?.choice).toEqual({ kind: 'newBranch', branch: 'spike' });
  });
});

describe('validateBranchName', () => {
  it('accepts an empty name, rejects existing branches and names git refuses', async () => {
    const git = new FakeGitCli({ invalidBranchNames: ['bad~name'] });
    const existing = new Set(['main']);

    // Empty maps to the `default` choice, where git names the branch.
    expect(await validateBranchName(git, '/repo', '', existing)).toBeUndefined();
    expect(await validateBranchName(git, '/repo', '   ', existing)).toBeUndefined();
    expect(await validateBranchName(git, '/repo', 'main', existing)).toMatch(/already exists/);
    expect(await validateBranchName(git, '/repo', 'bad~name', existing)).toMatch(/not a valid branch name/);
    expect(await validateBranchName(git, '/repo', 'feature/login', existing)).toBeUndefined();
    expect(git.calls).toContainEqual(['check-ref-format', '--branch', 'bad~name']);
  });

  it('asks git about the trimmed name', async () => {
    const git = new FakeGitCli();
    expect(await validateBranchName(git, '/repo', '  spike  ', new Set())).toBeUndefined();
    expect(git.calls).toContainEqual(['check-ref-format', '--branch', 'spike']);
  });
});

describe('validateDirectoryName', () => {
  it('requires a plain, non-empty directory name', () => {
    expect(validateDirectoryName('')).toMatch(/Enter a directory name/);
    expect(validateDirectoryName('feature/login')).toMatch(/feature-login/);
    expect(validateDirectoryName('fix-login')).toBeUndefined();
  });
});
