import * as vscode from 'vscode';

import { errorMessage } from '../git';
import { CommandContext, Repository } from '../model';
import { WorktreeItem } from '../tree';
import { pickRepository } from './create';

export function registerPruneCommand(context: CommandContext): vscode.Disposable[] {
  const { git, model } = context;
  return [
    vscode.commands.registerCommand('worktree.prune', async (item?: WorktreeItem) => {
      const repo: Repository | undefined =
        item?.repository ?? (await pickRepository(model, 'Repository to prune'));
      if (repo === undefined) {
        return;
      }
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'git worktree prune' },
          // Pruning touches the repository's administrative files, so it runs
          // from the common dir rather than a worktree that may be gone.
          () => git.prune(repo.commonDir)
        );
      } catch (error) {
        void vscode.window.showErrorMessage(errorMessage(error));
      }
      await model.refresh();
    })
  ];
}
