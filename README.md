# `vscode-worktree`

The `vscode-worktree` extension helps you manage git worktree in its own window. The extension can create a worktree from an existing local branch, or create a new worktree with a new branch out of an existing branch.
The one-window-per-worktree model helps you work on multiple different branches in parallel.

The full specification lives in [docs/design.md](docs/design.md).

## Features

- **Create** a worktree from an existing local branch, a new branch, or a remote
  branch (`--track -b`). Leave the new branch name empty and git names the
  branch after the worktree directory, starting from the current HEAD.
  New worktrees land in `worktree.baseDirectory`, a sibling of the repository
  by default, so they stay out of its file watchers, search and `.gitignore`.
- **Open** an existing worktree in a new window or in the current one. VS Code focuses a
  window that already has the folder open instead of opening a second copy.
- **Delete** a worktree, including the one the current window has open: the
  extension confirms up front, checks for uncommitted changes, disposes
  terminals inside the worktree, removes it, optionally deletes the branch, and
  only then closes the window.
- **Open a terminal** in any worktree without leaving the window.
- **Sidebar** listing every worktree of the repository with its branch, path,
  HEAD, and lock or prune state. It refreshes when git is used outside VS Code,
  because a watcher on `<common-dir>/worktrees/**` and window focus both
  trigger a reload.
- Works from any worktree of the repository, not only the main checkout: the
  repository is identified by `git rev-parse --git-common-dir`.

## Settings

| Setting | Type | Default | Purpose |
|---|---|---|---|
| `worktree.baseDirectory` | string | `${repoParent}/${repoName}.worktrees` | Where new worktrees are created. Supports `${repoRoot}`, `${repoParent}`, `${repoName}` |
| `worktree.openBehavior` | `newWindow` \| `currentWindow` \| `ask` | `newWindow` | What Open Worktree and the open after create do |
| `worktree.deleteBranchOnRemove` | `ask` \| `always` \| `never` | `ask` | Branch cleanup after a worktree is removed |
| `worktree.openAfterCreate` | boolean | `true` | Open the new worktree after creating it |

The `git.path` setting of the built-in Git extension is honoured.

## Requirements

git 2.7 or newer on `PATH`, or `git.path` pointing at it.

## Development

```sh
npm install
npm run build          # esbuild bundle to dist/extension.js
npm run watch          # rebuild on change
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm test               # vitest unit tests
npm run test:integration  # @vscode/test-electron smoke test against a real repo
npm run package        # vsce package (optional)
```

Press <kbd>F5</kbd> with the **Run Extension** launch configuration to try it in
an Extension Development Host.
