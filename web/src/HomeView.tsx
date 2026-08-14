import { AgentBadge, TerminalBadge } from './AgentBadge'
import type { ApiSession } from './api'

// 登录后先落在这里，而不是自动挂进某个 session：自动挂进"第一个"会让
// 不同浏览器窗口的画面被别处新建的 session 挤走（列表按名字排序）。

interface HomeViewProps {
  sessions: ApiSession[]
  onSelect: (name: string) => void
  onCreate: () => void
}

export function HomeView({ sessions, onSelect, onCreate }: HomeViewProps) {
  return (
    <div className="home">
      <div className="home-inner">
        <header className="home-header">
          <h1>tmux webui</h1>
          <p>选择一个 session 接入，或新建一个。关闭浏览器不会中断里面运行的程序。</p>
        </header>

        <button className="new-session home-create" type="button" onClick={onCreate}>
          ＋ 新建 session
        </button>

        {sessions.length === 0 ? (
          <p className="home-empty">当前没有 tmux session。</p>
        ) : (
          <section className="home-sessions" aria-label="可接入的 session">
            {sessions.map((session) => {
              const agents = session.agents ?? []
              const windowLabel = `${session.windows.length} 个 window`
              return (
                <button
                  key={session.name}
                  className="home-session"
                  type="button"
                  onClick={() => onSelect(session.name)}
                >
                  <span className="home-session-badges">
                    {agents.length > 0 ? (
                      agents.map((agent) => (
                        <AgentBadge key={agent.kind} agent={agent} attached={session.attached} />
                      ))
                    ) : (
                      <TerminalBadge attached={session.attached} />
                    )}
                  </span>
                  <span className="home-session-name">{session.name}</span>
                  <span className="home-session-meta">
                    {windowLabel}
                    {session.attached ? ' · 有客户端连接' : ''}
                  </span>
                </button>
              )
            })}
          </section>
        )}
      </div>
    </div>
  )
}
