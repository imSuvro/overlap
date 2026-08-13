import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node-environment suites by default; the web package opts into jsdom per-file
    // with a `@vitest-environment` docblock so the fast suites stay fast.
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/*/src/**/*.ts'],
      // `index.ts` is re-exports and `types.ts` is type-only — both compile to nothing, so
      // including them measures the bundler rather than the tests.
      exclude: ['**/*.test.ts', '**/index.ts', '**/types.ts'],
      // Thresholds are scoped to the two zero-dependency packages where the logic is
      // subtle and small enough that high coverage is meaningful. See docs/TEST-STRATEGY.md
      // for why there is no single global number.
      thresholds: {
        'packages/time/src/**': { statements: 95, branches: 90, functions: 95, lines: 95 },
        'packages/crdt/src/**': { statements: 95, branches: 90, functions: 95, lines: 95 },
      },
    },
  },
});
