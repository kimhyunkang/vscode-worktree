import * as vscode from 'vscode';

import { CommandContext } from '../model';
import { WorktreeItem, labelFor } from '../tree';
import { resolveTarget } from './open';

export function registerTerminalCommand(context: CommandContext): vscode.Disposable[] {
  const { model } = context;
  return [
    vscode.commands.registerCommand('worktree.openTerminal', async (item?: WorktreeItem) => {
      const node = await resolveTarget(model, item, 'Open a terminal in worktree');
      if (node === undefined) {
        return;
      }
      const terminal = vscode.window.createTerminal({
        name: labelFor(node),
        cwd: node.info.path
      });
      terminal.show();
    })
  ];
}
