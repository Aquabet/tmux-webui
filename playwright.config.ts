import { defineConfig } from '@playwright/test'

// bcrypt('secret')，现场用 `npm run hash-password -- secret` 生成
const E2E_HASH = '$2a$10$elNf.BSxNFDVoPrIg1X17uyOQH5f2L/q/KglrgWMXRd5qcpkBuUje'

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:18090' },
  webServer: {
    command: 'npm run build && node dist/main.js',
    url: 'http://127.0.0.1:18090',
    env: {
      TMUX_WEBUI_PASSWORD_HASH: E2E_HASH,
      TMUX_WEBUI_PORT: '18090',
      TMUX_WEBUI_SOCKET: 'webui-e2e',
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
