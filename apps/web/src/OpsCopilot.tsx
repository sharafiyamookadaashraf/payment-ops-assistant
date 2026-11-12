import { useEffect, useRef, useState } from 'react'
import { askCopilot, type CopilotReport } from './copilotApi'
const prompts = ['Summarize payment outcomes and processed amounts by currency.', 'Investigate the failure spike on 2026-11-10. What do the recorded reasons show?', 'Which merchants have possible duplicate successful payments?']
export function OpsCopilot({ initialImportId = '' }: { initialImportId?: string }) {
  const [question, setQuestion] = useState('')
  const [importId, setImportId] = useState(initialImportId)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string[]>([])
  const [error, setError] = useState('')
  const [report, setReport] = useState<CopilotReport | null>(null)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  async function investigate() {
    if (!question.trim() || busy) return
    const request = new AbortController()
    controller.current = request
    setBusy(true); setError(''); setReport(null); setProgress([])
    try {
      await askCopilot(question.trim(), importId, request.signal, (event) => {
        if (request.signal.aborted) return
        if (event.type === 'progress') setProgress((previous) => [...previous, event.message])
        if (event.type === 'report') setReport(event.report)
      })
    } catch (failure) {
      setError(request.signal.aborted ? 'Investigation cancelled.' : failure instanceof Error ? failure.message : 'Unable to investigate.')
    } finally { if (controller.current === request) { controller.current = null; setBusy(false) } }
  }
  return <div className="copilot-layout">
    <header className="copilot-header">
      <div><p className="eyebrow">PAYMENT INVESTIGATIONS</p><h2>Ops Copilot</h2><p>Ask about outcomes, failure patterns and possible duplicates.</p></div>
      <span className="copilot-badge">Read only · Synthetic data</span>
    </header>
    <section className="page-card copilot-composer">
      <p className="copilot-intro">Claude investigates. Your backend calculates.</p>
      <div className="prompt-options" aria-label="Example questions">{prompts.map((prompt, index) => <button type="button" key={prompt} disabled={busy} onClick={() => setQuestion(prompt)}>{['Payment summary', 'Failure investigation', 'Duplicate checks'][index]}</button>)}</div>
      <form onSubmit={(event) => { event.preventDefault(); void investigate() }}>
        <label htmlFor="ops-question">What would you like to investigate?</label>
        <textarea id="ops-question" rows={3} maxLength={2000} value={question} disabled={busy} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask a question about the synthetic payments you uploaded…" required />
        <details><summary>Investigation scope</summary><label htmlFor="ops-import">Import ID (optional)</label><input id="ops-import" value={importId} maxLength={100} disabled={busy} onChange={(event) => setImportId(event.target.value)} placeholder="Leave empty for all imported payments" /><p>Dates use UTC. Use an exact calendar date when asking about a particular day.</p></details>
        <div className="copilot-actions"><span>Results include evidence and review candidates.</span><div>{busy && <button className="secondary-button" type="button" onClick={() => controller.current?.abort()}>Cancel</button>}<button className="upload-button" disabled={busy || !question.trim()}>{busy ? 'Investigating…' : 'Investigate'}</button></div></div>
      </form>
    </section>
    {progress.length > 0 && <details className="copilot-trace" open={busy}><summary aria-live="polite">{busy ? progress.at(-1) : 'Investigation steps'}</summary><ol>{progress.map((item, index) => <li key={index}>{item}</li>)}</ol></details>}
    {error && <p className="copilot-error" role="alert">{error}</p>}
    {report && <section className="page-card copilot-report" aria-label="Investigation report">
      <div className="copilot-report-heading"><h3>{report.status === 'needs_clarification' ? 'A little more context' : 'Investigation report'}</h3><span>{report.source === 'memory' ? 'In-memory demo' : 'PostgreSQL snapshot'}</span></div>
      <p className="copilot-answer">{report.answer}</p>
      <p className="copilot-caption">AI interpretation — review alongside the backend evidence below.</p>
      {report.facts.length > 0 && <div className="copilot-facts">{report.facts.map((fact) => <div className="copilot-fact" key={fact.id}><p>{fact.label}</p><strong>{fact.value}<small> {fact.unit}</small></strong><code>{fact.id}</code></div>)}</div>}
      {report.searchResults.map((result, index) => <div key={index}><h4>Matching transactions</h4><p className="copilot-caption">Filters: {JSON.stringify(result.scope)}{result.truncated ? ' · Results truncated; narrow the filters.' : ''}</p><div className="table-wrapper"><table><thead><tr><th>Transaction</th><th>Merchant</th><th>Amount</th><th>Status</th></tr></thead><tbody>{result.rows.map((row) => <tr key={row.transactionId}><td>{row.transactionId}</td><td>{row.merchantId || 'Not recorded'}</td><td>{row.amount} {row.currency}</td><td>{row.status}</td></tr>)}</tbody></table></div></div>)}
      {report.findings.length > 0 && <div className="copilot-findings"><h4>Items to review</h4>{report.findings.map((finding) => <article key={finding.id}><span className="status-badge status-badge--pending">Review</span><h4>{finding.rule === 'possible_duplicate' ? 'Possible duplicate payments' : 'Daily failure spike'}</h4><p>{finding.description}</p>{finding.transactionIds.length > 0 && <p className="transaction-references">{finding.transactionIds.join(', ')}</p>}<details><summary>Rule evidence</summary><pre>{JSON.stringify(finding.evidence, null, 2)}</pre></details></article>)}</div>}
      {report.warnings.length > 0 && <div className="copilot-limitations"><h4>Evidence limits</h4><ul>{report.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
      <p className="copilot-caption">Snapshot: {new Date(report.asOf).toLocaleString()} · {report.importId ? `Import ${report.importId}` : 'All imports'}</p>
    </section>}
  </div>
}
