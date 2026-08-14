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
  loadCollapsedProviders,
  setProviderCollapsed,
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
  collapsed,
  onToggleCollapsed,
}: {
  provider: PlanUsageProvider
  collapsed: boolean
  onToggleCollapsed: () => void
}) {
  return (
    <div className="usage-provider">
      <button
        type="button"
        className="usage-provider-toggle"
        onClick={onToggleCollapsed}
        aria-expanded={!collapsed}
        aria-label={`${collapsed ? '展开' : '折叠'} ${provider.displayName} 用量`}
      >
        <span>{provider.displayName}</span>
        {provider.planType ? <em>{provider.planType}</em> : null}
        <i className={`usage-chevron${collapsed ? ' collapsed' : ''}`} aria-hidden="true" />
      </button>
      {collapsed ? null : provider.status === 'ok' ? (
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
  const [collapsed, setCollapsed] = useState<string[]>(loadCollapsedProviders)

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
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [onAuthLost])

  // 未启用的 provider 不渲染——服务端根本没去采集它。开关在设置面板里，
  // 侧栏内点名字只做折叠/展开
  const visible = providers.filter((provider) => provider.status !== 'disabled')
  if (visible.length === 0) return null

  const toggleCollapsed = (id: string) => {
    const isCollapsed = collapsed.includes(id)
    setProviderCollapsed(id, !isCollapsed)
    setCollapsed(loadCollapsedProviders())
  }

  return (
    <section className="plan-usage" aria-label="计划用量">
      {visible.map((provider) => (
        <ProviderBlock
          key={provider.providerId}
          provider={provider}
          collapsed={collapsed.includes(provider.providerId)}
          onToggleCollapsed={() => toggleCollapsed(provider.providerId)}
        />
      ))}
    </section>
  )
}
