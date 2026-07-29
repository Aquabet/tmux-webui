import { bindWarnings, loadConfig } from './config.js'
import { loadEnvFile } from './env.js'
import { createAppServer } from './server.js'
import { createTmuxExec } from './tmux/exec.js'
import { cleanupOrphanViews } from './tmux/view.js'

// 真实环境变量优先于 .env 文件（.env 路径相对启动目录）
const config = loadConfig({ ...loadEnvFile('.env'), ...process.env })
for (const warning of bindWarnings(config)) {
  console.warn(`⚠️  ${warning}`)
}

const exec = createTmuxExec(config.socketName)

await cleanupOrphanViews(exec).catch(() => undefined)
setInterval(() => void cleanupOrphanViews(exec).catch(() => undefined), 10 * 60_000)

const server = createAppServer(config)
server.listen(config.port, config.host, () => {
  console.log(`tmux-webui 已启动: http://${config.host}:${config.port}`)
})
