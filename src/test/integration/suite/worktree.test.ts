import * as assert from 'node:assert/strict';

import * as vscode from 'vscode';

import type { WorktreeApi } from '../../../extension';
import { worktreeBranch } from '../../../porcelain';

const EXTENSION_ID = 'publisher-placeholder.vscode-worktree';

suite('listWorktrees against a real repository', () => {
  test('lists the main worktree first and the linked worktree after it', async () => {
    const repo = process.env.WORKTREE_TEST_REPO;
    const linked = process.env.WORKTREE_TEST_WORKTREE;
    assert.ok(repo, 'WORKTREE_TEST_REPO must be set by runTest.ts');
    assert.ok(linked, 'WORKTREE_TEST_WORKTREE must be set by runTest.ts');

    const extension = vscode.extensions.getExtension<WorktreeApi>(EXTENSION_ID);
    assert.ok(extension, `extension ${EXTENSION_ID} is not installed in the test host`);
    const api = await extension.activate();

    const worktrees = await api.git.listWorktrees(repo);

    assert.equal(worktrees.length, 2);
    assert.equal(worktrees[0]?.path, repo);
    assert.equal(worktreeBranch(worktrees[0]!), 'main');
    assert.equal(worktrees[1]?.path, linked);
    assert.equal(worktreeBranch(worktrees[1]!), 'fix-login');
  });
});
