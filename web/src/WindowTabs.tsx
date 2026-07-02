import type { ApiWindow } from './api'

interface Props {
  windows: ApiWindow[]
  selected: number
  onSelect: (index: number) => void
}

export function WindowTabs({ windows, selected, onSelect }: Props) {
  return (
    <nav className="window-tabs">
      {windows.map((w) => (
        <button
          key={w.index}
          className={`tab${w.index === selected ? ' selected' : ''}`}
          onClick={() => onSelect(w.index)}
        >
          {w.index}: {w.name}
        </button>
      ))}
    </nav>
  )
}
