import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import * as api from './api.js'

vi.mock('./api.js', async () => {
  const actual = await vi.importActual<typeof api>('./api.js')
  return {
    ...actual,
    fetchTransactionsSummary: vi.fn(),
    fetchImports: vi.fn(),
    fetchTransactions: vi.fn(),
  }
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Dashboard tab (default view)', () => {
  test('shows a loading state before the summary resolves', () => {
    vi.mocked(api.fetchTransactionsSummary).mockReturnValue(new Promise(() => {}))
    render(<App />)
    expect(screen.getByText('Loading summary…')).toBeInTheDocument()
  })

  test('shows an error message when the summary fetch fails', async () => {
    vi.mocked(api.fetchTransactionsSummary).mockRejectedValue(new Error('network down'))
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText('Unable to load dashboard summary. Please try again later.')).toBeInTheDocument()
    })
  })

  test('renders summary cards once data loads successfully', async () => {
    vi.mocked(api.fetchTransactionsSummary).mockResolvedValue({
      totalTransactions: 5,
      successfulTransactions: 3,
      failedTransactions: 1,
      pendingTransactions: 1,
      processedAmountsByCurrency: [{ currency: "USD", amount: "250.75" }],
      successRate: 60,
    })
    render(<App />)
    await waitFor(() => {
      expect(screen.queryByText('Loading summary…')).not.toBeInTheDocument()
    })
    expect(screen.queryByText('Unable to load dashboard summary. Please try again later.')).not.toBeInTheDocument()
  })
})

describe('Upload form', () => {
  test('shows a validation message when submitting with no file selected', async () => {
    const user = userEvent.setup()
    vi.mocked(api.fetchTransactionsSummary).mockResolvedValue({
      totalTransactions: 0,
      successfulTransactions: 0,
      failedTransactions: 0,
      pendingTransactions: 0,
      processedAmountsByCurrency: [],
      successRate: 0,
    })
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Upload' }))
    await user.click(screen.getByRole('button', { name: 'Upload Button' }))

    expect(screen.getByText('Please choose a file first.')).toBeInTheDocument()
  })

  test('uploads a selected file and shows the import result message', async () => {
    const user = userEvent.setup()
    vi.mocked(api.fetchTransactionsSummary).mockResolvedValue({
      totalTransactions: 0,
      successfulTransactions: 0,
      failedTransactions: 0,
      pendingTransactions: 0,
      processedAmountsByCurrency: [],
      successRate: 0,
    })
    vi.mocked(api.fetchTransactions).mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 10 })

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ successfulRows: 3, records: [] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Upload' }))

    const file = new File(['transactionId,amount\nTXN-1,10'], 'test.csv', { type: 'text/csv' })
    const fileInput = screen.getByLabelText('Choose File')
    await user.upload(fileInput, file)

    await user.click(screen.getByRole('button', { name: 'Upload Button' }))

    await waitFor(() => {
      expect(screen.getByText('3 records imported successfully')).toBeInTheDocument()
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/transactions/upload',
      expect.objectContaining({ method: 'POST' }),
    )

    vi.unstubAllGlobals()
  })

  test('shows an error message when the upload request fails', async () => {
    const user = userEvent.setup()
    vi.mocked(api.fetchTransactionsSummary).mockResolvedValue({
      totalTransactions: 0,
      successfulTransactions: 0,
      failedTransactions: 0,
      pendingTransactions: 0,
      processedAmountsByCurrency: [],
      successRate: 0,
    })

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'File is empty' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Upload' }))

    const file = new File([''], 'empty.csv', { type: 'text/csv' })
    const fileInput = screen.getByLabelText('Choose File')
    await user.upload(fileInput, file)
    await user.click(screen.getByRole('button', { name: 'Upload Button' }))

    await waitFor(() => {
      expect(screen.getByText('File is empty')).toBeInTheDocument()
    })

    vi.unstubAllGlobals()
  })
})
