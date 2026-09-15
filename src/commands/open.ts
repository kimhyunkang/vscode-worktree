import * as vscode from 'vscode';

import { CommandContext, WorktreeModel, WorktreeNode, baseDirectoryFor } from '../model';
import { describeWorktreePath } from '../paths';
import { WorktreeItem, labelFor } from '../tree';

export type OpenBehavior = 'newWindow' | 'currentWindow' | 'ask';

/** Opens a folder as the workspace of a new or the current window. */
export async function openFolder(worktreePath: string, forceNewWindow: boolean): Promise<void> {
  // VS Code's main process focuses an existing window that already has the
  // folder open instead of creating a second one.
  await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(worktreePath), {
    forceNewWindow
  });
}

function configuredBehavior(): OpenBehavior {
  const value = vscode.workspace.getConfiguration('worktree').get<string>('openBehavior');
  return value === 'currentWindow' || value === 'ask' ? value : 'newWindow';
}

/** Opens according to `worktree.openBehavior`, asking when it is `ask`. */
export async function openWithBehavior(worktreePath: string): Promise<void> {
  const behavior = configuredBehavior();
  if (behavior === 'newWindow') {
    await openFolder(worktreePath, true);
    return;
  }
  if (behavior === 'currentWindow') {
    await openFolder(worktreePath, false);
    return;
  }
  const choice = await vscode.window.showQuickPick(
    [
      { label: 'Open in New Window', forceNewWindow: true },
      { label: 'Open in Current Window', forceNewWindow: false }
    ],
    { placeHolder: worktreePath }
  );
  if (choice === undefined) {
    return;
  }
  await openFolder(worktreePath, choice.forceNewWindow);
}

/**
 * Resolves the worktree a command should act on: the tree item it was invoked
 * with, or a QuickPick when it came from the command palette.
 */
export async function resolveTarget(
  model: WorktreeModel,
  item: WorktreeItem | undefined,
  placeHolder: string
): Promise<WorktreeNode | undefined> {
  if (item !== undefined) {
    return item.node;
  }
  return pickWorktree(model, placeHolder);
}

export async function pickWorktree(
  model: WorktreeModel,
  placeHolder: string
): Promise<WorktreeNode | undefined> {
  const nodes = model.getWorktrees().filter((node) => !node.info.bare);
  if (nodes.length === 0) {
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    nodes.map((node) => ({
      label: labelFor(node),
      description: describeWorktreePath(node.info.path, baseDirectoryFor(model, node.repo)),
      node
    })),
    { placeHolder }
  );
  return picked?.node;
}

export function registerOpenCommands(context: CommandContext): vscode.Disposable[] {
  const { model } = context;
  return [
    vscode.commands.registerCommand('worktree.open', async (item?: WorktreeItem) => {
      const node = await resolveTarget(model, item, 'Open worktree');
      if (node !== undefined) {
        await openWithBehavior(node.info.path);
      }
    }),
    vscode.commands.registerCommand('worktree.openInNewWindow', async (item?: WorktreeItem) => {
      const node = await resolveTarget(model, item, 'Open worktree in a new window');
      if (node !== undefined) {
        await openFolder(node.info.path, true);
      }
    }),
    vscode.commands.registerCommand('worktree.openInCurrentWindow', async (item?: WorktreeItem) => {
      const node = await resolveTarget(model, item, 'Open worktree in this window');
      if (node !== undefined) {
        await openFolder(node.info.path, false);
      }
    }),
    vscode.commands.registerCommand('worktree.copyPath', async (item?: WorktreeItem) => {
      const node = await resolveTarget(model, item, 'Copy worktree path');
      if (node !== undefined) {
        await vscode.env.clipboard.writeText(node.info.path);
      }
    }),
    vscode.commands.registerCommand('worktree.revealInOS', async (item?: WorktreeItem) => {
      const node = await resolveTarget(model, item, 'Reveal worktree');
      if (node !== undefined) {
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(node.info.path));
      }
    })
  ];
}
