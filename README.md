# Payment Ops Assistant

![Dashboard](docs/screenshots/dashboard.png)

A production-inspired payment operations dashboard built with **React, TypeScript, Node.js, Express, Prisma, and PostgreSQL**.

The application simulates the type of internal tooling used by payment operations teams to import transaction exports, validate data quality, monitor processing metrics, and investigate failed imports.

**Synthetic data only.** This is a portfolio demo. Use the fictional CSVs in `sample-data/`; never upload real payment, customer or card data.

Rather than focusing on CRUD functionality, this project demonstrates backend architecture, validation pipelines, data persistence, and frontend dashboard development commonly found in fintech systems.

---

# ✨ Features

- CSV transaction import
- Comprehensive row-level validation
- Import history
- Dashboard analytics
- Scoped failure analytics with currency breakdowns and recorded failure reasons
- Transaction search
- Filtering
- Sorting
- Server-side pagination
- Row-level validation errors
- PostgreSQL persistence
- Automatic in-memory fallback when the database is unavailable

---

# 🛠 Tech Stack

## Frontend

- React
- TypeScript
- Vite
- CSS

## Backend

- Node.js
- Express
- TypeScript

## Database

- PostgreSQL
- Prisma ORM

## File Uploads

- Multer

---

# 🏗 Architecture

```text
React Dashboard
        │
        ▼
Express REST API
        │
CSV Validation Pipeline
        │
        ▼
Prisma ORM
        │
        ▼
PostgreSQL
```

The frontend communicates with a REST API responsible for validating uploaded CSV files, persisting successful transactions, recording validation failures, and exposing dashboard metrics.

---

# 📥 Import Workflow

```
Upload CSV
      │
      ▼
Validate File
      │
      ▼
Parse CSV
      │
      ▼
Validate Every Row
      │
      ├── Valid → Transaction
      │
      └── Invalid → ImportError
      │
      ▼
Update Import Summary
      │
      ▼
Dashboard & Import History
```

Every upload is tracked as an Import.

Each invalid row is stored independently with the row number and validation reason, allowing failed records to be reviewed without losing successful transactions.

---

# ✅ Validation Rules

The import pipeline validates:

- Required columns
- Duplicate transaction IDs
- Existing transaction IDs
- Invalid currencies
- Invalid payment statuses
- Invalid dates
- Negative amounts
- Empty files
- Non-CSV uploads
- Maximum file size
- Incorrect column counts

Validation errors are reported per row instead of failing the entire import.

---

# 📊 Dashboard

The dashboard provides operational metrics including:

- Total transactions
- Successful transactions
- Pending transactions
- Failed transactions
- Total processed amount
- Success rate

These metrics are aggregated by the backend rather than calculated on the client.

---

# Ops Copilot — in progress

Ops Copilot extends this application in course order: **Claude API → MCP → Agent Skills → Claude Code**. The first increment is a deterministic failure-analysis endpoint; Claude integration is not implemented yet.

`GET /api/analytics/failures?from=2026-11-10&to=2026-11-11` returns counts, failure rates, currency breakdowns and recorded failure reasons for a UTC date range. The backend computes every figure. An empty dataset has a `null` failure rate, and the response identifies PostgreSQL versus demo memory as its source.

The target architecture below includes later milestones, marked **planned**:

```mermaid
flowchart TD
    UI["React dashboard / Copilot planned"] --> API["Express API"]
    API <--> Claude["Claude API — planned"]
    API --> Tools["Shared tools — planned"]
    Client["Claude Desktop / Code — planned"] --> MCP["MCP server — planned"]
    MCP --> Tools
    Tools --> Analytics["Analytics and repository functions"]
    API --> Analytics
    Analytics --> DB["PostgreSQL"]
    Skills["Ops runbook skills — planned"] -. guide investigations .-> Client
```

See [the build sequence, API contract and reproducible demo](docs/ops-copilot.md). Monetary analytics require exact decimal storage first; the current schema uses `Float`. Merchant-level investigations also require a merchant identifier, which the schema does not yet contain.

