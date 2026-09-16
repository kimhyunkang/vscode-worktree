/**
 * Minimal hand-written stand-in for the `vscode` module. Vitest aliases the
 * module to this file, because the real one only exists inside the extension
 * host. It provides just enough for modules under test to load; the pure logic
 * the unit tests exercise never calls into it.
 */

export class EventEmitter<T> {
  private readonly listeners: Array<(value: T) => void> = [];

  readonly event = (listener: (value: T) => void): { dispose(): void } => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        const index = this.listeners.indexOf(listener);
        if (index >= 0) {
          this.listeners.splice(index, 1);
        }
      }
    };
  };

  fire(value: T): void {
    for (const listener of [...this.listeners]) {
      listener(value);
    }
  }

  dispose(): void {
    this.listeners.length = 0;
  }
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2
}

export enum ProgressLocation {
  SourceControl = 1,
  Window = 10,
  Notification = 15
}

export class ThemeColor {
  constructor(readonly id: string) {}
}

export class ThemeIcon {
  constructor(
    readonly id: string,
    readonly color?: ThemeColor
  ) {}
}

export class MarkdownString {
  supportThemeIcons = false;
  constructor(public value = '') {}
}

export class TreeItem {
  id?: string;
  description?: string | boolean;
  iconPath?: unknown;
  tooltip?: unknown;
  contextValue?: string;
  constructor(
    public label: string,
    public collapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.None
  ) {}
}

export class Uri {
  private constructor(
    readonly scheme: string,
    readonly fsPath: string
  ) {}
  static file(fsPath: string): Uri {
    return new Uri('file', fsPath);
  }
  toString(): string {
    return `${this.scheme}://${this.fsPath}`;
  }
}

export class RelativePattern {
  constructor(
    readonly base: unknown,
    readonly pattern: string
  ) {}
}

/** Configuration values tests may set: `configuration.set('worktree.openBehavior', 'ask')`. */
export const configuration = new Map<string, unknown>();

export const workspace = {
  workspaceFolders: undefined as unknown,
  getConfiguration(section?: string) {
    return {
      get<T>(key: string): T | undefined {
        const full = section === undefined ? key : `${section}.${key}`;
        return configuration.get(full) as T | undefined;
      }
    };
  },
  getWorkspaceFolder(): undefined {
    return undefined;
  },
  createFileSystemWatcher(): any {
    return {
      onDidCreate: () => ({ dispose(): void {} }),
      onDidChange: () => ({ dispose(): void {} }),
      onDidDelete: () => ({ dispose(): void {} }),
      dispose(): void {}
    };
  },
  onDidChangeWorkspaceFolders(): { dispose(): void } {
    return { dispose(): void {} };
  }
};

export const window = {
  activeTextEditor: undefined as unknown,
  terminals: [] as unknown[],
  createTreeView(): any {
    return { dispose(): void {} };
  },
  createTerminal(): any {
    return { show(): void {}, dispose(): void {} };
  },
  createQuickPick(): any {
    throw new Error('createQuickPick is not implemented in the vscode stub');
  },
  showQuickPick(): Promise<undefined> {
    return Promise.resolve(undefined);
  },
  showInputBox(): Promise<undefined> {
    return Promise.resolve(undefined);
  },
  showInformationMessage(): Promise<undefined> {
    return Promise.resolve(undefined);
  },
  showWarningMessage(): Promise<undefined> {
    return Promise.resolve(undefined);
  },
  showErrorMessage(): Promise<undefined> {
    return Promise.resolve(undefined);
  },
  withProgress<T>(_options: unknown, task: () => Thenable<T>): Thenable<T> {
    return task();
  },
  onDidChangeWindowState(): { dispose(): void } {
    return { dispose(): void {} };
  }
};

export const commands = {
  registerCommand(): { dispose(): void } {
    return { dispose(): void {} };
  },
  executeCommand(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
};

export const env = {
  clipboard: {
    text: '',
    async writeText(value: string): Promise<void> {
      env.clipboard.text = value;
    }
  }
};

type Thenable<T> = Promise<T>;
