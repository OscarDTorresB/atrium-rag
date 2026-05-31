/**
 * The conversation pane: the message thread, a welcome/empty state with example
 * prompts, and the composer. Answers stream in token-by-token with a blinking caret.
 *
 * This component knows nothing about retrieval — it just sends a message and renders
 * the streamed reply, keeping the experience focused on the conversation.
 */
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { AuthError, streamChat } from '../lib/api'

type Message = { role: 'user' | 'assistant'; text: string }

const SUGGESTIONS = [
  'Summarize my documents',
  'What are the key takeaways?',
  'Find anything about deadlines',
]

export function Chat({ onAuthError }: { onAuthError: () => void }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState(false)
  const threadRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Keep the latest message in view as tokens arrive.
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  // Auto-grow the composer with its content.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [draft])

  async function send(text: string) {
    const message = text.trim()
    if (!message || streaming) return

    setDraft('')
    setMessages((m) => [...m, { role: 'user', text: message }, { role: 'assistant', text: '' }])
    setStreaming(true)

    try {
      await streamChat(message, (token) => {
        setMessages((m) => {
          const next = [...m]
          next[next.length - 1] = { role: 'assistant', text: next[next.length - 1].text + token }
          return next
        })
      })
    } catch (err) {
      if (err instanceof AuthError) {
        onAuthError();
        return
      }
      const msg = err instanceof Error ? err.message : 'Something went wrong. Please try again.'
      setMessages((m) => {
        const next = [...m]
        next[next.length - 1] = { role: 'assistant', text: msg }
        return next
      })
    } finally {
      setStreaming(false)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send(draft)
    }
  }

  const lastIsStreamingAssistant =
    streaming && messages.length > 0 && messages[messages.length - 1].role === 'assistant'

  return (
    <main className="chat">
      <div className="thread" ref={threadRef}>
        {messages.length === 0 ? (
          <div className="welcome">
            <h1>Ask anything about <em>your documents</em>.</h1>
            <p>Add files to your library, then start a conversation — answers come straight from what you’ve shared.</p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="suggestion" onClick={() => void send(s)}>{s}</button>
              ))}
            </div>
          </div>
        ) : (
          <div className="thread-inner">
            {messages.map((m, i) => {
              const isLast = i === messages.length - 1
              const showThinking = m.role === 'assistant' && m.text === '' && isLast && streaming
              const showCaret = m.role === 'assistant' && m.text !== '' && isLast && lastIsStreamingAssistant
              return (
                <div className={`msg ${m.role}`} key={i}>
                  <div className="bubble">
                    {showThinking
                      ? <span className="thinking"><span/><span/><span/></span>
                      : <>{renderRich(m.text)}{showCaret && <span className="caret"/>}</>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="composer-wrap">
        <div className="composer">
          <div className="composer-box">
            <textarea
              ref={textareaRef}
              rows={1}
              value={draft}
              placeholder="Send a message…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>
          <button
            className="send"
            aria-label="Send"
            disabled={!draft.trim() || streaming}
            onClick={() => void send(draft)}
          >
            <SendIcon/>
          </button>
        </div>
        <p className="composer-hint">Press Enter to send · Shift + Enter for a new line</p>
      </div>
    </main>
  )
}

/**
 * Render the few lightweight markdown marks the model tends to emit (**bold** and
 * `inline code`) as real elements, so a demo answer reads naturally instead of showing
 * raw asterisks. Newlines are preserved by the bubble's `white-space: pre-wrap`. This
 * deliberately stays tiny — no markdown dependency, and it renders via React nodes
 * (never raw HTML) so model output can't inject markup.
 */
function renderRich(text: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i}
                                                                 className="inline-code">{part.slice(1, -1)}</code>
    return part
  })
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M5 12l7-7 7 7"/>
    </svg>
  )
}
