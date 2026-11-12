import { OpsCopilot } from './OpsCopilot'
import { API_BASE } from './api'
import { useEffect, useState } from 'react'
import { fetchImports, fetchTransactionsSummary, type ImportListResponse, type TransactionsSummary } from './api.js'
import { ImportsTable } from './ImportsTable.js'
import { SummaryCards } from './SummaryCards.js'
import { TransactionsTable } from './TransactionsTable.js'

function App() {
  const [activePage, setActivePage] = useState<'dashboard' | 'transactions' | 'imports' | 'upload' | 'copilot'>('dashboard')
  const [lastImportId, setLastImportId] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadMessage, setUploadMessage] = useState('')
  const [toastMessage, setToastMessage] = useState('')
  const [uploading, setUploading] = useState(false)
  const [importsResponse, setImportsResponse] = useState<ImportListResponse | null>(null)
  const [importsLoading, setImportsLoading] = useState(false)
  const [importsError, setImportsError] = useState('')
  const [importsPage, setImportsPage] = useState(1)
  const [summary, setSummary] = useState<TransactionsSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState('')

  useEffect(() => {
    if (activePage !== 'imports') {
      return
    }

    setImportsLoading(true)
    fetchImports({ page: importsPage })
      .then((data) => {
        setImportsResponse(data)
        setImportsError('')
      })
      .catch(() => {
        setImportsError('Unable to load imports. Please try again later.')
      })
      .finally(() => setImportsLoading(false))
  }, [activePage, importsPage])

  useEffect(() => {
    if (activePage !== 'dashboard') {
      return
    }

    setSummaryLoading(true)
    fetchTransactionsSummary()
      .then((data) => {
        setSummary(data)
        setSummaryError('')
      })
      .catch(() => {
        setSummaryError('Unable to load dashboard summary. Please try again later.')
      })
      .finally(() => setSummaryLoading(false))
  }, [activePage])

  const handleUpload = async () => {
    if (!selectedFile) {
      setUploadMessage('Please choose a file first.')
      return
    }

    setUploading(true)
    const formData = new FormData()
    formData.append('file', selectedFile)

    try {
      const response = await fetch(`${API_BASE}/transactions/upload`, {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()

      if (!response.ok) {
        setUploadMessage(data.message ?? 'Upload failed.')
        setUploading(false)
        return
      }

      const count = data.successfulRows ?? data.importedCount ?? (data.records ? data.records.length : 0)
      const successText = `${count} records imported successfully`
      setLastImportId(data.id || '')
      setUploadMessage(successText)
      setToastMessage(successText)
      setActivePage('transactions')
      setUploading(false)
      // auto-dismiss toast
      window.setTimeout(() => setToastMessage(''), 3000)
    } catch (error) {
      setUploadMessage('Upload failed. Please make sure the backend is running.')
      setUploading(false)
      console.error(error)
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <h1>Payment Ops</h1>
        <nav className="nav-links">
          <button
            type="button"
            className={activePage === 'dashboard' ? 'active' : ''}
            onClick={() => setActivePage('dashboard')}
          >
            Dashboard
          </button>
          <button
            type="button"
            className={activePage === 'transactions' ? 'active' : ''}
            onClick={() => setActivePage('transactions')}
          >
            Transactions
          </button>
          <button
            type="button"
            className={activePage === 'imports' ? 'active' : ''}
            onClick={() => setActivePage('imports')}
          >
            Imports
          </button>
          <button
            type="button"
            className={activePage === 'upload' ? 'active' : ''}
            onClick={() => setActivePage('upload')}
          >
            Upload
          </button>
          <button type="button" className={activePage === 'copilot' ? 'active' : ''} onClick={() => setActivePage('copilot')}>Ops Copilot</button>
        </nav>
      </aside>

      <section className="content-area">
        {activePage === 'copilot' && <OpsCopilot initialImportId={lastImportId} />}
        {activePage === 'dashboard' && (
          <div className="page-card">
            <h2>Dashboard</h2>
            {summaryLoading ? (
              <p>Loading summary…</p>
            ) : summaryError ? (
              <p>{summaryError}</p>
            ) : summary ? (
              <SummaryCards summary={summary} />
            ) : (
              <p>No summary available.</p>
            )}
          </div>
        )}

        {activePage === 'imports' && (
          <div className="page-card">
            <h2>Imports</h2>

            {importsLoading ? (
              <p>Loading imports…</p>
            ) : importsError ? (
              <p>{importsError}</p>
            ) : importsResponse ? (
              <ImportsTable importsResponse={importsResponse} onPageChange={setImportsPage} />
            ) : (
              <p>No imports to display.</p>
            )}
          </div>
        )}

        {activePage === 'transactions' && <TransactionsTable />}

        {activePage === 'upload' && (
          <div className="page-card upload-card">
            <h2>Upload Page</h2>
            <p>Use synthetic payment data only. Uploaded data may be sent to Claude when you run an investigation.</p>
            <label className="file-input-label">
              <span>Choose File</span>
              <input
                type="file"
                accept=".csv"
                onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              />
            </label>

            <button type="button" className="upload-button" onClick={handleUpload}>
              {uploading ? 'Uploading…' : 'Upload Button'}
            </button>
              {uploadMessage && <p className="upload-message">{uploadMessage}</p>}

          </div>
        )}
        {toastMessage && <div className="toast success">{toastMessage}</div>}
      </section>
    </main>
  )
}

export default App
