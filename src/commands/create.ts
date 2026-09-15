import * as path from 'node:path';
import * as vscode from 'vscode';

import { GitCli, errorMessage } from '../git';
import {
  CommandContext,
  Repository,
  WorktreeModel,
  baseDirectoryFor,
  sameRepository
} from '../model';
import { sanitizeDirectoryName, worktreePath } from '../paths';
import { BranchRef, WorktreeInfo, shortenRef, worktreeBranch } from '../porcelain';
import { openWithBehavior } from './open';

/** What the branch QuickPick decided. Drives the git arguments. */
export type CreateChoice =
  | { readonly kind: 'promptNewBranch'; readonly from: string | undefined }
  | { readonly kind: 'newBranch'; readonly branch: string }
  | { readonly kind: 'localBranch'; readonly branch: string }
  | { readonly kind: 'remoteBranch'; readonly branch: string; readonly startPoint: string }
  | { readonly kind: 'checkedOut'; readonly branch: string; readonly worktreePath: string }
  | { readonly kind: 'default' };

export interface BranchPickItem {
  readonly label: string;
  readonly description?: string;
  readonly choice: CreateChoice;
}

export interface BranchPickInput {
  readonly currentBranch: string | undefined;
  readonly branches: readonly BranchRef[];
  readonly worktrees: readonly WorktreeInfo[];
}

/** Branch name a remote-tracking ref maps to: `origin/feature/x` -> `feature/x`. */
export function localNameOfRemote(remoteName: string): string {
  const slash = remoteName.indexOf('/');
  return slash === -1 ? remoteName : remoteName.slice(slash + 1);
}

/** Short branch name -> worktree path, for branches git already has checked out. */
export function checkedOutBranches(
  worktrees: readonly WorktreeInfo[]
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const worktree of worktrees) {
    const branch = worktreeBranch(worktree);
    if (branch !== undefined) {
      map.set(branch, worktree.path);
    }
  }
  return map;
}

/**
 * Builds the QuickPick items in the order the design fixes: create-new, local
 * branches that are free, local branches already checked out, then remote
 * branches without a local counterpart.
 */
export function buildBranchItems(input: BranchPickInput): BranchPickItem[] {
  const checkedOut = checkedOutBranches(input.worktrees);
  const locals = input.branches.filter((ref) => !ref.isRemote);
  const localNames = new Set(locals.map((ref) => ref.name));

  const free: BranchPickItem[] = [];
  const taken: BranchPickItem[] = [];
  for (const ref of locals) {
    const at = checkedOut.get(ref.name);
    if (at === undefined) {
      free.push({ label: ref.name, description: ref.subject, choice: { kind: 'localBranch', branch: ref.name } });
    } else {
      taken.push({
        label: ref.name,
        description: `checked out at ${at}`,
        // git refuses to check out a branch twice, so this opens instead.
        choice: { kind: 'checkedOut', branch: ref.name, worktreePath: at }
      });
    }
  }

  const remotes: BranchPickItem[] = [];
  for (const ref of input.branches) {
    if (!ref.isRemote || ref.name.endsWith('/HEAD')) {
      continue;
    }
    const localName = localNameOfRemote(ref.name);
    if (localName === '' || localNames.has(localName)) {
      continue;
    }
    remotes.push({
      label: ref.name,
      description: ref.subject,
      choice: { kind: 'remoteBranch', branch: localName, startPoint: ref.name }
    });
  }

  const createNew: BranchPickItem = {
    label:
      input.currentBranch === undefined
        ? '$(add) Create new branch from HEAD'
        : `$(add) Create new branch from ${input.currentBranch}`,
    choice: { kind: 'promptNewBranch', from: input.currentBranch }
  };

  return [createNew, ...free, ...taken, ...remotes];
}

/** Item for text that matches no branch: `Create branch '<text>'`. */
export function freeTextItem(text: string, items: readonly BranchPickItem[]): BranchPickItem | undefined {
  const trimmed = text.trim();
  if (trimmed === '') {
    return undefined;
  }
  if (items.some((item) => item.label === trimmed)) {
    return undefined;
  }
  return {
    label: `$(add) Create branch '${trimmed}'`,
    choice: { kind: 'newBranch', branch: trimmed }
  };
}

/** The git command for a decided choice. */
export function buildAddArgs(choice: CreateChoice, target: string): string[] {
  switch (choice.kind) {
    case 'localBranch':
      return ['worktree', 'add', target, choice.branch];
    case 'newBranch':
      return ['worktree', 'add', '-b', choice.branch, target, 'HEAD'];
    case 'remoteBranch':
      return ['worktree', 'add', '--track', '-b', choice.branch, target, choice.startPoint];
    case 'default':
      // git names the branch after the directory, starting from current HEAD.
      return ['worktree', 'add', target];
    case 'checkedOut':
      throw new Error('a branch that is already checked out is opened, not added');
    case 'promptNewBranch':
      throw new Error('the new branch name must be resolved before building git arguments');
  }
}