---

# 🔍 Transactions

The transaction view supports:

- Server-side pagination
- Debounced search
- Status filtering
- Currency filtering
- Date range filtering
- Sortable columns

This keeps the frontend lightweight while allowing the backend to handle querying and aggregation.

---

# 📜 Import History

Every upload generates an Import record containing:

- Filename
- Import status
- Processing time
- Total rows
- Successful rows
- Failed rows

Failed rows include detailed validation messages for troubleshooting.

---

# 🏛 Engineering Decisions

## Repository Pattern

Query and aggregation logic is isolated into repository classes.

This keeps Express route handlers focused on request handling while allowing data access to evolve independently.

---

## Prisma Driver Adapter

The project uses the Prisma 7 driver adapter (`@prisma/adapter-pg`) rather than relying on legacy Prisma connection configuration.

---

## Allow-List Validation

Currencies and statuses are validated against explicit allow-lists instead of accepting arbitrary strings.

This mirrors how production payment systems typically validate financial data.

---

## Graceful Database Fallback

If PostgreSQL is unavailable, the API automatically switches to an in-memory repository.

Although this introduces duplicated repository logic, it allows the application to remain functional during demonstrations without requiring a running database.

---

# ⚡ Trade-offs

Several implementation choices were made intentionally.

### No React Router

Navigation is implemented using component state.

For a four-page dashboard this keeps routing simple while avoiding unnecessary dependencies.

A larger application would benefit from route-based navigation.

---

### Custom CSV Parsing

The parser is implemented manually instead of using a dedicated CSV parsing library.

While sufficient for this project, production systems would likely rely on a mature parser to handle additional edge cases.

---

### Local API Configuration

The frontend currently uses a local API URL.

Production deployments should move this into environment variables.

---

### In-Memory Repository

Supporting both PostgreSQL and in-memory repositories increases code duplication.

The trade-off is improved demo resilience when a database isn't available.

---

# 📂 Project Structure

```
apps/
│
├── api/
│   ├── routes/
│   ├── repositories/
│   ├── services/
│   ├── prisma/
│   └── server.ts
│
└── web/
    ├── components/
    ├── pages/
    ├── hooks/
    └── App.tsx
```

---

# 🚀 Getting Started

## Prerequisites

- Node.js 18+
- PostgreSQL

## Install

```bash
cd apps/api
npm install

cd ../web
npm install
```

## Configure

Create a `.env` file:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/payment_ops"
```

## Database

```bash
npx prisma generate
npx prisma migrate dev
```

## Run

Terminal 1

```bash
cd apps/api
npm run dev
```

Terminal 2

```bash
cd apps/web
npm run dev
```

---

# 📡 API Endpoints

| Method | Endpoint | Purpose |
|---------|----------|----------|
| GET | `/health` | Health check |
| POST | `/api/imports` | Upload CSV |
| GET | `/api/imports` | Import history |
| GET | `/api/imports/:id` | Import details |
| GET | `/api/transactions` | Transactions |
| GET | `/api/transactions/summary` | Dashboard metrics |
| GET | `/api/analytics/failures` | Failure counts, rates and recorded reasons within a UTC range |

---

# 🚀 Future Improvements

- AI-powered operations assistant
- Expand automated coverage, including live PostgreSQL integration tests
- Environment-based frontend configuration
- Zod validation
- Request logging
- Rate limiting
- React Router
- Authentication & authorization

---

# 🎯 Why This Project?

Payment operations systems are significantly more than CRUD applications.

This project focuses on the types of engineering challenges commonly encountered in fintech platforms:

- Data validation
- Import pipelines
- Repository architecture
- Dashboard aggregation
- Backend pagination
- Transaction reconciliation
- Error reporting
- Production-oriented API design

The codebase is intentionally structured to demonstrate practical backend and frontend architecture while remaining compact enough to review during technical interviews.
