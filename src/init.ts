import { createInterface } from 'node:readline'
import { hashPassword } from './auth/password.js'
import { CONFIG_FILE, loadConfigFile, writeConfigFile } from './configFile.js'

const MIN_PASSWORD_LENGTH = 8

// readline 没有公开的静音开关，覆盖内部写出方法是通行做法：提示语自己先打，
// 之后所有回显吞掉，密码不会留在终端 scrollback / tmux 历史里
function ask(query: string, hidden = false): Promise<string> {
  process.stdout.write(query)
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  if (hidden) {
    ;(rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {}
  }
  return new Promise((resolve, reject) => {
    let answered = false
    rl.question('', (answer) => {
      answered = true
      if (hidden) process.stdout.write('\n')
      rl.close()
      resolve(answer)
    })
    // close 在 question 回调里同步触发，得先标记已作答，否则每次都被判成取消
    rl.on('close', () => {
      if (!answered) reject(new Error('已取消'))
    })
  })
}

export async function runInit(passwordStdin = false): Promise<number> {
  try {
    return passwordStdin ? await initFromStdin() : await init()
  } catch (err) {
    // Ctrl-C / Ctrl-D 走到这里，给一行话而不是堆栈
    console.error(`\n${err instanceof Error ? err.message : err}`)
    return 1
  }
}

// 非交互路径（CI、配置管理、AI agent 代跑）：密码走 stdin 而不是命令行参数，
// 后者会进 shell 历史，也能被同机器上的 ps 看到。无覆盖确认——非交互场景
// 反复执行应当幂等。
async function initFromStdin(): Promise<number> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  // 只剥掉结尾换行（echo/printf 常见），密码本身的空白保留
  const password = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '')

  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`密码至少 ${MIN_PASSWORD_LENGTH} 个字符——它是这个服务唯一的认证。`)
    return 1
  }

  writeConfigFile(CONFIG_FILE, {
    ...loadConfigFile(CONFIG_FILE),
    TMUX_WEBUI_PASSWORD_HASH: await hashPassword(password),
  })
  console.log(`已写入 ${CONFIG_FILE}（权限 0600）`)
  return 0
}

async function init(): Promise<number> {
  if (!process.stdin.isTTY) {
    console.error(
      'init 需要交互式终端。非交互环境请用: ' +
        "printf '%s' \"$PASSWORD\" | tmux-webui init --password-stdin",
    )
    return 1
  }

  const existing = loadConfigFile(CONFIG_FILE)
  if (existing.TMUX_WEBUI_PASSWORD_HASH) {
    const yes = await ask(`${CONFIG_FILE} 已有密码，覆盖？[y/N] `)
    if (yes.trim().toLowerCase() !== 'y') {
      console.log('已取消，配置未改动。')
      return 0
    }
  }

  const password = await ask('设置访问密码: ', true)
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`密码至少 ${MIN_PASSWORD_LENGTH} 个字符——它是这个服务唯一的认证。`)
    return 1
  }
  if (password !== (await ask('再输一次确认: ', true))) {
    console.error('两次输入不一致。')
    return 1
  }

  writeConfigFile(CONFIG_FILE, {
    ...existing,
    TMUX_WEBUI_PASSWORD_HASH: await hashPassword(password),
  })

  console.log(`\n已写入 ${CONFIG_FILE}（权限 0600）`)
  console.log('启动: tmux-webui        然后打开 http://127.0.0.1:8090')
  console.log('提示: 这是网页版 shell，只监听本机；远程访问请走 Tailscale 或带 TLS 的反代。')
  return 0
}
