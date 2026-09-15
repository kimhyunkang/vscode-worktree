import * as vscode from 'vscode';

import { GitCli, errorMessage } from '../git';
import { CommandContext, WorktreeNode } from '../model';
import { isInside } from '../paths';
import { WorktreeItem, labelFor } from '../tree';
import { resolveTarget } from './open';

type DeleteBranchSetting = 'ask' | 'always' | 'never';

function deleteBranchSetting(): DeleteBranchSetting {
  const value = vscode.workspace.getConfiguration('worktree').get<string>('deleteBranchOnRemove');
  return value === 'always' || value === 'never' ? value : 'ask';
}

const DELETE: vscode.MessageItem = { title: 'Delete' };
const DELETE_WITH_BRANCH: vscode.MessageItem = { title: 'Delete and Delete Branch' };
const FORCE_DELETE: vscode.MessageItem = { title: 'Force Delete' };
const DELETE_BRANCH: vscode.MessageItem = { title: 'Delete branch' };
const FORCE_DELETE_BRANCH: vscode.MessageItem = { title: 'Force Delete Branch' };
const CANCEL: vscode.MessageItem = { title: 'Cancel', isCloseAffordance: true };

const DIRTY_DETAIL = 'The worktree has uncommitted changes. They will be lost.';

/**
 * Terminals whose working directory is inside the worktree being removed.
 * A terminal created without an explicit cwd starts in the workspace folder,
 * so when that folder is the worktree (`defaultCwdIsInside`) it counts too.
 */
export function terminalsInside(
  terminals: readonly vscode.Terminal[],
  worktreePath: string,
  defaultCwdIsInside: boolean
): vscode.Terminal[] {
  return terminals.filter((terminal) => {
    const candidates: string[] = [];
    const created = terminal.creationOptions;
    const explicitCwd = 'cwd' in created ? created.cwd : undefined;
    if (explicitCwd === undefined && defaultCwdIsInside) {
      return true;
    }
    if (explicitCwd !== undefined) {
      candidates.push(typeof explicitCwd === 'string' ? explicitCwd : explicitCwd.fsPath);
    }
    // shellIntegration reports the live cwd on VS Code 1.93 and later; the cast
    // keeps this compiling against the declared 1.90 API.
    const live = (terminal as { shellIntegration?: { cwd?: vscode.Uri } }).shellIntegration?.cwd;
    if (live !== undefined) {
      candidates.push(live.fsPath);
    }
    return candidates.some((candidate) => isInside(worktreePath, candidate));
  });
}

/**
 * `git worktree remove`, escalating to `--force` when git complains about
 * modified or untracked files. Returns false when the removal did not happen.
 */
async function removeWorktree(
  git: GitCli,
  cwd: string,
  target: string,
  force: boolean
): Promise<boolean> {
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `git worktree remove${force ? ' --force' : ''} ${target}`
      },
      () => git.removeWorktree(cwd, target, force)
    );
    return true;
  } catch (error) {
    const message = errorMessage(error);
    if (force || !message.includes('contains modified or untracked files')) {
      void vscode.window.showErrorMessage(message);
      return false;
    }
    const answer = await vscode.window.showWarningMessage(
      `Force delete worktree at ${target}?`,
      { modal: true, detail: DIRTY_DETAIL },
      FORCE_DELETE,
      CANCEL
    );
    if (answer !== FORCE_DELETE) {
      return false;
    }
    return removeWorktree(git, cwd, target, true);
  }
}

/** `git branch -d`, escalating to `-D` when the branch is not fully merged. */
async function deleteBranch(
  git: GitCli,
  cwd: string,
  branch: string,
  modal: boolean
): Promise<boolean> {
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `git branch -d ${branch}` },
      () => git.deleteBranch(cwd, branch, false)
    );
    return true;
  } catch (error) {
    const message = errorMessage(error);
    if (!message.includes('not fully merged')) {
      void vscode.window.showErrorMessage(message);
      return false;
    }
    const answer = await vscode.window.showWarningMessage(
      `Branch '${branch}' is not fully merged. Delete it anyway?`,
      { modal, detail: 'Unmerged commits on this branch will be lost.' },
      FORCE_DELETE_BRANCH,
      CANCEL
    );
    if (answer !== FORCE_DELETE_BRANCH) {
      return false;
    }
    try {
      await git.deleteBranch(cwd, branch, true);
      return true;
    } catch (forceError) {
      void vscode.window.showErrorMessage(errorMessage(forceError));
      return false;
    }
  }
}

