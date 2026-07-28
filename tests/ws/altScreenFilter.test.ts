import { describe, expect, it } from 'vitest'
import { createAltScreenFilter } from '../../src/ws/altScreenFilter.js'

describe('createAltScreenFilter', () => {
  it('滤掉进入/退出 alternate screen 序列', () => {
    const f = createAltScreenFilter()
    expect(f('a\x1b[?1049hb\x1b[?1049lc')).toBe('abc')
  })

  it('序列跨 chunk 截断也能滤掉', () => {
    const f = createAltScreenFilter()
    expect(f('hello\x1b[?10')).toBe('hello')
    expect(f('49hworld')).toBe('world')
  })

  it('截断后不匹配则原样吐出', () => {
    const f = createAltScreenFilter()
    expect(f('x\x1b[?10')).toBe('x')
    expect(f('4Xy')).toBe('\x1b[?104Xy')
  })

  it('普通转义序列不受影响', () => {
    const f = createAltScreenFilter()
    expect(f('\x1b[2J\x1b[H\x1b[?25l\x1b[?1000h')).toBe('\x1b[2J\x1b[H\x1b[?25l\x1b[?1000h')
  })

  it('恰好整块是目标序列', () => {
    const f = createAltScreenFilter()
    expect(f('\x1b[?1049h')).toBe('')
  })
})
