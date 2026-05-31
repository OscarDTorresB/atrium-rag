/**
 * Root component and auth gate. Shows the sign-in screen until valid credentials are
 * stored, then the two-pane workspace (Library + Conversation). A 401 from any later
 * call drops the user back to sign-in.
 */
import { useState } from 'react'
import { LoginScreen } from './components/LoginScreen'
import { Sidebar } from './components/Sidebar'
import { Chat } from './components/Chat'
import { clearCredentials, getCredentials } from './lib/auth'

export function App() {
  const [signedIn, setSignedIn] = useState<boolean>(() => getCredentials() !== null)

  function signOut() {
    clearCredentials()
    setSignedIn(false)
  }

  if (!signedIn) {
    return <LoginScreen onSignedIn={() => setSignedIn(true)}/>
  }

  return (
    <div className="shell">
      <Sidebar onSignOut={signOut} onAuthError={signOut}/>
      <Chat onAuthError={signOut}/>
    </div>
  )
}