/** Delete flow for a worktree other than the one this window has open. */
async function deleteOtherWorktree(context: CommandContext, node: WorktreeNode): Promise<void> {
  const { git, model } = context;
  const label = labelFor(node);
  const confirm = await vscode.window.showWarningMessage(
    `Delete worktree '${label}'?`,
    { modal: true, detail: node.info.path },
    DELETE
  );
  if (confirm !== DELETE) {
    return;
  }

  const removed = await removeWorktree(git, node.repo.commonDir, node.info.path, false);
  await model.refresh();
  if (!removed) {
    return;
  }

  const branch = branchOf(node);
  if (branch === undefined) {
    return;
  }
  const setting = deleteBranchSetting();
  if (setting === 'never') {
    return;
  }
  if (setting === 'ask') {
    const answer = await vscode.window.showInformationMessage(
      `Delete branch '${branch}'?`,
      DELETE_BRANCH
    );
    if (answer !== DELETE_BRANCH) {
      return;
    }
  }
  await deleteBranch(git, node.repo.commonDir, branch, false);
  await model.refresh();
}

/**
 * Delete flow for the worktree this window has open. The window closes at the
 * end, so every question is asked up front and every prompt is modal.
 */
async function deleteCurrentWorktree(context: CommandContext, node: WorktreeNode): Promise<void> {
  const { git } = context;
  const label = labelFor(node);
  const branch = branchOf(node);
  const setting = deleteBranchSetting();
  const offerBranch = branch !== undefined && setting === 'ask';

  const buttons = offerBranch ? [DELETE, DELETE_WITH_BRANCH] : [DELETE];
  const confirm = await vscode.window.showWarningMessage(
    `Delete worktree '${label}' and close this window?`,
    { modal: true, detail: node.info.path },
    ...buttons
  );
  if (confirm !== DELETE && confirm !== DELETE_WITH_BRANCH) {
    return;
  }
  const alsoDeleteBranch =
    branch !== undefined && (setting === 'always' || confirm === DELETE_WITH_BRANCH);

  // Ask about dirt before touching anything: a failed remove would leave the
  // window half torn down.
  let force = false;
  try {
    const status = await git.status(node.info.path);
    if (status.trim() !== '') {
      const answer = await vscode.window.showWarningMessage(
        `Worktree '${label}' has uncommitted changes. Delete anyway?`,
        { modal: true, detail: DIRTY_DETAIL },
        FORCE_DELETE,
        CANCEL
      );
      if (answer !== FORCE_DELETE) {
        return;
      }
      force = true;
    }
  } catch (error) {
    void vscode.window.showErrorMessage(errorMessage(error));
    return;
  }

  // Shells holding the directory as cwd block removal on Windows.
  for (const terminal of terminalsInside(vscode.window.terminals, node.info.path, true)) {
    terminal.dispose();
  }

  const removed = await removeWorktree(git, node.repo.commonDir, node.info.path, force);
  if (!removed) {
    return;
  }

  if (alsoDeleteBranch && branch !== undefined) {
    const branchDeleted = await deleteBranch(git, node.repo.commonDir, branch, true);
    if (!branchDeleted) {
      return;
    }
  }

  await vscode.commands.executeCommand('workbench.action.closeWindow');
}

function branchOf(node: WorktreeNode): string | undefined {
  const ref = node.info.branch;
  return ref === undefined ? undefined : ref.replace(/^refs\/heads\//, '');
}

export function registerRemoveCommand(context: CommandContext): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('worktree.delete', async (item?: WorktreeItem) => {
      const node = await resolveTarget(context.model, item, 'Worktree to delete');
      if (node === undefined) {
        return;
      }
      if (node.isMain) {
        // git refuses to remove the main worktree.
        void vscode.window.showErrorMessage('The main worktree cannot be deleted.');
        return;
      }
      if (node.isCurrent) {
        await deleteCurrentWorktree(context, node);
        return;
      }
      await deleteOtherWorktree(context, node);
    })
  ];
}
