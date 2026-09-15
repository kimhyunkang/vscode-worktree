# Working in this repository

TLDR: [docs/design.md](docs/design.md) is the specification, and the code follows
it. Read the section covering your change before you edit, and update the
document when your change contradicts it. Run the five gates below before you
call anything done.

## Gates

```sh
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run build       # esbuild bundle to dist/extension.js
npm test            # vitest unit tests
npm run test:integration   # @vscode/test-electron against a real temp repo
```

The integration run downloads VS Code into `.vscode-test/`, about 300 MB. That
directory is gitignored and safe to delete.

## Invariants

- **Git is the only state**. The extension caches the worktree list in
  `WorktreeModel` and nowhere else. If you need a new fact, read it from git.
- **Every git call goes through `GitCli`**. Do not call `execFile` outside
  [src/git.ts](src/git.ts), and never build a shell string. Arguments are an
  array so paths with spaces work on Windows.
- **Pure logic stays free of `vscode`**. [src/porcelain.ts](src/porcelain.ts) and
  [src/paths.ts](src/paths.ts) import nothing from the extension API. Command
  files keep their decision logic in exported functions that take plain values,
  which is what the unit tests call.
- **Hand-written test doubles only**. `FakeGitCli` in
  [src/test/fakes.ts](src/test/fakes.ts) records `calls: string[][]`. Add options
  to it rather than reaching for a mocking library.
- **Unit tests resolve `vscode` to a stub**, [src/test/vscode.ts](src/test/vscode.ts),
  through an alias in [vitest.config.ts](vitest.config.ts). If a tested path
  starts using a new API, extend the stub.
- **Compare paths with `samePath`**, which is case-insensitive everywhere except
  linux. A raw `===` on two paths is a bug on macOS and Windows.
- **Match git messages under `LC_ALL=C`**. [src/git.ts](src/git.ts) pins the
  locale so error text is stable. Keep the matches narrow, because
  `already exists` alone matches both a clashing directory and a clashing branch.

## Things that break quietly

- **`contextValue` and `package.json` drift apart**. `contextValueFor` in
  [src/tree.ts](src/tree.ts) produces `main`, `current`, `other`, `prunable` and
  `bare`. Every `when` clause in `view/item/context` lists the values it applies
  to. Add a value in one place and the menus silently go wrong.
- **A `prunable` worktree has no directory**. Open, terminal, copy path and
  reveal all fail on it. Only Prune belongs in its menu.
- **The `default` create choice means "let git name the branch"**. It is reached
  by leaving the new branch name empty, not by selecting nothing. A QuickPick
  always has an active item, so there is no empty selection to detect.
- **Deleting the current worktree closes the window**. Ask every question before
  the first git command runs, and make each prompt modal. The flow is in
  [src/commands/remove.ts](src/commands/remove.ts).
- **Free text in the branch QuickPick skips `validateInput`**. Validate the name
  in `resolveChoice` before git runs.

## Open items

- The claim that `vscode.openFolder` focuses a window already holding the folder
  is unverified on macOS, Windows and Linux. Confirm it before the README states
  it as fact.
- `publisher` in [package.json](package.json) is `publisher-placeholder`. Set a
  real one before packaging.
- Press <kbd>F5</kbd> with the **Run Extension** configuration to exercise the
  flows by hand. No test covers the QuickPick and InputBox sequences.