/** Branch name for the directory-name default, undefined when git picks it. */
export function branchOfChoice(choice: CreateChoice): string | undefined {
  switch (choice.kind) {
    case 'localBranch':
    case 'newBranch':
    case 'remoteBranch':
    case 'checkedOut':
      return choice.branch;
    default:
      return undefined;
  }
}

/**
 * Validation for the new-branch InputBox: git's own ref rules plus a check
 * against the branches that already exist. Empty is valid: the caller maps it
 * to the `default` choice, where git names the branch after the directory.
 */
export async function validateBranchName(
  git: GitCli,
  cwd: string,
  name: string,
  existing: ReadonlySet<string>
): Promise<string | undefined> {
  const trimmed = name.trim();
  if (trimmed === '') {
    return undefined;
  }
  if (existing.has(trimmed)) {
    return `Branch '${trimmed}' already exists.`;
  }
  if (!(await git.checkRefFormatBranch(cwd, trimmed))) {
    return `'${trimmed}' is not a valid branch name.`;
  }
  return undefined;
}

/** Validation for the directory-name InputBox. */
export function validateDirectoryName(name: string): string | undefined {
  const trimmed = name.trim();
  if (trimmed === '') {
    return 'Enter a directory name.';
  }
  if (trimmed !== sanitizeDirectoryName(trimmed)) {
    return `Use a plain directory name, for example '${sanitizeDirectoryName(trimmed)}'.`;
  }
  return undefined;
}

/** Repository to act on: the active editor's, else a QuickPick, else the only one. */
export async function pickRepository(
  model: WorktreeModel,
  placeHolder: string
): Promise<Repository | undefined> {
  const repositories = model.getRepositories();
  if (repositories.length === 0) {
    void vscode.window.showErrorMessage('No git repository was found in this window.');
    return undefined;
  }
  const only = repositories[0];
  if (repositories.length === 1 && only !== undefined) {
    return only;
  }
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active !== undefined) {
    const folder = vscode.workspace.getWorkspaceFolder(active);
    const match = repositories.find(
      (repo) => folder !== undefined && repo.folder.uri.fsPath === folder.uri.fsPath
    );
    if (match !== undefined) {
      return match;
    }
  }
  const picked = await vscode.window.showQuickPick(
    repositories.map((repo) => ({
      label: path.basename(repo.currentRoot),
      description: repo.currentRoot,
      repo
    })),
    { placeHolder }
  );
  return picked?.repo;
}

async function pickBranchChoice(
  items: BranchPickItem[],
  placeHolder: string
): Promise<CreateChoice | undefined> {
  const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { choice: CreateChoice }>();
  quickPick.placeholder = placeHolder;
  quickPick.matchOnDescription = true;
  const toQuickPickItems = (values: readonly BranchPickItem[]) =>
    values.map((item) => ({
      label: item.label,
      description: item.description,
      choice: item.choice
    }));
  quickPick.items = toQuickPickItems(items);

  try {
    return await new Promise<CreateChoice | undefined>((resolve) => {
      let resolved = false;
      const finish = (choice: CreateChoice | undefined): void => {
        if (!resolved) {
          resolved = true;
          resolve(choice);
        }
      };
      quickPick.onDidChangeValue((value) => {
        const extra = freeTextItem(value, items);
        quickPick.items = toQuickPickItems(extra === undefined ? items : [extra, ...items]);
      });
      quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems[0];
        if (selected !== undefined) {
          finish(selected.choice);
        } else if (quickPick.value.trim() === '') {
          // Nothing selected and nothing typed: let git choose the branch.
          finish({ kind: 'default' });
        } else {
          finish({ kind: 'newBranch', branch: quickPick.value.trim() });
        }
        quickPick.hide();
      });
      quickPick.onDidHide(() => finish(undefined));
      quickPick.show();
    });
  } finally {
    quickPick.dispose();
  }
}

