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
  // Drawer state for the mobile layout; ignored on desktop where the sidebar is always shown.
  const [menuOpen, setMenuOpen] = useState(false)

  function signOut() {
    clearCredentials()
    setSignedIn(false)
  }

  if (!signedIn) {
    return <LoginScreen onSignedIn={() => setSignedIn(true)}/>
  }

  return (
    <div className="shell">
      <header className="topbar">
        <button className="menu-toggle" aria-label="Open library" onClick={() => setMenuOpen(true)}>
          <MenuIcon/>
        </button>
        <span className="wordmark">Atrium<span className="dot">.</span></span>
      </header>

      <div
        className={`scrim${menuOpen ? ' show' : ''}`}
        onClick={() => setMenuOpen(false)}
        aria-hidden="true"
      />
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} onSignOut={signOut} onAuthError={signOut}/>
      <Chat onAuthError={signOut}/>
    </div>
  )
}

function MenuIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M3 12h18M3 18h18"/>
    </svg>
  )
}
