import { useEffect, useState, type CSSProperties } from 'react'
import {
  AuthError,
  fetchPlanUsage,
  type PlanUsageProvider,
  type PlanUsageQuotaWindow,
  type PlanUsageTokenWindow,
} from './api'
import {
  formatResetIn,
  formatTokens,
  loadHiddenProviders,
  setProviderHidden,
  USAGE_DISPLAY_EVENT,
} from './planUsageDisplay'

// 快照 60s 一采（服务端同样缓存 60s），轮询更快没有意义
const POLL_MS = 60_000

function QuotaRow({ window: win, provider }: { window: PlanUsageQuotaWindow; provider: string }) {
  const percent = Math.round(win.usedPercent)
  if (win.state === 'expired') {
    return (
      <div className="usage-row">
        <span className="usage-label">{win.label}</span>
        <span className="usage-value">已过期</span>
      </div>
    )
  }
  const reset = win.resetsAt === undefined ? undefined : formatResetIn(win.resetsAt, Date.now())
  const style = { '--usage': `${Math.min(100, Math.max(0, win.usedPercent))}%` } as CSSProperties
  return (
    <div className="usage-row">
      <span className="usage-label">{win.label}</span>
      <span
        className="usage-bar"
        role="img"
        aria-label={`${provider} ${win.label} 已用 ${percent}%`}
        style={style}
      />
      <span className="usage-value">
        {percent}%{reset === undefined ? '' : ` · ${reset}`}
      </span>
    </div>
  )
}

function TokenRow({ window: win }: { window: PlanUsageTokenWindow }) {
  return (
    <div className="usage-row" title="本地统计的 token 用量，非官方配额">
      <span className="usage-label">{win.label}</span>
      <span className="usage-value">{formatTokens(win.tokens)}</span>
    </div>
  )
}

function ProviderBlock({
  provider,
  onHide,
}: {
  provider: PlanUsageProvider
  onHide: () => void
}) {
  return (
    <div className="usage-provider">
      <button
        type="button"
        className="usage-provider-toggle"
        onClick={onHide}
        aria-label={`隐藏 ${provider.displayName} 用量（可在设置里恢复）`}
        title="点击隐藏，可在设置里恢复"
      >
        <span>{provider.displayName}</span>
        {provider.planType ? <em>{provider.planType}</em> : null}
      </button>
      {provider.status === 'ok' ? (
        provider.windows.map((win) =>
          win.kind === 'quota' ? (
            <QuotaRow key={win.label} window={win} provider={provider.displayName} />
          ) : (
            <TokenRow key={win.label} window={win} />
          ),
        )
      ) : (
        <div className="usage-row">
          <span className="usage-value muted">
            {provider.status === 'unavailable' ? '未检测到数据源' : '获取失败'}
          </span>
        </div>
      )}
    </div>
  )
}

export function PlanUsage({ onAuthLost }: { onAuthLost: () => void }) {
  const [providers, setProviders] = useState<PlanUsageProvider[]>([])
  const [hidden, setHidden] = useState<string[]>(loadHiddenProviders)

  useEffect(() => {
    let stopped = false
    async function poll() {
      try {
        const report = await fetchPlanUsage()
        if (!stopped) setProviders(report.providers)
      } catch (error) {
        if (!stopped && error instanceof AuthError) onAuthLost()
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), POLL_MS)
    // 设置面板改动显示偏好时同步；storage 事件只跨标签页，同页靠自定义事件
    const sync = () => setHidden(loadHiddenProviders())
    window.addEventListener(USAGE_DISPLAY_EVENT, sync)
    return () => {
      stopped = true
      window.clearInterval(timer)
      window.removeEventListener(USAGE_DISPLAY_EVENT, sync)
    }
  }, [onAuthLost])

  // 被隐藏的 provider 整块不渲染；恢复入口在设置面板的「用量显示」
  const visible = providers.filter((provider) => !hidden.includes(provider.providerId))
  if (visible.length === 0) return null

  return (
    <section className="plan-usage" aria-label="计划用量">
      {visible.map((provider) => (
        <ProviderBlock
          key={provider.providerId}
          provider={provider}
          onHide={() => setProviderHidden(provider.providerId, true)}
        />
      ))}
    </section>
  )
}
