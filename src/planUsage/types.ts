// 计划用量数据只来自本地文件解析：不出网、不读任何 OAuth 凭据。
// 这是安全边界的一部分，新 provider 必须遵守（见 registry.ts）。

export const PLAN_USAGE_SCHEMA_VERSION = 1

// quota：provider 本地留有真实配额百分比（如 Codex rate_limits 快照）。
// tokens：本地只有 token 计数、没有配额上限，只能如实展示用量而非剩余。
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

export interface TokenWindow {
  kind: 'tokens'
  label: string
  tokens: number
  windowMinutes: number
  observedAt: number
  state: 'observed'
}

export type UsageWindow = QuotaWindow | TokenWindow

export interface ProviderUsage {
  providerId: string
  displayName: string
  /** unavailable = 数据源不存在或无数据；error = 解析失败（不向客户端泄露原因） */
  status: 'ok' | 'unavailable' | 'error'
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
