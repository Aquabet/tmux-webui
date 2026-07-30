import { useEffect, useState } from 'react'
import { AuthError, fetchVersion, startUpdate, type VersionInfo } from './api'

interface Props {
  onUpdateStarted: (session: string) => void
  onAuthLost: () => void
  compact?: boolean
}

// 侧栏底部常驻显示当前版本；有新版本时补上提示与更新按钮。
// 更新不在本进程里跑——脚本会重启服务，等于杀掉发起它的进程；
// 交给服务端在独立 tmux session 里执行，前端切过去看输出。
export function VersionBadge({ onUpdateStarted, onAuthLost, compact = false }: Props) {
  const [info, setInfo] = useState<VersionInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    let alive = true
    fetchVersion()
      .then((v) => alive && setInfo(v))
      // 查不到版本不影响使用，静默即可
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  async function handleUpdate() {
    const confirmed = window.confirm(
      `更新到 v${info?.latest}？\n\n` +
        '更新会在新的 tmux session 里执行，完成后重启服务，页面会短暂断开。',
    )
    if (!confirmed) return

    setBusy(true)
    setError(undefined)
    try {
      onUpdateStarted(await startUpdate())
    } catch (err) {
      if (err instanceof AuthError) {
        onAuthLost()
        return
      }
      setError(err instanceof Error ? err.message : '启动更新失败')
    } finally {
      setBusy(false)
    }
  }

  // 版本没取到（离线、旧版服务端）就什么都不显示，别占位报错
  if (!info) return null
  // 手机顶栏只承担“有新版时提醒”这一件事；当前版本仍在侧栏底部查看。
  if (compact && !info.updateAvailable) return null

  return (
    <div className={`version-badge${compact ? ' compact' : ''}`}>
      {info.updateAvailable ? (
        <>
          <a
            className="version-new"
            href={info.url ?? undefined}
            target="_blank"
            rel="noreferrer noopener"
          >
            {compact ? `新版 v${info.latest}` : `有新版本 v${info.latest}（当前 v${info.current}）`}
          </a>
          {info.canUpdate && (
            <button type="button" onClick={() => void handleUpdate()} disabled={busy}>
              {busy ? '启动中…' : '更新'}
            </button>
          )}
        </>
      ) : (
        <span className="version-current">v{info.current}</span>
      )}
      {error && <span className="version-error">{error}</span>}
    </div>
  )
}
