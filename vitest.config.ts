import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // The real vscode module only exists inside the extension host, so unit
      // tests resolve it to a hand-written stub.
      vscode: fileURLToPath(new URL('./src/test/vscode.ts', import.meta.url))
    }
  },
  test: {
    include: ['src/test/unit/**/*.test.ts'],
    environment: 'node'
  }
});
