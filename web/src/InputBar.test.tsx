import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InputBar } from './InputBar'
import { uploadImage } from './api'

vi.mock('./api', () => ({ uploadImage: vi.fn() }))

afterEach(() => {
  vi.useRealTimers()
})

// 文本与回车必须分两次写，否则 TUI 会把整块判成粘贴、回车退化成换行
function flushEnter() {
  act(() => {
    vi.advanceTimersByTime(200)
  })
}

describe('InputBar', () => {
  it('提交后先发文本、隔一拍再发回车，并清空输入框', () => {
    vi.useFakeTimers()
    const onSend = vi.fn()
    render(<InputBar onSend={onSend} />)
    const input = screen.getByPlaceholderText<HTMLTextAreaElement>('输入命令，回车发送')
    fireEvent.change(input, { target: { value: 'echo hello world' } })
    fireEvent.submit(input.closest('form')!)
    expect(onSend.mock.calls).toEqual([['echo hello world']])
    expect(input.value).toBe('')
    flushEnter()
    expect(onSend.mock.calls).toEqual([['echo hello world'], ['\r']])
  })

  it('Enter 键提交，Shift+Enter 不提交（留给换行）', () => {
    vi.useFakeTimers()
    const onSend = vi.fn()
    render(<InputBar onSend={onSend} />)
    const input = screen.getByPlaceholderText<HTMLTextAreaElement>('输入命令，回车发送')
    fireEvent.change(input, { target: { value: 'ls' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(onSend).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    flushEnter()
    expect(onSend.mock.calls).toEqual([['ls'], ['\r']])
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
    const input = screen.getByPlaceholderText<HTMLTextAreaElement>('输入命令，回车发送')
    fireEvent.change(input, { target: { value: 'half typed' } })
    fireEvent.click(screen.getByText('Esc'))
    fireEvent.click(screen.getByText('Tab'))
    fireEvent.click(screen.getByText('^C'))
    fireEvent.click(screen.getByText('↑'))
    fireEvent.click(screen.getByText('↓'))
    fireEvent.click(screen.getByText('⏎'))
    fireEvent.click(screen.getByText('⌫'))
    fireEvent.click(screen.getByText('Mode'))
    expect(onSend.mock.calls.map((c) => c[0])).toEqual([
      '\x1b',
      '\t',
      '\x03',
      '\x1b[A',
      '\x1b[B',
      '\r',
      '\x7f',
      '\x1b[Z',
    ])
    expect(input.value).toBe('half typed')
  })

  it('选图上传后把路径插入输入框', async () => {
    vi.mocked(uploadImage).mockResolvedValue('/home/u/.tmux-webui/uploads/img-1.png')
    render(<InputBar onSend={vi.fn()} />)
    const picker = document.querySelector<HTMLInputElement>('input[type=file]')!
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    fireEvent.change(picker, { target: { files: [file] } })
    await waitFor(() => {
      const ta = screen.getByPlaceholderText<HTMLTextAreaElement>('输入命令，回车发送')
      expect(ta.value).toBe('/home/u/.tmux-webui/uploads/img-1.png ')
    })
    expect(uploadImage).toHaveBeenCalledWith(file)
  })
})
