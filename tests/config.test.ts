import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'

describe('loadConfig', () => {
  it('缺少 PASSWORD_HASH 时抛错', () => {
    expect(() => loadConfig({})).toThrow(/TMUX_WEBUI_PASSWORD_HASH/)
  })

  it('只给必填项时返回默认值', () => {
    const c = loadConfig({ TMUX_WEBUI_PASSWORD_HASH: '$2a$10$x' })
    expect(c).toEqual({
      host: '127.0.0.1',
      port: 8090,
      passwordHash: '$2a$10$x',
      socketName: undefined,
      sessionTtlMs: 7 * 24 * 3600 * 1000,
      cookieSecure: false,
    })
  })

  it('读取全部环境变量覆盖', () => {
    const c = loadConfig({
      TMUX_WEBUI_PASSWORD_HASH: 'h',
      TMUX_WEBUI_HOST: '0.0.0.0',
      TMUX_WEBUI_PORT: '9000',
      TMUX_WEBUI_SOCKET: 'testsock',
      TMUX_WEBUI_SESSION_TTL_MS: '1000',
      TMUX_WEBUI_COOKIE_SECURE: 'true',
    })
    expect(c.host).toBe('0.0.0.0')
    expect(c.port).toBe(9000)
    expect(c.socketName).toBe('testsock')
    expect(c.sessionTtlMs).toBe(1000)
    expect(c.cookieSecure).toBe(true)
  })
})
