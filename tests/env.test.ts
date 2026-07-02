import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { loadEnvFile, parseEnvFile } from '../src/env.js'

describe('parseEnvFile', () => {
  it('解析 KEY=VALUE 行', () => {
    expect(parseEnvFile('A=1\nB=two\n')).toEqual({ A: '1', B: 'two' })
  })

  it('忽略注释、空行和无等号的行', () => {
    const content = '# 注释\n\nA=1\n无等号行\n  # 缩进注释\n'
    expect(parseEnvFile(content)).toEqual({ A: '1' })
  })

  it('剥离成对引号且不做变量展开（bcrypt 哈希含 $）', () => {
    const hash = '$2a$10$N9qo8uLOickgx2ZMRZoMye'
    const content = `TMUX_WEBUI_PASSWORD_HASH='${hash}'\nQUOTED="hello world"\n`
    expect(parseEnvFile(content)).toEqual({
      TMUX_WEBUI_PASSWORD_HASH: hash,
      QUOTED: 'hello world',
    })
  })

  it('值中的等号与首尾空白正确处理', () => {
    expect(parseEnvFile('  KEY = a=b=c  \n')).toEqual({ KEY: 'a=b=c' })
  })
})

describe('loadEnvFile', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'webui-env-test-'))

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('文件不存在时返回空对象', () => {
    expect(loadEnvFile(path.join(dir, 'nonexistent.env'))).toEqual({})
  })

  it('读取真实文件', () => {
    const file = path.join(dir, '.env')
    writeFileSync(file, 'TMUX_WEBUI_PORT=9000\n')
    expect(loadEnvFile(file)).toEqual({ TMUX_WEBUI_PORT: '9000' })
  })
})
