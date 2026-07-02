export interface Config {
  host: string
  port: number
  passwordHash: string
  socketName?: string
  sessionTtlMs: number
  cookieSecure: boolean
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
    port: Number(env.TMUX_WEBUI_PORT ?? 8090),
    passwordHash,
    socketName: env.TMUX_WEBUI_SOCKET || undefined,
    sessionTtlMs: Number(env.TMUX_WEBUI_SESSION_TTL_MS ?? 7 * 24 * 3600 * 1000),
    cookieSecure: env.TMUX_WEBUI_COOKIE_SECURE === 'true',
  }
}
