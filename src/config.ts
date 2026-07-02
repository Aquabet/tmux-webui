export interface Config {
  host: string
  port: number
  passwordHash: string
  socketName?: string
  sessionTtlMs: number
  cookieSecure: boolean
}

function parsePositiveInt(
  name: string,
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined) {
    return fallback
  }
  const num = Number(raw)
  if (!Number.isInteger(num) || num <= 0) {
    throw new Error(`${name} 必须是正整数，收到: ${raw}`)
  }
  return num
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const passwordHash = env.TMUX_WEBUI_PASSWORD_HASH
  if (!passwordHash) {
    throw new Error(
      'TMUX_WEBUI_PASSWORD_HASH 未设置。请运行 `npm run hash-password` 生成后再启动。',
    )
  }
  return {
    host: env.TMUX_WEBUI_HOST ?? '127.0.0.1',
    port: parsePositiveInt('TMUX_WEBUI_PORT', env.TMUX_WEBUI_PORT, 8090),
    passwordHash,
    socketName: env.TMUX_WEBUI_SOCKET || undefined,
    sessionTtlMs: parsePositiveInt(
      'TMUX_WEBUI_SESSION_TTL_MS',
      env.TMUX_WEBUI_SESSION_TTL_MS,
      7 * 24 * 3600 * 1000,
    ),
    cookieSecure: env.TMUX_WEBUI_COOKIE_SECURE === 'true',
  }
}
