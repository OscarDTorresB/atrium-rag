/**
 * Renders an assistant message as Markdown — code blocks, lists, headings, links,
 * tables, bold/italic and inline code — so answers read like a polished document.
 *
 * Built on `react-markdown` + `remark-gfm`. By design it renders to React nodes and
 * does NOT enable raw-HTML passthrough, so model output can never inject markup
 * (the same XSS-safety guarantee the old hand-rolled renderer had). Streaming works
 * for free: the accumulated text is re-parsed on each token, and CommonMark
 * auto-closes an as-yet-unclosed code fence, so partial answers render gracefully.
 */
import { type ReactElement, type ReactNode, isValidElement, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Fenced code blocks: react-markdown wraps them in <pre><code>. We take over
          // <pre> to render a titled block with a copy button, reading the language and
          // raw text off the child <code> element.
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          // Inline code has no language class; keep a fence's `language-*` class intact
          // so the <pre> takeover above can still read the language off this element.
          code: ({ className, children }) => (
            <code className={className ?? 'inline-code'}>{children}</code>
          ),
          // Open links in a new tab; react-markdown already blocks unsafe URLs.
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

/** A fenced code block: language label, copy-to-clipboard button, and the code. */
function CodeBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false)

  // `children` is the <code> element react-markdown built for the fence.
  const codeEl = isValidElement(children) ? (children as ReactElement<CodeProps>) : null
  const className = codeEl?.props.className ?? ''
  const lang = /language-(\w+)/.exec(className)?.[1]
  const code = String(codeEl?.props.children ?? '').replace(/\n$/, '')

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard can be unavailable (e.g. insecure context) — fail quietly.
    }
  }

  return (
    <div className="code-block">
      <div className="code-block-bar">
        <span className="code-lang">{lang ?? 'code'}</span>
        <button className="code-copy" onClick={copy} type="button">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre><code className={className}>{code}</code></pre>
    </div>
  )
}

type CodeProps = { className?: string; children?: ReactNode }
