import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // db.ts opens the database the moment it's imported, so every test file
    // runs in its own process with its own throwaway data folder (see setup.ts).
    // Separate processes also suit better-sqlite3, a native module.
    pool: 'forks',
    globalSetup: ['test/globalSetup.ts'],
    setupFiles: ['test/setup.ts'],
  },
});
