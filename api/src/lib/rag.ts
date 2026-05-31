/**
 * RAG building blocks powered by LangChain + Amazon Bedrock.
 *
 * - Splitting: turn a document into overlapping chunks small enough to embed and
 *   to fit into the chat prompt. Overlap keeps context from being cut mid-thought.
 * - Embedding: Bedrock Titan turns each chunk (and later, the question) into a
 *   1024-dim vector. Chunks → `embedDocuments`, a single query → `embedQuery`.
 */
import { BedrockEmbeddings, ChatBedrockConverse } from '@langchain/aws'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { config } from './config'

const embeddings = new BedrockEmbeddings({
  region: config.region,
  model: config.embeddingModelId,
})

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,   // characters per chunk
  chunkOverlap: 150, // characters shared between neighbours
})

/** Split raw document text into overlapping chunks. */
export function chunkText (text: string): Promise<string[]> {
  return splitter.splitText(text)
}

/** Embed many chunks at once (ingestion). */
export function embedChunks (chunks: string[]): Promise<number[][]> {
  return embeddings.embedDocuments(chunks)
}

/** Embed a single query string (chat retrieval). */
export function embedQuery (text: string): Promise<number[]> {
  return embeddings.embedQuery(text)
}

const chat = new ChatBedrockConverse({
  region: config.region,
  model: config.chatModelId,
  temperature: 0, // deterministic, fact-focused answers for a RAG demo
})

/**
 * Stream a grounded answer token-by-token. The model is instructed to answer only
 * from the retrieved `contexts`, so it stays anchored to the user's documents.
 */
export async function* streamAnswer (question: string, contexts: string[]): AsyncGenerator<string> {
  const contextBlock = contexts.map((text, i) => `[${i + 1}] ${text}`).join('\n\n')
  const system = new SystemMessage(
    'You are a helpful assistant. Answer the question using ONLY the context below. ' +
    'The context items are numbered [1], [2], and so on. After each statement in your ' +
    'answer, cite the number(s) of the context item(s) that support it in square brackets, ' +
    'e.g. "Revenue grew to $5M [2]." Cite only context that directly supports the statement; ' +
    'do not cite a context item you did not use. ' +
    'If the answer is not in the context, say you don\'t know and cite nothing.\n\n' +
    'Format your answer in Markdown: use ' +
    'lists for enumerations, **bold** for emphasis, and headings/tables where they aid clarity. ' +
    'Keep formatting purposeful — do not over-format plain prose.\n\n' +
    `Context:\n${contextBlock}`,
  )

  const stream = await chat.stream([system, new HumanMessage(question)])
  for await (const chunk of stream) {
    const { content } = chunk
    const text = typeof content === 'string'
      ? content
      : content.map((part) => ('text' in part ? part.text : '')).join('')
    if (text) yield text
  }
}

/**
 * The 1-based context numbers an answer cited via `[n]` markers, de-duplicated and in
 * ascending order. Numbers outside `1..max` (a model that invents a citation) are dropped,
 * so the caller can safely map each one back to its retrieved chunk.
 */
export function parseCitations (answer: string, max: number): number[] {
  // Citation markers only count in prose — strip code so an `arr[2]` index isn't read as one.
  const prose = answer.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '')
  const seen = new Set<number>()
  for (const [, digits] of prose.matchAll(/\[(\d+)\]/g)) {
    const n = Number(digits)
    if (n >= 1 && n <= max) seen.add(n)
  }
  return [...seen].sort((a, b) => a - b)
}
