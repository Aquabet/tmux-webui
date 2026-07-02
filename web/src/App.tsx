import { useState } from 'react'
import { Login } from './Login'

export function App() {
  const [authed, setAuthed] = useState(false)
  if (!authed) return <Login onSuccess={() => setAuthed(true)} />
  return <div className="app">已登录</div>
}
