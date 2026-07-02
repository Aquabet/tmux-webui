import type { ApiSession } from './api'

interface Props {
  sessions: ApiSession[]
  selected: string | undefined
  onSelect: (name: string) => void
}

export function SessionSidebar({ sessions, selected, onSelect }: Props) {
  return (
    <aside className="sidebar">
      <h2>Sessions</h2>
      <ul>
        {sessions.map((s) => (
          <li key={s.name}>
            <button
              className={`session${s.name === selected ? ' selected' : ''}`}
              onClick={() => onSelect(s.name)}
            >
              <span className="dot" data-attached={s.attached} />
              {s.name}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