async function resolveChoice(
  git: GitCli,
  cwd: string,
  choice: CreateChoice,
  existing: ReadonlySet<string>
): Promise<CreateChoice | undefined> {
  if (choice.kind === 'newBranch') {
    // Free text accepted straight from the QuickPick skipped the InputBox
    // validation, so run it here before git sees the name.
    const problem = await validateBranchName(git, cwd, choice.branch, existing);
    if (problem !== undefined) {
      void vscode.window.showErrorMessage(problem);
      return undefined;
    }
    return choice;
  }
  if (choice.kind !== 'promptNewBranch') {
    return choice;
  }
  const from = choice.from ?? 'the current HEAD';
  const name = await vscode.window.showInputBox({
    title: 'New branch name',
    prompt: `Branch created from ${from}. Leave empty to name the branch after the worktree directory.`,
    value: '',
    ignoreFocusOut: true,
    validateInput: (value) => validateBranchName(git, cwd, value, existing)
  });
  if (name === undefined) {
    return undefined;
  }
  if (name.trim() === '') {
    // No name given: `git worktree add <path>` names the branch after the
    // directory and starts it from the current HEAD.
    return { kind: 'default' };
  }
  return { kind: 'newBranch', branch: name.trim() };
}

async function askDirectoryName(
  baseDirectory: string,
  defaultName: string
): Promise<string | undefined> {
  const name = await vscode.window.showInputBox({
    title: 'Worktree directory name',
    prompt: `Worktree will be created at ${worktreePath(baseDirectory, defaultName || '<name>')}`,
    value: defaultName,
    ignoreFocusOut: true,
    validateInput: validateDirectoryName
  });
  return name?.trim();
}

/** Runs `git worktree add`, retrying with a new name when the path exists. */
async function addWorktree(
  git: GitCli,
  cwd: string,
  choice: CreateChoice,
  baseDirectory: string,
  initialName: string
): Promise<string | undefined> {
  let name: string | undefined = initialName;
  while (name !== undefined) {
    const target = worktreePath(baseDirectory, name);
    const args = buildAddArgs(choice, target);
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `git ${args.join(' ')}` },
        () => git.addWorktree(cwd, args)
      );
      return target;
    } catch (error) {
      const message = errorMessage(error);
      // `fatal: '<path>' already exists` is the retryable case. A clashing
      // branch reports `a branch named '<x>' already exists` and is not.
      if (message.includes('a branch named') || !message.includes('already exists')) {
        void vscode.window.showErrorMessage(message);
        return undefined;
      }
      const retry = await vscode.window.showWarningMessage(
        message,
        { modal: true },
        'Choose Another Name'
      );
      if (retry === undefined) {
        return undefined;
      }
      name = await askDirectoryName(baseDirectory, name);
    }
  }
  return undefined;
}

export async function createWorktree(context: CommandContext): Promise<void> {
  const { git, model } = context;
  const repo = await pickRepository(model, 'Repository to create a worktree in');
  if (repo === undefined) {
    return;
  }
  const cwd = repo.currentRoot;

  let branches: readonly BranchRef[];
  let currentBranch: string | undefined;
  try {
    branches = await git.listBranches(cwd);
    currentBranch = await git.currentBranch(cwd);
  } catch (error) {
    void vscode.window.showErrorMessage(errorMessage(error));
    return;
  }

  // Refresh first: the checked-out detection must not run on a stale list.
  await model.refresh();
  const worktrees = model
    .getWorktrees()
    .filter((node) => sameRepository(node.repo, repo))
    .map((node) => node.info);
  const items = buildBranchItems({ currentBranch, branches, worktrees });
  const picked = await pickBranchChoice(items, 'Branch for the new worktree, or type a new name');
  if (picked === undefined) {
    return;
  }

  if (picked.kind === 'checkedOut') {
    // Opening beats failing: git will not check the branch out twice.
    await openWithBehavior(picked.worktreePath);
    return;
  }

  const existing = new Set(
    branches.filter((ref) => !ref.isRemote).map((ref) => shortenRef(ref.ref))
  );
  const choice = await resolveChoice(git, cwd, picked, existing);
  if (choice === undefined) {
    return;
  }

  const baseDirectory = baseDirectoryFor(model, repo);
  const branch = branchOfChoice(choice);
  const defaultName = branch === undefined ? '' : sanitizeDirectoryName(branch);
  const directoryName = await askDirectoryName(baseDirectory, defaultName);
  if (directoryName === undefined || directoryName === '') {
    return;
  }

  const created = await addWorktree(git, cwd, choice, baseDirectory, directoryName);
  await model.refresh();
  if (created === undefined) {
    return;
  }
  const openAfterCreate =
    vscode.workspace.getConfiguration('worktree').get<boolean>('openAfterCreate') ?? true;
  if (openAfterCreate) {
    await openWithBehavior(created);
  }
}

export function registerCreateCommand(context: CommandContext): vscode.Disposable[] {
  return [vscode.commands.registerCommand('worktree.create', () => createWorktree(context))];
}
