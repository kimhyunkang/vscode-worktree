import * as vscode from 'vscode';

import { ExecGitCli, GitCli } from './git';
import { CommandContext, WorktreeModel } from './model';
import { WorktreeTreeProvider } from './tree';
import { registerCreateCommand } from './commands/create';
import { registerOpenCommands } from './commands/open';
import { registerPruneCommand } from './commands/prune';
import { registerRemoveCommand } from './commands/remove';
import { registerTerminalCommand } from './commands/terminal';

/** Exported for the integration harness, which drives the model directly. */
export interface WorktreeApi {
  readonly git: GitCli;
  readonly model: WorktreeModel;
}

export function activate(context: vscode.ExtensionContext): WorktreeApi {
  const git = new ExecGitCli();
  const model = new WorktreeModel(git);
  const provider = new WorktreeTreeProvider(model);
  const commandContext: CommandContext = { git, model };

  const treeView = vscode.window.createTreeView('worktreeView', {
    treeDataProvider: provider,
    showCollapseAll: false
  });

  context.subscriptions.push(
    model,
    provider,
    treeView,
    vscode.commands.registerCommand('worktree.refresh', () => model.refresh()),
    ...registerCreateCommand(commandContext),
    ...registerOpenCommands(commandContext),
    ...registerRemoveCommand(commandContext),
    ...registerTerminalCommand(commandContext),
    ...registerPruneCommand(commandContext)
  );

  void model.refresh();

  return { git, model };
}

export function deactivate(): void {
  // Every disposable is owned by context.subscriptions.
}
