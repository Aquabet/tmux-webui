import { useCallback, useEffect, useState } from 'react'
import { AuthError, fetchSessions, type ApiSession } from './api'

const POLL_MS = 5000

export function useSessions(onAuthLost: () => void): {
  sessions: ApiSession[]
  error?: string
  refresh: () => void
} {
  const [sessions, setSessions] = useState<ApiSession[]>([])
  const [error, setError] = useState<string | undefined>()
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick((t) => t + 1), [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick intentionally restarts polling after mutations
  useEffect(() => {
    let stopped = false
    async function poll() {
      try {
        const data = await fetchSessions()
        if (!stopped) {
          setSessions(data)
          setError(undefined)
        }
      } catch (err) {
        if (stopped) return
        if (err instanceof AuthError) {
          onAuthLost()
          return
        }
        setError(err instanceof Error ? err.message : '获取会话列表失败')
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), POLL_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
    // tick 变化时重跑 effect，实现增删改后立即刷新列表
  }, [onAuthLost, tick])

  return { sessions, error, refresh }
}
