import { useEffect, useState, type CSSProperties } from 'react'
import { AuthError, fetchSystemResources, type SystemResources } from './api'

const POLL_MS = 3_000

function formatMemory(bytes: number): string {
  const gib = bytes / 1024 ** 3
  return `${gib < 10 ? gib.toFixed(1) : gib.toFixed(0)}`
}

function Meter({
  kind,
  percent,
  detail,
}: {
  kind: 'cpu' | 'ram'
  percent?: number
  detail: string
}) {
  const label = kind === 'cpu' ? 'CPU' : 'RAM'
  const rounded = percent === undefined ? undefined : Math.round(percent)
  const ariaLabel =
    rounded === undefined ? `${label} 使用率暂不可用` : `${label} 使用率 ${rounded}%`
  const style = {
    '--usage': `${percent ?? 0}%`,
  } as CSSProperties

  return (
    <div className={`resource-meter ${kind}`}>
      <div className="resource-ring" role="img" aria-label={ariaLabel} style={style}>
        <span>{rounded === undefined ? '—' : `${rounded}%`}</span>
      </div>
      <strong>{label}</strong>
      <small>{detail}</small>
    </div>
  )
}

export function ResourceUsage({ onAuthLost }: { onAuthLost: () => void }) {
  const [resources, setResources] = useState<SystemResources>()

  useEffect(() => {
    let stopped = false
    async function poll() {
      try {
        const next = await fetchSystemResources()
        if (!stopped) setResources(next)
      } catch (error) {
        if (!stopped && error instanceof AuthError) onAuthLost()
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), POLL_MS)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [onAuthLost])

  const memoryDetail = resources
    ? `${formatMemory(resources.memoryUsedBytes)}/${formatMemory(resources.memoryTotalBytes)} GB`
    : '—/— GB'

  return (
    <section className="resource-usage" aria-label="系统资源占用">
      <Meter
        kind="cpu"
        percent={resources?.cpuPercent}
        detail={resources ? `${resources.cpuCount} 核` : '— 核'}
      />
      <Meter kind="ram" percent={resources?.memoryPercent} detail={memoryDetail} />
    </section>
  )
}
