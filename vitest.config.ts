import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage/backend',
      include: ['src/**/*.ts'],
      thresholds: {
        statements: 83,
        branches: 82,
        functions: 80,
        lines: 84,
      },
    },
  },
})
