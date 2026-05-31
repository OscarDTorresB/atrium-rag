/**
 * Turns the raw citation markers an answer carries into reader-friendly footnotes.
 *
 * The backend cites chunks with their retrieval position (`[2]`, `[4]`, …) — sparse and
 * arbitrary. Here we renumber them 1..n in the order they first appear, rewrite each
 * in-text marker into a `#cite-n` fragment link (which the Markdown renderer turns into a
 * superscript footnote ref), and group the cited documents with the footnote numbers that
 * point at each. Markers with no matching source (a model that invents one) are left as
 * plain text. Pure and presentation-only — none of this touches retrieval.
 */
import type { Source } from './api'

/** A cited document and the (renumbered) footnote numbers that reference it. */
export type CitedFile = { filename: string; numbers: number[] }

export type Annotated = { text: string; files: CitedFile[] }

export function annotateCitations(text: string, sources: Source[]): Annotated {
  const filenameByCite = new Map(sources.map((s) => [s.cite, s.filename]))
  const displayByCite = new Map<number, number>() // original cite -> 1..n footnote number

  // Renumber in reading order and rewrite each known marker into a footnote-ref link.
  // Code spans/fences are matched first and passed through untouched so an `arr[1]` index
  // is never mistaken for a citation; unresolved markers are escaped so Markdown can't
  // turn a stray `[1]` into a reference-style link.
  const annotated = text.replace(/(```[\s\S]*?```|`[^`]*`)|\[(\d+)\]/g, (_whole, code, digits) => {
    if (code) return code
    const cite = Number(digits)
    if (!filenameByCite.has(cite)) return `\\[${digits}\\]`
    let n = displayByCite.get(cite)
    if (n == null) {
      n = displayByCite.size + 1
      displayByCite.set(cite, n)
    }
    return `[${n}](#cite-${n})`
  })

  // Group filenames with their footnote numbers, ordered by footnote number.
  const numbersByFile = new Map<string, number[]>()
  for (const [cite, n] of displayByCite) {
    const filename = filenameByCite.get(cite)!
    numbersByFile.set(filename, [...(numbersByFile.get(filename) ?? []), n])
  }
  const files = [...numbersByFile].map(([filename, numbers]) => ({ filename, numbers }))

  return { text: annotated, files }
}
