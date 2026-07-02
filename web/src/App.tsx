import { useCallback, useState } from 'react'
import { Login } from './Login'
import { SessionSidebar } from './SessionSidebar'
import { TerminalView } from './TerminalView'
import { WindowTabs } from './WindowTabs'
import { useSessions } from './useSessions'

function Main({ onAuthLost }: { onAuthLost: () => void }) {
  const { sessions, error } = useSessions(onAuthLost)
  const [selectedSession, setSelectedSession] = useState<string | undefined>()
  const [selectedWindow, setSelectedWindow] = useState(0)

  const current = sessions.find((s) => s.name === selectedSession) ?? sessions[0]
  const currentWindow =
    current?.windows.find((w) => w.index === selectedWindow) ?? current?.windows[0]

  function handleSelectSession(name: string) {
    setSelectedSession(name)
    setSelectedWindow(0)
  }

  return (
    <div className="app">
      <SessionSidebar
        sessions={sessions}
        selected={current?.name}
        onSelect={handleSelectSession}
      />
      <main className="main">
        {error && <div className="banner-error">{error}</div>}
        {current && currentWindow ? (
          <>
            <WindowTabs
              windows={current.windows}
              selected={currentWindow.index}
              onSelect={setSelectedWindow}
            />
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
  const [authed, setAuthed] = useState(false)
  const onAuthLost = useCallback(() => setAuthed(false), [])
  if (!authed) return <Login onSuccess={() => setAuthed(true)} />
  return <Main onAuthLost={onAuthLost} />
}
