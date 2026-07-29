import { CONFIG_FILE } from './configFile.js'

export type Command =
  | { kind: 'serve' }
  | { kind: 'init'; passwordStdin: boolean }
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'unknown'; arg: string }

export const HELP_TEXT = `tmux-webui —— 浏览器里的 tmux

用法:
  tmux-webui            启动服务（默认 http://127.0.0.1:8090）
  tmux-webui init       交互设置访问密码，写入 ${CONFIG_FILE}
  tmux-webui init --password-stdin
                        从标准输入读密码（非交互环境用，密码不进 shell 历史）
                        例: printf '%s' "$PW" | tmux-webui init --password-stdin
  tmux-webui help       显示本帮助
  tmux-webui version    显示版本号

配置优先级（高到低）: 环境变量 > 启动目录下 .env > ${CONFIG_FILE}

常用环境变量:
  TMUX_WEBUI_PASSWORD_HASH   访问密码的 bcrypt 哈希（必填，由 init 生成）
  TMUX_WEBUI_HOST            监听地址，默认 127.0.0.1
  TMUX_WEBUI_PORT            监听端口，默认 8090
  TMUX_WEBUI_SOCKET          tmux socket 名（-L），默认用默认 socket
  TMUX_WEBUI_COOKIE_SECURE   反代 TLS 后设为 true

警告: 这是网页版 shell，切勿直接暴露到公网。`

export function parseArgs(argv: string[]): Command {
  const [arg, ...rest] = argv
  if (arg === undefined) return { kind: 'serve' }
  if (arg === 'init') {
    if (rest.length === 0) return { kind: 'init', passwordStdin: false }
    if (rest.length === 1 && rest[0] === '--password-stdin') {
      return { kind: 'init', passwordStdin: true }
    }
    return { kind: 'unknown', arg: rest[0] as string }
  }
  if (arg === 'help' || arg === '--help' || arg === '-h') return { kind: 'help' }
  if (arg === 'version' || arg === '--version' || arg === '-v') return { kind: 'version' }
  return { kind: 'unknown', arg }
}
