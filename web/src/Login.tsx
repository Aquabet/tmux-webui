import { useState, type FormEvent } from 'react'
import { login } from './api'

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      await login(password)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>tmux webui</h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="密码"
        />
        <button type="submit" disabled={busy || password.length === 0}>
          {busy ? '登录中…' : '登录'}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  )
}
