import { loadConfig } from './config.js'
import { createAppServer } from './server.js'
import { createTmuxExec } from './tmux/exec.js'
import { cleanupOrphanViews } from './tmux/view.js'

const config = loadConfig(process.env)
const exec = createTmuxExec(config.socketName)

await cleanupOrphanViews(exec).catch(() => undefined)
setInterval(() => void cleanupOrphanViews(exec).catch(() => undefined), 10 * 60_000)

const server = createAppServer(config)
server.listen(config.port, config.host, () => {
  console.log(`tmux-webui 已启动: http://${config.host}:${config.port}`)
})
