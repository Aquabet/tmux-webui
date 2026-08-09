import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfigFile, parseConfigJson, writeConfigFile } from '../src/configFile.js'

const dirs: string[] = []
function tmpFile(name = 'config.json'): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'tmux-webui-cfg-'))
  dirs.push(dir)
  return path.join(dir, name)
}

afterEach(() => {
  dirs.length = 0
})

describe('parseConfigJson', () => {
  it('标量值统一转成字符串', () => {
    expect(parseConfigJson('{"TMUX_WEBUI_PORT": 9000, "TMUX_WEBUI_COOKIE_SECURE": true}')).toEqual({
      TMUX_WEBUI_PORT: '9000',
      TMUX_WEBUI_COOKIE_SECURE: 'true',
    })
  })

  it('JSON 语法错误时抛错而不是静默忽略', () => {
    expect(() => parseConfigJson('{oops')).toThrow(/配置文件/)
  })

  it('顶层不是对象时抛错', () => {
    expect(() => parseConfigJson('[1,2]')).toThrow(/配置文件/)
    expect(() => parseConfigJson('"x"')).toThrow(/配置文件/)
  })

  it('值是对象或数组时抛错并指出是哪个键', () => {
    expect(() => parseConfigJson('{"TMUX_WEBUI_PORT": {"a": 1}}')).toThrow(/TMUX_WEBUI_PORT/)
  })

  it('值为 null 时跳过该键', () => {
    expect(parseConfigJson('{"A": null, "B": "b"}')).toEqual({ B: 'b' })
  })
})

describe('loadConfigFile', () => {
  it('文件不存在时返回空对象', () => {
    expect(loadConfigFile(tmpFile('missing.json'))).toEqual({})
  })

  it('读取已有文件', () => {
    const file = tmpFile()
    writeFileSync(file, '{"TMUX_WEBUI_PASSWORD_HASH": "h"}')
    expect(loadConfigFile(file)).toEqual({ TMUX_WEBUI_PASSWORD_HASH: 'h' })
  })
})

describe('writeConfigFile', () => {
  it('写入后能读回，且权限为 0600（文件含密码哈希）', () => {
    const file = tmpFile()
    writeConfigFile(file, { TMUX_WEBUI_PASSWORD_HASH: 'h', TMUX_WEBUI_PORT: '9000' })
    expect(loadConfigFile(file)).toEqual({
      TMUX_WEBUI_PASSWORD_HASH: 'h',
      TMUX_WEBUI_PORT: '9000',
    })
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('覆盖已存在的宽松权限文件时收紧到 0600', () => {
    const file = tmpFile()
    writeFileSync(file, '{}', { mode: 0o644 })
    writeConfigFile(file, { TMUX_WEBUI_PASSWORD_HASH: 'h' })
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('目录不存在时自动创建', () => {
    const file = path.join(path.dirname(tmpFile()), 'nested', 'config.json')
    writeConfigFile(file, { A: 'b' })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ A: 'b' })
  })
})
