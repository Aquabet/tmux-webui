import { UpdateNotice } from './UpdateNotice'
import type { ApiSession } from './api'

interface Props {
  sessions: ApiSession[]
  selected: string | undefined
  onSelect: (name: string) => void
  onCreate: () => void
  onRename: (name: string) => void
  onDelete: (name: string) => void
}

export function SessionSidebar({
  sessions,
  selected,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: Props) {
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
            <button
              className="session-action"
              title="重命名"
              aria-label={`重命名 ${s.name}`}
              onClick={() => onRename(s.name)}
            >
              ✎
            </button>
            <button
              className="session-action"
              title="删除"
              aria-label={`删除 ${s.name}`}
              onClick={() => onDelete(s.name)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <button className="new-session" onClick={onCreate}>
        ＋ 新建 session
      </button>
      <UpdateNotice />
    </aside>
  )
}
