# Git Worktree extension for VS Code

TLDR: one VS Code window per worktree. The extension shells out to `git` for
every operation, shows all worktrees of the current repository in a sidebar,
and drives three flows from there: create, open, delete. Terminals need no
special handling in the primary model, so the terminal feature becomes a
per-worktree "Open Terminal" action.

## Problem

Working on several branches at once means either stashing and switching in one
checkout, or managing `git worktree` by hand in a shell and then opening each
directory in VS Code manually. VS Code's built-in Git extension lists no
worktrees and exposes no worktree API. The gap is the glue: create a worktree
in a predictable place, open it in the right window, and clean it up later.

## Goals

- Create a worktree from an existing branch, a new branch, or the current HEAD.
- Open a worktree in a new window by default, or in the current window on
  request.
- Show every worktree of the repository in a sidebar with create, open and
  delete actions.
- Open a terminal whose working directory is a chosen worktree.
- Work from any worktree of the repository, not only the main checkout.

Non-goals for v1: submodules, bare-repository-first layouts beyond listing them,
syncing untracked files such as `.env` between worktrees, running install
scripts after creation. Those are listed under Later.

## Model

**One window per worktree**. A VS Code window has one workspace folder, and
that folder is a worktree. The extension never changes which worktree a
window points at except through the explicit "open in current window" action,
which reloads the window on the new folder.

**The repository is discovered from the workspace folder**. On activation the
extension runs `git rev-parse --git-common-dir` in the workspace folder. The
common dir identifies the repository regardless of which worktree is open, so
the sidebar shows the same list from every window of that repository.

**Git is the source of truth**. The extension keeps no state of its own about
worktrees. `git worktree list --porcelain` is parsed on every refresh. A
`FileSystemWatcher` on `<common-dir>/worktrees/**` triggers a refresh when any
process, including a shell outside VS Code, adds or removes a worktree. Window
focus and the completion of the extension's own git commands also trigger a
refresh.

**No dependency on the built-in Git extension API**. It exposes repositories
and branches but nothing about worktrees. Shelling out with `execFile` and an
argument array is simpler and avoids quoting bugs on paths with spaces. The
`git.path` setting is honoured so users with a custom git binary keep working.

## Features

### Create a worktree

Command: `worktree.create`. Reachable from the command palette and the sidebar
title bar.

Flow:

1. If the window has several workspace folders that belong to different
   repositories, a QuickPick chooses the repository first.
2. A QuickPick lists branches and accepts free text. Items, in order:
   - `$(add) Create new branch from <current branch>`
   - Local branches not checked out anywhere, with the short commit subject as
     description.
   - Local branches already checked out in a worktree, with description
     `checked out at <path>`. Choosing one opens that worktree instead of
     failing, because git refuses to check out a branch twice.
   - Remote branches with no local counterpart, labelled `origin/<name>`.
     Choosing one creates a local tracking branch of the same name.
   - Typed text that matches no branch becomes `Create branch '<text>'`.
3. If a new branch is being created, an InputBox asks for its name. The
   default is empty. Validation rejects names that `git check-ref-format
   --branch` rejects and names that already exist.
4. An InputBox asks for the worktree directory name. The default is the branch
   name with `/` replaced by `-`. The full path is shown as the prompt so the
   user sees where it lands.
5. The extension runs the matching git command under `withProgress`:
   - Existing local branch: `git worktree add <path> <branch>`
   - New branch: `git worktree add -b <branch> <path> HEAD`
   - Remote branch: `git worktree add --track -b <name> <path> origin/<name>`
   - No branch chosen at all, that is the user accepted step 2 with nothing
     selected and nothing typed: `git worktree add <path>`. Git then creates a
     branch named after the directory, starting from the current HEAD. That is
     the "based on the current branch" case, and it uses git's own default
     rather than inventing one.
6. The new worktree opens according to the open behaviour below.

The base directory for new worktrees is the setting `worktree.baseDirectory`,
default `${repoParent}/${repoName}.worktrees`. For a repository at
`~/project/skool-be`, a worktree for `fix-login` lands at
`~/project/skool-be.worktrees/fix-login`. Placing worktrees beside the
repository rather than inside it keeps them out of the repository's own file
watchers, search, and `.gitignore`. Supported variables: `${repoRoot}`,
`${repoParent}`, `${repoName}`.

### Open a worktree

Commands: `worktree.open`, `worktree.openInNewWindow`,
`worktree.openInCurrentWindow`.

`worktree.open` reads the setting `worktree.openBehavior`, one of `newWindow`
(default), `currentWindow` or `ask`. The two explicit commands ignore the
setting. Both call:

