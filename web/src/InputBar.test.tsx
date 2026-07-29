import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InputBar } from './InputBar'
import { uploadImage } from './api'

vi.mock('./api', () => ({ uploadImage: vi.fn() }))

afterEach(() => {
  vi.useRealTimers()
})

describe('InputBar', () => {
  it('有内容时只把文字送进终端，不替用户按回车', () => {
    const onSend = vi.fn()
    render(<InputBar onSend={onSend} />)
    const input = screen.getByPlaceholderText<HTMLTextAreaElement>('输入文字，回车送入终端')
    fireEvent.change(input, { target: { value: 'echo hello world' } })
    fireEvent.submit(input.closest('form')!)
    expect(onSend.mock.calls).toEqual([['echo hello world']])
    expect(input.value).toBe('')
  })

  it('Enter 键提交，Shift+Enter 不提交（留给换行）', () => {
    const onSend = vi.fn()
    render(<InputBar onSend={onSend} />)
    const input = screen.getByPlaceholderText<HTMLTextAreaElement>('输入文字，回车送入终端')
    fireEvent.change(input, { target: { value: 'ls' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(onSend).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSend.mock.calls).toEqual([['ls']])
    expect(input.value).toBe('')
  })

  it('空内容提交时发送回车（等价给终端按一下回车）', () => {
    const onSend = vi.fn()
    render(<InputBar onSend={onSend} />)
    fireEvent.submit(screen.getByPlaceholderText('输入文字，回车送入终端').closest('form')!)
    expect(onSend).toHaveBeenCalledWith('\r')
  })

  it('辅助键发送对应控制序列且不清空输入框', () => {
    const onSend = vi.fn()
    render(<InputBar onSend={onSend} />)
    const input = screen.getByPlaceholderText<HTMLTextAreaElement>('输入文字，回车送入终端')
    fireEvent.change(input, { target: { value: 'half typed' } })
    fireEvent.click(screen.getByText('Esc'))
    fireEvent.click(screen.getByText('Tab'))
    fireEvent.click(screen.getByText('^C'))
    fireEvent.click(screen.getByText('↑'))
    fireEvent.click(screen.getByText('↓'))
    fireEvent.click(screen.getByText('⏎'))
    fireEvent.pointerDown(screen.getByText('⌫'))
    fireEvent.pointerUp(screen.getByText('⌫'))
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

  it('退格键按住连发，抬手即停', () => {
    vi.useFakeTimers()
    const onSend = vi.fn()
    render(<InputBar onSend={onSend} />)
    const backspace = screen.getByText('⌫')

    fireEvent.pointerDown(backspace)
    expect(onSend).toHaveBeenCalledTimes(1) // 按下立刻删一个

    act(() => {
      vi.advanceTimersByTime(399)
    })
    expect(onSend).toHaveBeenCalledTimes(1) // 起始延迟内不连发

    act(() => {
      vi.advanceTimersByTime(1 + 60 * 3)
    })
    expect(onSend).toHaveBeenCalledTimes(4)

    fireEvent.pointerUp(backspace)
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(onSend).toHaveBeenCalledTimes(4)
    expect(onSend.mock.calls.every((c) => c[0] === '\x7f')).toBe(true)
  })

  it('手指移出按钮也停止连发', () => {
    vi.useFakeTimers()
    const onSend = vi.fn()
    render(<InputBar onSend={onSend} />)
    fireEvent.pointerDown(screen.getByText('⌫'))
    fireEvent.pointerLeave(screen.getByText('⌫'))
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('组件卸载后不再有残留连发', () => {
    vi.useFakeTimers()
    const onSend = vi.fn()
    const { unmount } = render(<InputBar onSend={onSend} />)
    fireEvent.pointerDown(screen.getByText('⌫'))
    unmount()
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('选图上传后把路径插入输入框', async () => {
    vi.mocked(uploadImage).mockResolvedValue('/home/u/.tmux-webui/uploads/img-1.png')
    render(<InputBar onSend={vi.fn()} />)
    const picker = document.querySelector<HTMLInputElement>('input[type=file]')!
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    fireEvent.change(picker, { target: { files: [file] } })
    await waitFor(() => {
      const ta = screen.getByPlaceholderText<HTMLTextAreaElement>('输入文字，回车送入终端')
      expect(ta.value).toBe('/home/u/.tmux-webui/uploads/img-1.png ')
    })
    expect(uploadImage).toHaveBeenCalledWith(file)
  })
})
