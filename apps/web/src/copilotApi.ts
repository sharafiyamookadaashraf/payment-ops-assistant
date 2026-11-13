import { API_BASE } from './api'
export type CopilotReport = {
  status: 'answer' | 'needs_clarification'; answer: string;
  facts: { id: string; label: string; value: string | number; unit: string }[];
  findings: { id: string; rule: string; severity: string; description: string; transactionIds: string[]; evidence: Record<string, unknown> }[];
  searchResults: { scope: Record<string, unknown>; rows: { transactionId: string; merchantId: string | null; amount: string; currency: string; status: string; createdAt: string }[]; truncated: boolean }[];
  warnings: string[]; source: 'postgres' | 'memory'; asOf: string; importId: string | null;
}
export type CopilotEvent = { type: 'progress'; message: string; tool?: string }
  | { type: 'report'; report: CopilotReport; usage: { inputTokens: number; outputTokens: number; toolCalls: number; rounds: number } }
  | { type: 'error'; message: string }

export async function askCopilot(question: string, importId: string, signal: AbortSignal, onEvent: (event: CopilotEvent) => void) {
  const response = await fetch(`${API_BASE}/api/ask`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ question, ...(importId.trim() ? { importId: importId.trim() } : {}) }), signal,
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.message || `Investigation failed (${response.status}).`)
  }
  if (!response.body) throw new Error('Streaming is unavailable in this browser.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let completed = false
  const dispatch = (frame: string) => {
    const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
    if (!data) return // heartbeat comment
    const event: CopilotEvent = JSON.parse(data)
    if (event.type === 'error') throw new Error(event.message)
    if (event.type === 'report') completed = true
    if (event.type !== 'progress' && event.type !== 'report') throw new Error('Unexpected stream event.')
    onEvent(event)
  }
  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      let end: number
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        dispatch(buffer.slice(0, end)); buffer = buffer.slice(end + 2)
      }
      if (done) break
    }
    if (!completed) throw new Error('The stream ended before a complete report arrived. Please retry.')
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