```ts
vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow })
```

**Already open in another window**. VS Code's main process checks whether any
window already has the requested folder open before creating a new window. If
one does, it focuses that window instead. So the optional "go to that window"
behaviour falls out of `vscode.openFolder` with no extra code. The prototype
must confirm this on macOS, Windows and Linux before the README claims it.

Showing an "open" badge in the sidebar is a different problem, because the
extension API cannot enumerate windows. That is under Later.

### Terminal in a worktree

Command: `worktree.openTerminal`, an inline action on every sidebar item.

```ts
vscode.window.createTerminal({ name: branch, cwd: worktreePath })
```

In the one-window-per-worktree model a plain new terminal already starts in
the current worktree, because VS Code defaults the terminal cwd to the
workspace folder. The extension does not override `terminal.integrated.cwd`.
The added value is opening a terminal in a different worktree without leaving
the window, for example to run tests on a sibling branch.

### Sidebar

An Activity Bar container `Worktrees` with its own icon, holding one TreeView.

Each item is a worktree:

| Field | Content |
|---|---|
| label | Branch name, or `(detached) <short sha>` |
| description | Path relative to `worktree.baseDirectory`, or the absolute path if outside it |
| icon | `$(repo)` for the main worktree, `$(git-branch)` otherwise, `$(warning)` when prunable |
| tooltip | Absolute path, HEAD sha, locked reason, prunable reason |
| contextValue | `main`, `current`, `other`, `prunable`. The `current` value marks the worktree this window has open |

Menus:

- View title: Create, Refresh.
- Inline on every item: Open in New Window, Open Terminal.
- Context menu on `other` and `current`: Open in Current Window, Delete, Copy
  Path, Reveal in Finder or Explorer.
- Context menu on `main`: the same minus Delete.
- Context menu on `prunable`: Prune. This runs `git worktree prune`.

A `viewsWelcome` entry covers the empty states: no folder open, folder is not a
git repository, git not found on `PATH`.

### Delete a worktree

Command: `worktree.delete`. Disabled on the main worktree because git refuses
to remove it. Enabled on every other worktree, including the one open in the
current window.

Flow for a worktree that is not the current one:

1. Modal warning: `Delete worktree '<branch>'?` with the absolute path as
   detail and a single destructive button `Delete`.
2. `git worktree remove <path>`.
3. If git exits with `contains modified or untracked files`, a second modal
   offers `Force Delete` and states that uncommitted changes are lost. Then
   `git worktree remove --force <path>`.
4. If the worktree had a branch, the setting `worktree.deleteBranchOnRemove`
   decides what happens next. `ask` (default) shows a non-modal prompt with
   `Delete branch`. `always` and `never` skip the prompt. Deletion runs `git
   branch -d <name>`. If git reports the branch is not fully merged, one more
   prompt offers `git branch -D`.

Flow for the current worktree. The window closes at the end, so every question
is asked up front and every prompt is modal:

1. Modal warning: `Delete worktree '<branch>' and close this window?` with the
   absolute path as detail. Buttons: `Delete`, and `Delete and Delete Branch`
   when the worktree has a branch and `worktree.deleteBranchOnRemove` is `ask`.
   With `always` or `never` only `Delete` is offered and the setting decides.
2. Dirty check before removal: `git status --porcelain` in the worktree. If
   output is non-empty, a second modal offers `Force Delete` and states that
   uncommitted changes are lost. Checking first avoids a failed remove that
   leaves the window half torn down.
3. Dispose every terminal whose cwd is inside the worktree. Shells holding the
   directory as cwd block removal on Windows.
4. `git worktree remove <path>`, with `--force` if step 2 said so. The command
   runs with cwd set to the common dir, not the worktree being removed.
5. Branch deletion if chosen in step 1. `git branch -d <name>`, then a modal
   offering `git branch -D` if the branch is not fully merged.
6. `workbench.action.closeWindow`. If any git step failed, the window stays
   open and the error is shown instead.

## Settings

| Setting | Type | Default | Purpose |
|---|---|---|---|
| `worktree.baseDirectory` | string | `${repoParent}/${repoName}.worktrees` | Where new worktrees are created |
| `worktree.openBehavior` | `newWindow` / `currentWindow` / `ask` | `newWindow` | What `worktree.open` and post-create open do |
| `worktree.deleteBranchOnRemove` | `ask` / `always` / `never` | `ask` | Branch cleanup after worktree removal |
| `worktree.openAfterCreate` | boolean | `true` | Skip opening if the user only wants the directory |

