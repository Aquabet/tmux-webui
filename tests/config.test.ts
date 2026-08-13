import { homedir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { bindWarnings, loadConfig, type Config } from '../src/config.js'

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
      sessionFile: path.join(homedir(), '.tmux-webui', 'sessions.json'),
      uploadDir: path.join(homedir(), '.tmux-webui', 'uploads'),
      uploadRetentionMs: 7 * 24 * 3600 * 1000,
      uploadMaxBytes: 512 * 1024 * 1024,
      updateCheck: true,
      usageProviders: [],
    })
  })

  it('USAGE_PROVIDERS 逗号分隔解析，默认空（功能关闭）', () => {
    const at = (v?: string) =>
      loadConfig({
        TMUX_WEBUI_PASSWORD_HASH: 'h',
        ...(v === undefined ? {} : { TMUX_WEBUI_USAGE_PROVIDERS: v }),
      }).usageProviders
    expect(at()).toEqual([])
    expect(at('')).toEqual([])
    expect(at('codex')).toEqual(['codex'])
    expect(at('codex, claude')).toEqual(['codex', 'claude'])
    expect(at(' Claude ,,')).toEqual(['claude'])
  })

  it('UPDATE_CHECK=false 关闭更新检查（其它值一律视为开启）', () => {
    const at = (v: string) =>
      loadConfig({ TMUX_WEBUI_PASSWORD_HASH: 'h', TMUX_WEBUI_UPDATE_CHECK: v }).updateCheck
    expect(at('false')).toBe(false)
    expect(at('true')).toBe(true)
    expect(at('')).toBe(true)
  })

  it('读取全部环境变量覆盖', () => {
    const c = loadConfig({
      TMUX_WEBUI_PASSWORD_HASH: 'h',
      TMUX_WEBUI_HOST: '0.0.0.0',
      TMUX_WEBUI_PORT: '9000',
      TMUX_WEBUI_SOCKET: 'testsock',
      TMUX_WEBUI_SESSION_TTL_MS: '1000',
      TMUX_WEBUI_COOKIE_SECURE: 'true',
      TMUX_WEBUI_SESSION_FILE: '/tmp/custom-sessions.json',
      TMUX_WEBUI_UPLOAD_DIR: '/tmp/custom-uploads',
      TMUX_WEBUI_UPLOAD_RETENTION_MS: '2000',
      TMUX_WEBUI_UPLOAD_MAX_BYTES: '3000',
    })
    expect(c.host).toBe('0.0.0.0')
    expect(c.port).toBe(9000)
    expect(c.socketName).toBe('testsock')
    expect(c.sessionTtlMs).toBe(1000)
    expect(c.cookieSecure).toBe(true)
    expect(c.sessionFile).toBe('/tmp/custom-sessions.json')
    expect(c.uploadDir).toBe('/tmp/custom-uploads')
    expect(c.uploadRetentionMs).toBe(2000)
    expect(c.uploadMaxBytes).toBe(3000)
  })

  it('PORT 非数字时抛错', () => {
    expect(() => loadConfig({ TMUX_WEBUI_PASSWORD_HASH: 'h', TMUX_WEBUI_PORT: 'abc' })).toThrow(
      /TMUX_WEBUI_PORT/,
    )
  })

  it('SESSION_TTL_MS 非正数时抛错', () => {
    expect(() =>
      loadConfig({ TMUX_WEBUI_PASSWORD_HASH: 'h', TMUX_WEBUI_SESSION_TTL_MS: '-1' }),
    ).toThrow(/TMUX_WEBUI_SESSION_TTL_MS/)
  })

  it.each([
    ['TMUX_WEBUI_UPLOAD_RETENTION_MS', '0'],
    ['TMUX_WEBUI_UPLOAD_MAX_BYTES', '-1'],
  ])('%s 非正数时抛错', (name, value) => {
    expect(() => loadConfig({ TMUX_WEBUI_PASSWORD_HASH: 'h', [name]: value })).toThrow(name)
  })
})

describe('bindWarnings', () => {
  const base = loadConfig({ TMUX_WEBUI_PASSWORD_HASH: 'h' })
  const at = (host: string, extra: Partial<Config> = {}): Config => ({
    ...base,
    host,
    ...extra,
  })

  it('回环地址不告警', () => {
    for (const host of ['127.0.0.1', 'localhost', '::1', '127.0.0.5']) {
      expect(bindWarnings(at(host))).toEqual([])
    }
  })

  it('监听非回环地址时告警暴露风险', () => {
    const warnings = bindWarnings(at('0.0.0.0'))
    expect(warnings.join('\n')).toMatch(/0\.0\.0\.0/)
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('非回环且 cookie 未加 Secure 时额外告警', () => {
    expect(bindWarnings(at('192.168.1.9', { cookieSecure: false })).length).toBe(2)
    expect(bindWarnings(at('192.168.1.9', { cookieSecure: true })).length).toBe(1)
  })
})
