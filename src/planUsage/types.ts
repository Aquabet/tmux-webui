// 默认的安全边界：provider 只做本地文件解析，不出网、不读凭据（如 codex）。
// 唯一例外是 claude-quota——读 OAuth 凭据并请求 Anthropic 接口，其边界与
// 同意机制见 claudeQuota.ts 头注释。新 provider 若要越过默认边界，必须
// 采用同样的「独立 id + allowlist 显式启用」模式。

export const PLAN_USAGE_SCHEMA_VERSION = 1

export interface QuotaWindow {
  kind: 'quota'
  label: string
  usedPercent: number
  windowMinutes?: number
  /** 配额重置时刻，epoch 毫秒 */
  resetsAt?: number
  /** 快照产生时刻，epoch 毫秒——快照可能远早于采集时刻 */
  observedAt: number
  /** expired = reset 时刻已过，百分比不可再当作实时数据渲染 */
  state: 'observed' | 'expired'
}

// 前端 schema 仍支持 kind: 'tokens' 窗口（见 web/src/api.ts），当前后端
// 没有产出 token 统计的 provider；再需要时在这里补回 TokenWindow 并入联合
export type UsageWindow = QuotaWindow

export interface ProviderUsage {
  providerId: string
  displayName: string
  /** unavailable = 数据源不存在或无数据；error = 解析失败（不向客户端泄露原因） */
  status: 'ok' | 'unavailable' | 'error' | 'disabled'
  planType?: string
  windows: UsageWindow[]
  /** 该 provider 最近一次本地活动时刻，epoch 毫秒 */
  lastActivityAt?: number
}

export interface UsageProvider {
  id: string
  displayName: string
  collect(): Promise<ProviderUsage>
}

export interface PlanUsageReport {
  schemaVersion: number
  collectedAt: number
  providers: ProviderUsage[]
}
