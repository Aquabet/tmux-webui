import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InputBar } from './InputBar'

describe('InputBar', () => {
  it('提交后发送文本加回车并清空输入框', () => {
    const onSend = vi.fn()
    render(<InputBar onSend={onSend} />)
    const input = screen.getByPlaceholderText<HTMLInputElement>('输入命令，回车发送')
    fireEvent.change(input, { target: { value: 'echo hello world' } })
    fireEvent.submit(input.closest('form')!)
    expect(onSend).toHaveBeenCalledWith('echo hello world\r')
    expect(input.value).toBe('')
  })

  it('空内容提交时只发送回车（等价直接按 Enter）', () => {
    const onSend = vi.fn()
    render(<InputBar onSend={onSend} />)
    fireEvent.submit(screen.getByPlaceholderText('输入命令，回车发送').closest('form')!)
    expect(onSend).toHaveBeenCalledWith('\r')
  })

  it('辅助键发送对应控制序列且不清空输入框', () => {
    const onSend = vi.fn()
    render(<InputBar onSend={onSend} />)
    const input = screen.getByPlaceholderText<HTMLInputElement>('输入命令，回车发送')
    fireEvent.change(input, { target: { value: 'half typed' } })
    fireEvent.click(screen.getByText('Esc'))
    fireEvent.click(screen.getByText('Tab'))
    fireEvent.click(screen.getByText('^C'))
    fireEvent.click(screen.getByText('↑'))
    fireEvent.click(screen.getByText('↓'))
    expect(onSend.mock.calls.map((c) => c[0])).toEqual(['\x1b', '\t', '\x03', '\x1b[A', '\x1b[B'])
    expect(input.value).toBe('half typed')
  })
})