## Code layout

```
package.json            contributes: commands, viewsContainers, views, menus,
                        viewsWelcome, configuration
src/extension.ts        activate(): build GitCli, WorktreeModel, TreeProvider,
                        register commands
src/git.ts              GitCli: run(args, cwd) via execFile, plus typed
                        wrappers: listWorktrees, listBranches, addWorktree,
                        removeWorktree, prune, commonDir, currentBranch
src/porcelain.ts        Pure parser for `git worktree list --porcelain` and
                        `git for-each-ref` output. No I/O.
src/model.ts            WorktreeModel: repository discovery, cached list,
                        onDidChange event, file watcher, refresh debounce
src/tree.ts             TreeDataProvider and WorktreeItem
src/commands/           create.ts, open.ts, remove.ts, terminal.ts, prune.ts
src/paths.ts            baseDirectory variable expansion, name sanitising
src/test/unit/          vitest: porcelain parser, path expansion, name
                        validation. Fixture strings, no git.
src/test/integration/   @vscode/test-electron: temp repo created with real
                        git, exercises create/list/remove end to end
```

Toolchain: TypeScript, esbuild for a single bundle, `@types/vscode` matching
`engines.vscode` of `^1.90.0`. Git doubles are hand-written fakes implementing
the `GitCli` interface, not generated mocks.

## Porcelain parsing

`git worktree list --porcelain` emits blank-line-separated stanzas:

```
worktree /Users/me/project/skool-be
HEAD 3f2a9c1e...
branch refs/heads/main

worktree /Users/me/project/skool-be.worktrees/fix-login
HEAD 91b0d4f2...
branch refs/heads/fix-login
locked reason text

worktree /Users/me/project/skool-be.worktrees/spike
HEAD 77e1aa00...
detached
prunable gitdir file points to non-existent location
```

A stanza may also be a single `bare` line after `worktree`. The parser maps
each stanza to `{ path, head, branch?, detached, bare, locked?, prunable? }`.
The first stanza is the main worktree. Paths in `-z` mode are NUL-terminated
and the parser uses `--porcelain -z` to survive newlines in paths.

## Edge cases

- **Branch checked out elsewhere**. Detected before calling git. The QuickPick
  routes the choice to "open that worktree".
- **Branch names with `/`**. Directory name uses `-` in place of `/` so
  `feature/login` becomes `feature-login`. The branch keeps its real name.
- **Target directory exists**. Git fails with `already exists`. The extension
  surfaces that message and offers to pick another name.
- **Multi-root workspace**. Repository chosen from the active editor's folder
  when there is one, otherwise a QuickPick.
- **Bare main repository**. Listed with label `(bare)` and no open or delete
  actions.
- **Git not installed or too old**. `git worktree list --porcelain` needs git
  2.7. The welcome view names the requirement when the version check fails.
- **Windows**. Paths pass through `execFile` arguments, never a shell string.
  Reveal action uses `revealFileInOS`.
- **Slow git**. Every mutating command runs under `withProgress` in the
  notification area with the command shown.

## Later

Ordered by how often the need comes up in practice.

1. **Copy untracked files into a new worktree**. Setting
   `worktree.filesToCopy: string[]`, default empty. Typical value `[".env",
   ".env.local"]`. Copied from the worktree the command ran in.
2. **Post-create command**. Setting `worktree.postCreateCommand`, run in a new
   terminal in the new worktree. Typical value `npm install`.
3. **"Open in another window" badge**. Each extension instance writes
   `<globalStorage>/windows/<hash-of-path>.json` with its PID on activation and
   removes it on deactivation. The tree checks PID liveness to survive crashes.
   Heuristic only, so it drives a badge and never blocks an action.
4. **Status bar item** showing the current branch and worktree count, clicking
   opens the create QuickPick.
5. **Worktree from a pull request number**, using `gh pr checkout` semantics.

## Decisions

Settled on 2026-09-15.

1. **Base directory default** is the sibling directory `../<repo>.worktrees/`,
   configurable through `worktree.baseDirectory`. The in-repo alternative
   `<repo>/.worktrees/` was rejected because it needs a `.gitignore` entry and
   doubles file watcher load.
2. **Empty selection on create** uses git's default. `git worktree add <path>`
   creates a branch named after the directory from the current HEAD. A detached
   worktree was rejected because it makes the first commit awkward.
3. **Sidebar placement** is an Activity Bar container of its own, not a section
   inside Source Control.
4. **Deleting the current worktree** is allowed. The extension confirms, removes
   the worktree, then closes the window. The flow is under Delete a worktree.
