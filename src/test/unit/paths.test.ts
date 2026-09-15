import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  describeWorktreePath,
  expandBaseDirectory,
  isInside,
  sanitizeDirectoryName,
  worktreePath
} from '../../paths';

const repo = { repoRoot: '/Users/me/project/skool-be' };

describe('expandBaseDirectory', () => {
  it('expands the default template to a sibling directory', () => {
    expect(expandBaseDirectory('${repoParent}/${repoName}.worktrees', repo)).toBe(
      path.normalize('/Users/me/project/skool-be.worktrees')
    );
  });

  it('expands ${repoRoot} for the in-repo layout', () => {
    expect(expandBaseDirectory('${repoRoot}/.worktrees', repo)).toBe(
      path.normalize('/Users/me/project/skool-be/.worktrees')
    );
  });

  it('expands each variable on its own', () => {
    expect(expandBaseDirectory('${repoRoot}', repo)).toBe(path.normalize('/Users/me/project/skool-be'));
    expect(expandBaseDirectory('${repoParent}', repo)).toBe(path.normalize('/Users/me/project'));
    expect(expandBaseDirectory('${repoParent}/${repoName}', repo)).toBe(
      path.normalize('/Users/me/project/skool-be')
    );
  });

  it('resolves a relative template against the repository root', () => {
    expect(expandBaseDirectory('../worktrees', repo)).toBe(path.normalize('/Users/me/project/worktrees'));
  });

  it('leaves an absolute template alone and falls back to the root when empty', () => {
    expect(expandBaseDirectory('/tmp/worktrees', repo)).toBe(path.normalize('/tmp/worktrees'));
    expect(expandBaseDirectory('', repo)).toBe(path.normalize('/Users/me/project/skool-be'));
  });

  it('ignores unknown variables', () => {
    expect(expandBaseDirectory('${repoParent}/${nope}wt', repo)).toBe(
      path.normalize('/Users/me/project/${nope}wt')
    );
  });
});

describe('sanitizeDirectoryName', () => {
  it('replaces path separators with a dash', () => {
    expect(sanitizeDirectoryName('feature/login')).toBe('feature-login');
    expect(sanitizeDirectoryName('user/feature/login')).toBe('user-feature-login');
    expect(sanitizeDirectoryName('feature\\login')).toBe('feature-login');
  });

  it('leaves plain names untouched', () => {
    expect(sanitizeDirectoryName('fix-login')).toBe('fix-login');
    expect(sanitizeDirectoryName('main')).toBe('main');
    expect(sanitizeDirectoryName('release_2.1')).toBe('release_2.1');
  });

  it('collapses runs, trims dashes and drops leading dots', () => {
    expect(sanitizeDirectoryName('feature//login')).toBe('feature-login');
    expect(sanitizeDirectoryName('/leading/trailing/')).toBe('leading-trailing');
    expect(sanitizeDirectoryName('..hidden')).toBe('hidden');
    expect(sanitizeDirectoryName('spike  two')).toBe('spike-two');
  });

  it('replaces characters that are illegal in a Windows directory name', () => {
    expect(sanitizeDirectoryName('fix:login?')).toBe('fix-login');
    expect(sanitizeDirectoryName('a<b>c|d"e*f')).toBe('a-b-c-d-e-f');
  });
});

describe('worktreePath', () => {
  it('joins the base directory and the directory name', () => {
    expect(worktreePath('/Users/me/project/skool-be.worktrees', 'fix-login')).toBe(
      path.normalize('/Users/me/project/skool-be.worktrees/fix-login')
    );
  });
});

describe('describeWorktreePath', () => {
  const base = '/Users/me/project/skool-be.worktrees';

  it('uses the path relative to the base directory when inside it', () => {
    expect(describeWorktreePath(`${base}/fix-login`, base)).toBe('fix-login');
    expect(describeWorktreePath(`${base}/team/fix-login`, base)).toBe(path.join('team', 'fix-login'));
  });

  it('uses the absolute path when outside the base directory', () => {
    expect(describeWorktreePath('/Users/me/project/skool-be', base)).toBe('/Users/me/project/skool-be');
    expect(describeWorktreePath('/tmp/elsewhere', base)).toBe('/tmp/elsewhere');
  });

  it('uses the absolute path for the base directory itself', () => {
    expect(describeWorktreePath(base, base)).toBe(base);
  });
});

describe('isInside', () => {
  it('accepts the directory itself and its descendants', () => {
    expect(isInside('/a/b', '/a/b')).toBe(true);
    expect(isInside('/a/b', '/a/b/c/d')).toBe(true);
  });

  it('rejects ancestors and siblings', () => {
    expect(isInside('/a/b', '/a')).toBe(false);
    expect(isInside('/a/b', '/a/bc')).toBe(false);
    expect(isInside('/a/b', '/x/y')).toBe(false);
  });
});
