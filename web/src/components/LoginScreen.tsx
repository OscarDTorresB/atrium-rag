/**
 * Sign-in gate. Validates the entered credentials against the API (a real authed call)
 * before letting the user in, so a wrong password is caught here rather than on the
 * first action inside the app.
 */
import { type FormEvent, useState } from 'react'
import { type Credentials, setCredentials } from '../lib/auth'
import { verifyCredentials } from '../lib/api'

export function LoginScreen({ onSignedIn }: { onSignedIn: (creds: Credentials) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const creds = { username, password }
    try {
      const ok = await verifyCredentials(creds)
      if (!ok) {
        setError('That username or password doesn’t look right.')
        return
      }
      setCredentials(creds)
      onSignedIn(creds)
    } catch {
      setError('Couldn’t reach the service. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1 className="login-mark">Atrium<span className="dot">.</span></h1>
        <p className="login-sub">Sign in to chat with your documents.</p>

        {error && <div className="form-error">{error}</div>}

        <div className="field">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        <button className="btn-primary" type="submit" disabled={busy || !username || !password}>
          {busy ? <span className="spinner"/> : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
