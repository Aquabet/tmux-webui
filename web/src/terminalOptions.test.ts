import { describe, expect, it } from 'vitest'
import { TERMINAL_OPTIONS } from './terminalOptions'

describe('TERMINAL_OPTIONS', () => {
  it('retains output above the viewport for terminal scrollback', () => {
    expect(TERMINAL_OPTIONS.scrollback).toBe(10_000)
  })
})
