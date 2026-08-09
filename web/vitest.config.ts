import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: '../coverage/web',
      include: ['src/**/*.{ts,tsx}'],
      thresholds: {
        statements: 56,
        branches: 58,
        functions: 66,
        lines: 57,
      },
    },
  },
})
