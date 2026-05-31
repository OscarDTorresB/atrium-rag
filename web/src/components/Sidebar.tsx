/**
 * The Library: the user's uploaded documents plus the add/remove controls.
 *
 * Adding a file is a single intuitive action — pick (or drop) it and it uploads and
 * becomes searchable on its own, surfacing friendly "Uploading…/Reading…" status. No
 * technical language about embeddings, chunks or vectors is ever shown.
 */
import { type DragEvent, useEffect, useRef, useState } from 'react'
import { addFile, AuthError, deleteDocument, type DocumentSummary, getDownloadUrl, listDocuments } from '../lib/api'

type Pending = { tempId: string; name: string; phase: 'uploading' | 'processing' | 'error' }

const PHASE_LABEL: Record<Pending['phase'], string> = {
  uploading: 'Uploading…',
  processing: 'Reading…',
  error: 'Couldn’t add — try again',
}

export function Sidebar(
  { open, onClose, onSignOut, onAuthError }:
  { open: boolean; onClose: () => void; onSignOut: () => void; onAuthError: () => void },
) {
  const [docs, setDocs] = useState<DocumentSummary[]>([])
  const [pending, setPending] = useState<Pending[]>([])
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function refresh() {
    try {
      setDocs(await listDocuments())
    } catch (err) {
      if (err instanceof AuthError) onAuthError()
    }
  }

  useEffect(() => { void refresh() }, [])

  async function handleFiles(files: FileList | null) {
    if (!files) return
    for (const file of Array.from(files)) {
      const tempId = crypto.randomUUID()
      setPending((p) => [...p, { tempId, name: file.name, phase: 'uploading' }])
      try {
        await addFile(file, (phase) =>
          setPending((p) => p.map((x) => (x.tempId === tempId ? { ...x, phase } : x))),
        )
        setPending((p) => p.filter((x) => x.tempId !== tempId))
        await refresh()
      } catch (err) {
        if (err instanceof AuthError) {
          onAuthError();
          return
        }
        setPending((p) => p.map((x) => (x.tempId === tempId ? { ...x, phase: 'error' } : x)))
      }
    }
  }

  async function handleView(doc: DocumentSummary) {
    onClose()
    // Open the tab synchronously (inside the click) so the async URL fetch that follows
    // isn't treated as a programmatic popup and blocked by the browser.
    const tab = window.open('', '_blank')
    try {
      const url = await getDownloadUrl(doc.documentId)
      if (tab) tab.location.href = url
      else window.open(url, '_blank')
    } catch (err) {
      tab?.close()
      if (err instanceof AuthError) onAuthError()
    }
  }

  async function handleDelete(doc: DocumentSummary) {
    setDocs((d) => d.filter((x) => x.documentId !== doc.documentId))
    try {
      await deleteDocument(doc.documentId)
    } catch (err) {
      if (err instanceof AuthError) {
        onAuthError();
        return
      }
      void refresh() // delete failed — restore the true state
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    void handleFiles(e.dataTransfer.files)
  }

  const isEmpty = docs.length === 0 && pending.length === 0

  return (
    <aside className={`sidebar${open ? ' open' : ''}`}>
      <div className="sidebar-head">
        <span className="wordmark">Atrium<span className="dot">.</span></span>
        <button className="signout" onClick={onSignOut}>Sign out</button>
      </div>

      <div className="library-label">Your library</div>

      <button
        className={`dropzone${dragging ? ' drag' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <span className="plus">＋</span>
        Add a document
        <small>Drop a text file here, or click to browse</small>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="text/*,.txt,.md,.csv,.json"
        multiple
        hidden
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = ''
        }}
      />

      <div className="file-list">
        {isEmpty && (
          <p className="library-empty">
            Your library is empty. Add a document and start a conversation about it.
          </p>
        )}

        {pending.map((p) => (
          <div className="file-item" key={p.tempId}>
            <span className="file-icon"><DocIcon/></span>
            <div className="file-meta">
              <div className="file-name">{p.name}</div>
              <div className={`file-status${p.phase === 'error' ? ' err' : ''}`}>
                {p.phase !== 'error' && <span className="spinner"/>}
                {PHASE_LABEL[p.phase]}
              </div>
            </div>
          </div>
        ))}

        {docs.map((doc) => (
          <div className="file-item" key={doc.documentId}>
            <span className="file-icon"><DocIcon/></span>
            <div className="file-meta">
              <div className="file-name" title={doc.filename}>{doc.filename}</div>
              <div className="file-status">Ready</div>
            </div>
            <button
              className="file-view"
              title="View"
              aria-label={`View ${doc.filename}`}
              onClick={() => handleView(doc)}
            >
              <EyeIcon/>
            </button>
            <button
              className="file-remove"
              title="Remove"
              aria-label={`Remove ${doc.filename}`}
              onClick={() => handleDelete(doc)}
            >
              <TrashIcon/>
            </button>
          </div>
        ))}
      </div>
    </aside>
  )
}

function DocIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <path d="M14 2v6h6M9 13h6M9 17h6"/>
    </svg>
  )
}

function EyeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
    </svg>
  )
}
