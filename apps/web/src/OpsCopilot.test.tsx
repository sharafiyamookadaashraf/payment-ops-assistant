import { afterEach, describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OpsCopilot } from './OpsCopilot'
import { askCopilot, type CopilotEvent } from './copilotApi'
const report: CopilotEvent = { type: 'report', report: { status: 'answer', answer: 'Found 20 transactions.', facts: [{ id: 'e1.total', label: 'Total transactions', value: 20, unit: 'transactions' }], findings: [], searchResults: [], warnings: ['Synthetic data only.'], source: 'memory', asOf: '2026-11-12T12:00:00Z', importId: null }, usage: { inputTokens: 10, outputTokens: 10, toolCalls: 1, rounds: 2 } }
const streamResponse = (frames: string[]) => new Response(new ReadableStream({ start(controller) { for (const frame of frames) controller.enqueue(new TextEncoder().encode(frame)); controller.close() } }), { headers: { 'Content-Type': 'text/event-stream' } })
afterEach(() => vi.unstubAllGlobals())
describe('Ops Copilot', () => {
  test('submits a selected example, streams progress and renders evidence', async () => {
    const user = userEvent.setup()
    const fetch = vi.fn().mockResolvedValue(streamResponse(['data: {"type":"progress","message":"Reading evidence…"}\n\n', `data: ${JSON.stringify(report)}\n\n`]))
    vi.stubGlobal('fetch', fetch)
    render(<OpsCopilot initialImportId="demo-import" />)
    await user.click(screen.getByRole('button', { name: 'Payment summary' }))
    await user.click(screen.getByRole('button', { name: 'Investigate' }))
    expect(await screen.findByText('Found 20 transactions.')).toBeInTheDocument()
    expect(screen.getByText('Total transactions')).toBeInTheDocument()
    expect(screen.getByText('Synthetic data only.')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('http://localhost:3001/api/ask', expect.objectContaining({ body: expect.stringContaining('demo-import') }))
  })
  test('shows missing server configuration without pretending to answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Ops Copilot is not configured.' }), { status: 503 })))
    const user = userEvent.setup(); render(<OpsCopilot />)
    await user.click(screen.getByRole('button', { name: 'Payment summary' })); await user.click(screen.getByRole('button', { name: 'Investigate' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('not configured')
    expect(screen.queryByLabelText('Investigation report')).not.toBeInTheDocument()
  })
  test('cancels an in-flight request', async () => {
    vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))))
    const user = userEvent.setup(); render(<OpsCopilot />)
    await user.click(screen.getByRole('button', { name: 'Payment summary' })); await user.click(screen.getByRole('button', { name: 'Investigate' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('cancelled')
  })
  test('SSE reader accepts split frames and rejects an incomplete stream', async () => {
    const serialized = `data: ${JSON.stringify(report)}\n\n`
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse([': heartbeat\n\n', serialized.slice(0, 18), serialized.slice(18)])))
    const events: CopilotEvent[] = []
    await askCopilot('summary', '', new AbortController().signal, (event) => events.push(event))
    expect(events).toEqual([report])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse(['data: {"type":"progress","message":"Reading"}\n\n'])))
    await expect(askCopilot('summary', '', new AbortController().signal, () => {})).rejects.toThrow('before a complete report')
  })
})
