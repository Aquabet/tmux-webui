import { useEffect, useState } from 'react'
import { fetchVersion, type VersionInfo } from './api'

// 只提示，不代劳更新：装的方式各不相同（npx / 全局 npm / 源码），
// 自动执行更新等于给一个远程可触发的任意安装命令，收益不值这个风险。
export function UpdateNotice() {
  const [info, setInfo] = useState<VersionInfo | null>(null)

  useEffect(() => {
    let alive = true
    fetchVersion()
      .then((v) => alive && setInfo(v))
      // 查不到新版不影响用，静默即可
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  if (!info?.updateAvailable) return null

  return (
    <a
      className="update-notice"
      href={info.url ?? undefined}
      target="_blank"
      rel="noreferrer noopener"
    >
      有新版本 v{info.latest}（当前 v{info.current}）
    </a>
  )
}
