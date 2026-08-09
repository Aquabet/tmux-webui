#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HELP_TEXT, parseArgs } from './cli.js'
import { bindWarnings, loadConfig, type Config } from './config.js'
import { CONFIG_FILE, loadConfigFile } from './configFile.js'
import { loadEnvFile } from './env.js'
import { runInit } from './init.js'
import { createAppServer } from './server.js'
import { createTmuxExec, TmuxError } from './tmux/exec.js'
import { cleanupOrphanViews } from './tmux/view.js'

function version(): string {
  const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../package.json')
  return JSON.parse(readFileSync(pkg, 'utf8')).version
}

// 优先级：环境变量 > 启动目录 .env > 全局 config.json
// （.env 相对启动目录，npx 场景下多半不存在，此时全局配置兜底）
async function serve(): Promise<void> {
  let config: Config
  try {
    config = loadConfig({
      ...loadConfigFile(CONFIG_FILE),
      ...loadEnvFile('.env'),
      ...process.env,
    })
  } catch (err) {
    // 配置错误是用户的事，不是 bug——给一行能照做的话，别甩堆栈
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  }
  for (const warning of bindWarnings(config)) {
    console.warn(`⚠️  ${warning}`)
  }

  const exec = createTmuxExec(config.socketName)

  // 没装 tmux 就没法工作，启动时直接说清楚，而不是等用户登录后每个操作都失败。
  // -V 不需要 tmux server 在跑，所以「没启动 tmux」的正常情况不会被误伤。
  try {
    await exec(['-V'])
  } catch (err) {
    if (err instanceof TmuxError && err.code === 'NOT_INSTALLED') {
      console.error(err.message)
      process.exit(1)
    }
    // 其它异常（超时等）不拦启动，让服务跑起来再按请求报错
  }

  await cleanupOrphanViews(exec).catch(() => undefined)
  setInterval(() => void cleanupOrphanViews(exec).catch(() => undefined), 10 * 60_000)

  const server = createAppServer(config)
  // listen 失败会以 'error' 事件抛出，没人接就是一屏堆栈；端口被占是最常见的一种
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `端口 ${config.port} 已被占用。换一个端口（TMUX_WEBUI_PORT=${config.port + 1}），` +
          '或先停掉占用它的进程。',
      )
    } else if (err.code === 'EACCES') {
      console.error(`没有权限监听 ${config.host}:${config.port}。1024 以下的端口需要特权。`)
    } else {
      console.error(`监听 ${config.host}:${config.port} 失败: ${err.message}`)
    }
    process.exit(1)
  })
  server.listen(config.port, config.host, () => {
    console.log(`tmux-webui 已启动: http://${config.host}:${config.port}`)
  })
}

const command = parseArgs(process.argv.slice(2))
switch (command.kind) {
  case 'serve':
    await serve()
    break
  case 'init':
    process.exit(await runInit(command.passwordStdin))
    break
  case 'help':
    console.log(HELP_TEXT)
    break
  case 'version':
    console.log(version())
    break
  case 'unknown':
    console.error(`未知参数: ${command.arg}\n`)
    console.error(HELP_TEXT)
    process.exit(1)
}
