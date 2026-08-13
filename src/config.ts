import { homedir } from 'node:os'
import path from 'node:path'

export interface Config {
  host: string
  port: number
  passwordHash: string
  socketName?: string
  sessionTtlMs: number
  cookieSecure: boolean
  sessionFile: string
  uploadDir: string
  uploadRetentionMs: number
  uploadMaxBytes: number
  updateCheck: boolean
  usageProviders: string[]
}

function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '::1' || /^127\./.test(host)
}

// 这个服务等于「网页版 shell」，绑到非回环地址就是把机器暴露出去。
// 启动时把风险明说，而不是让人从文档里读到。
export function bindWarnings(config: Config): string[] {
  if (isLoopback(config.host)) {
    return []
  }
  const warnings = [
    `监听在 ${config.host}——本机以外可访问。这是网页版 shell，拿到密码即等于拿到你的账号权限。` +
      `请勿直接暴露到公网：用 Tailscale/WireGuard，或反代加 TLS 并做访问控制。`,
  ]
  if (!config.cookieSecure) {
    warnings.push(
      'TMUX_WEBUI_COOKIE_SECURE 未开启：会话 cookie 会走明文 HTTP 传输，可被同网络嗅探。' +
        '已启用 HTTPS 时请设为 true。',
    )
  }
  return warnings
}

function parsePositiveInt(name: string, raw: string | undefined, fallback: number): number {
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
      'TMUX_WEBUI_PASSWORD_HASH 未设置：还没有设访问密码。请先运行 `tmux-webui init`。',
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
    // 空字符串表示禁用落盘（仅内存），测试用
    sessionFile:
      env.TMUX_WEBUI_SESSION_FILE ?? path.join(homedir(), '.tmux-webui', 'sessions.json'),
    uploadDir: env.TMUX_WEBUI_UPLOAD_DIR ?? path.join(homedir(), '.tmux-webui', 'uploads'),
    uploadRetentionMs: parsePositiveInt(
      'TMUX_WEBUI_UPLOAD_RETENTION_MS',
      env.TMUX_WEBUI_UPLOAD_RETENTION_MS,
      7 * 24 * 3600 * 1000,
    ),
    uploadMaxBytes: parsePositiveInt(
      'TMUX_WEBUI_UPLOAD_MAX_BYTES',
      env.TMUX_WEBUI_UPLOAD_MAX_BYTES,
      512 * 1024 * 1024,
    ),
    // 唯一的对外网络请求（查 GitHub 最新 release），设 false 可完全关掉
    updateCheck: env.TMUX_WEBUI_UPDATE_CHECK !== 'false',
    // 计划用量 provider allowlist：默认空 = 功能关闭。这是文件系统层面的
    // 同意机制——未列出的 provider，服务不会读取它的数据目录
    usageProviders: (env.TMUX_WEBUI_USAGE_PROVIDERS ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  }
}
