import { useEffect, useState } from 'react'
import { AuthError, fetchSessions, type ApiSession } from './api'

const POLL_MS = 5000

export function useSessions(onAuthLost: () => void): {
  sessions: ApiSession[]
  error?: string
} {
  const [sessions, setSessions] = useState<ApiSession[]>([])
  const [error, setError] = useState<string | undefined>()

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
  }, [onAuthLost])

  return { sessions, error }
}
