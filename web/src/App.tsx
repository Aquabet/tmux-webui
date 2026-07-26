import { useCallback, useEffect, useState } from 'react'
import { AuthError, checkAuth, createSession, deleteSession, renameSession } from './api'
import { Login } from './Login'
import { SessionSidebar } from './SessionSidebar'
import { loadSidebarCollapsed, toggleSidebarCollapsed } from './sidebarState'
import { TerminalView } from './TerminalView'
import { WindowTabs } from './WindowTabs'
import { useSessions } from './useSessions'

function Main({ onAuthLost }: { onAuthLost: () => void }) {
  const { sessions, error, refresh } = useSessions(onAuthLost)
  const [selectedSession, setSelectedSession] = useState<string | undefined>()
  const [selectedWindow, setSelectedWindow] = useState(0)
  const [actionError, setActionError] = useState<string | undefined>()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadSidebarCollapsed)

  // 同一个 ☰ 按钮：桌面端切换折叠（持久化），窄屏切换抽屉
  function handleToggleSidebar() {
    if (window.matchMedia('(min-width: 701px)').matches) {
      setSidebarCollapsed(toggleSidebarCollapsed)
    } else {
      setSidebarOpen((o) => !o)
    }
  }

  const current = sessions.find((s) => s.name === selectedSession) ?? sessions[0]
  const currentWindow =
    current?.windows.find((w) => w.index === selectedWindow) ?? current?.windows[0]

  function handleSelectSession(name: string) {
    setSelectedSession(name)
    setSelectedWindow(0)
    setSidebarOpen(false)
  }

  async function runAction(action: () => Promise<void>) {
    setActionError(undefined)
    try {
      await action()
      refresh()
    } catch (err) {
      if (err instanceof AuthError) {
        onAuthLost()
        return
      }
      setActionError(err instanceof Error ? err.message : '操作失败')
    }
  }

  function handleCreate() {
    const name = window.prompt('新 session 名称：')?.trim()
    if (!name) return
    void runAction(async () => {
      await createSession(name)
      handleSelectSession(name)
    })
  }

  function handleRename(name: string) {
    const newName = window.prompt(`将 session "${name}" 重命名为：`, name)?.trim()
    if (!newName || newName === name) return
    void runAction(async () => {
      await renameSession(name, newName)
      if (current?.name === name) handleSelectSession(newName)
    })
  }

  function handleDelete(name: string) {
    if (!window.confirm(`确认删除 session "${name}"？其中运行的程序都会被终止。`)) return
    void runAction(async () => {
      await deleteSession(name)
      if (selectedSession === name) setSelectedSession(undefined)
    })
  }

  return (
    <div
      className={`app${sidebarOpen ? ' sidebar-open' : ''}${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}
    >
      <SessionSidebar
        sessions={sessions}
        selected={current?.name}
        onSelect={handleSelectSession}
        onCreate={handleCreate}
        onRename={handleRename}
        onDelete={handleDelete}
      />
      <div className="backdrop" onClick={() => setSidebarOpen(false)} />
      <main className="main">
        {(error ?? actionError) && <div className="banner-error">{error ?? actionError}</div>}
        {current && currentWindow ? (
          <>
            <div className="main-header">
              <button
                className="sidebar-toggle"
                aria-label="切换 session 列表"
                onClick={handleToggleSidebar}
              >
                ☰
              </button>
              <WindowTabs
                windows={current.windows}
                selected={currentWindow.index}
                onSelect={setSelectedWindow}
              />
            </div>
            <TerminalView
              session={current.name}
              windowIndex={currentWindow.index}
              onAuthLost={onAuthLost}
            />
          </>
        ) : (
          <div className="empty">没有可用的 tmux session</div>
        )}
      </main>
    </div>
  )
}

export function App() {
  // null = 正在探测 cookie 是否仍有效，避免闪现登录页
  const [authed, setAuthed] = useState<boolean | null>(null)
  const onAuthLost = useCallback(() => setAuthed(false), [])
  useEffect(() => {
    checkAuth().then(setAuthed)
  }, [])
  if (authed === null) return null
  if (!authed) return <Login onSuccess={() => setAuthed(true)} />
  return <Main onAuthLost={onAuthLost} />
}
