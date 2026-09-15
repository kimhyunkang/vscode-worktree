import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { runTests } from '@vscode/test-electron';

/** Creates a repository with one commit and one linked worktree, using real git. */
function createFixtureRepo(): { repo: string; worktree: string } {
  // realpath: on macOS the temp dir is a symlink and git reports the real path.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-worktree-it-')));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  };
  git('init', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(repo, 'README.md'), '# fixture\n');
  git('add', 'README.md');
  git('commit', '-m', 'initial commit');
  const worktree = path.join(root, 'repo.worktrees', 'fix-login');
  git('worktree', 'add', '-b', 'fix-login', worktree, 'HEAD');
  return { repo, worktree };
}

/**
 * A VS Code integrated terminal exports VSCODE_* and ELECTRON_RUN_AS_NODE.
 * Inherited by the test instance they make it run the parent's entry point
 * instead of the workbench, so they are removed before launching.
 */
function scrubHostEnvironment(): void {
  delete process.env.ELECTRON_RUN_AS_NODE;
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('VSCODE_')) {
      delete process.env[key];
    }
  }
}

async function main(): Promise<void> {
  scrubHostEnvironment();
  const extensionDevelopmentPath = path.resolve(__dirname, '../../..');
  const extensionTestsPath = path.resolve(__dirname, './suite/index');
  const fixture = createFixtureRepo();

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      '--disable-extensions',
      '--disable-workspace-trust',
      // Folder to open, passed as a URI: a bare path in launchArgs is taken as
      // the Electron entry script by the VS Code 1.137 launcher.
      `--folder-uri=${pathToFileURL(fixture.repo).toString()}`
    ],
    extensionTestsEnv: {
      WORKTREE_TEST_REPO: fixture.repo,
      WORKTREE_TEST_WORKTREE: fixture.worktree
    }
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
