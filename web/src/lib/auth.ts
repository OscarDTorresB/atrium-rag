/**
 * Credential store for the demo's HTTP Basic Auth.
 *
 * The API guards every route with Basic Auth, so the browser must attach an
 * `Authorization: Basic …` header to each call. We keep the entered credentials in
 * `sessionStorage` (cleared when the tab closes — fine for a demo, never persisted to
 * disk) and expose a single helper to build the header.
 */

export type Credentials = { username: string; password: string }

const STORAGE_KEY = 'atrium.credentials'

export function getCredentials(): Credentials | null {
  const raw = sessionStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as Credentials
  } catch {
    return null
  }
}

export function setCredentials(creds: Credentials): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(creds))
}

export function clearCredentials(): void {
  sessionStorage.removeItem(STORAGE_KEY)
}

/** Build the `Authorization` header value for the given credentials. */
export function basicAuthHeader(creds: Credentials): string {
  return `Basic ${btoa(`${creds.username}:${creds.password}`)}`
}
