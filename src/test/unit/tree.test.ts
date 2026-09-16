import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ThemeColor, ThemeIcon } from 'vscode';

import { Repository, WorktreeNode } from '../../model';
import { WorktreeInfo } from '../../porcelain';
import { CURRENT_MARKER, descriptionFor, iconFor, labelFor, treeLabelFor } from '../../tree';

const baseDirectory = path.normalize('/Users/me/project/skool-be.worktrees');

const repo: Repository = {
  commonDir: '/Users/me/project/skool-be/.git',
  currentRoot: '/Users/me/project/skool-be',
  folder: {} as Repository['folder']
};

function node(
  worktreePath: string,
  flags: Partial<Pick<WorktreeNode, 'isMain' | 'isCurrent'>> = {},
  info: Partial<WorktreeInfo> = {}
): WorktreeNode {
  return {
    info: { path: worktreePath, bare: false, head: 'abcdef0123456789', ...info } as WorktreeInfo,
    repo,
    isMain: flags.isMain ?? false,
    isCurrent: flags.isCurrent ?? false
  };
}

const branch = { branch: 'refs/heads/feature/login' };

describe('treeLabelFor', () => {
  it('leads with the marker for the current worktree', () => {
    const current = node('/wt/feature-login', { isCurrent: true }, branch);
    expect(treeLabelFor(current)).toBe(`${CURRENT_MARKER} feature/login`);
  });

  it('leaves other worktrees and the bare label alone', () => {
    const other = node('/wt/feature-login', {}, branch);
    expect(treeLabelFor(other)).toBe('feature/login');
    expect(labelFor(node('/wt/feature-login', { isCurrent: true }, branch))).toBe('feature/login');
  });

  it('marks the main worktree when this window has it open', () => {
    const main = node(repo.currentRoot, { isMain: true, isCurrent: true }, { branch: 'refs/heads/main' });
    expect(treeLabelFor(main)).toBe(`${CURRENT_MARKER} main`);
  });
});

describe('descriptionFor', () => {
  it('shows the relative path with no marker, current or not', () => {
    const other = node(path.join(baseDirectory, 'feature-login'));
    const current = node(path.join(baseDirectory, 'feature-login'), { isCurrent: true });
    expect(descriptionFor(other, baseDirectory)).toBe('feature-login');
    expect(descriptionFor(current, baseDirectory)).toBe('feature-login');
  });
});

describe('iconFor', () => {
  it('keeps the type icon and tints it for the current worktree', () => {
    const current = iconFor(node('/wt/a', { isCurrent: true })) as ThemeIcon;
    expect(current.id).toBe('git-branch');
    expect((current.color as ThemeColor).id).toBe('charts.green');

    const currentMain = iconFor(node('/repo', { isMain: true, isCurrent: true })) as ThemeIcon;
    expect(currentMain.id).toBe('repo');
    expect((currentMain.color as ThemeColor).id).toBe('charts.green');
  });

  it('leaves other worktrees untinted', () => {
    const other = iconFor(node('/wt/b')) as ThemeIcon;
    expect(other.id).toBe('git-branch');
    expect(other.color).toBeUndefined();
  });

  it('shows the warning icon for a prunable worktree without a tint', () => {
    const prunable = iconFor(node('/wt/gone', {}, { prunable: 'gitdir file points to non-existent location' })) as ThemeIcon;
    expect(prunable.id).toBe('warning');
    expect(prunable.color).toBeUndefined();
  });
});
