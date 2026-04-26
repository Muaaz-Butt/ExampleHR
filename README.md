# Time-Off Microservice — ExampleHR / ReadyOn

A NestJS microservice that manages the full lifecycle of employee time-off requests and keeps leave balances in sync with an external Human Capital Management (HCM) system (e.g. Workday, SAP).

---

## What this service does

- Employees submit time-off requests. The service validates their leave balance against the HCM before accepting.
- Managers approve or reject requests. Every approval re-validates live against HCM to defend against balance drift.
- HCM can push batch balance updates (e.g. anniversary bonuses, year-start resets) via a sync endpoint.
- A local SQLite cache serves fast reads and acts as a first-line guard — the HCM is always the authoritative source of truth for writes.

For the full design rationale, challenges, and alternatives analysis see [`TRD.md`](./TRD.md).  
For architecture diagrams and data flows see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## Requirements

- Node.js 18 or higher
- npm 9 or higher

No other dependencies need to be installed manually — everything is declared in `package.json`.

---

## Quick Start

### 1. Clone and install

```bash
git clone <your-repo-url>
cd ExampleHR
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and set at minimum:

```env
HCM_API_BASE_URL=http://localhost:3000   # points to the embedded mock in development
PORT=3000
SQLITE_DB_PATH=data/sqlite.db
NODE_ENV=development
```

> **Note:** In local development, `HCM_API_BASE_URL=http://localhost:3000` makes the service call its own embedded `/hcm/*` mock endpoints. This allows fully standalone operation without a real Workday or SAP connection.

### 3. Start the service

```bash
npm run start
```

You should see:

```
[Nest] LOG [NestApplication] Nest application successfully started +Xms
```

The service is now running at `http://localhost:3000`.

### 4. Explore the API

Open your browser at:

```
http://localhost:3000/api/docs
```

This loads the Swagger UI with all endpoints documented and interactive.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `HCM_API_BASE_URL` | **Yes** | — | Base URL of the HCM system. The app will **not start** without this. |
| `SQLITE_DB_PATH` | No | `data/sqlite.db` | Path to the SQLite file. The `data/` directory is created automatically. Use `:memory:` for tests. |
| `PORT` | No | `3000` | HTTP port the app listens on. |
| `NODE_ENV` | No | `development` | Set to `production` to disable TypeORM auto-sync (use migrations instead). |

---

## API Reference

All endpoints are prefixed with `/api`. Full request/response schemas are in the Swagger UI.

### Time-Off Requests

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/time-off/requests` | Submit a new time-off request |
| `POST` | `/api/time-off/requests/:id/approve` | Approve a pending request |
| `POST` | `/api/time-off/requests/:id/reject` | Reject a pending request |
| `GET` | `/api/time-off/requests` | List requests (filter by `employeeId`, `locationId`) |

### Balances

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/time-off/balances` | Get cached balance (add `?refresh=true` to force HCM fetch) |
| `POST` | `/api/time-off/balances/sync` | Receive batch balance update from HCM |

### Embedded HCM Mock (development only)

| Method | Path | Description |
|---|---|---|
| `GET` | `/hcm/balance` | Get mock balance for an employee+location |
| `POST` | `/hcm/timeoff` | File time-off (debits balance, returns 400 if insufficient) |
| `POST` | `/hcm/batch-sync` | Update multiple balances in the mock |

---

## Example Requests

### Submit a time-off request

```bash
curl -X POST http://localhost:3000/api/time-off/requests \
  -H "Content-Type: application/json" \
  -d '{
    "employeeId": "emp1",
    "locationId": "locA",
    "days": 2,
    "startDate": "2026-05-05",
    "endDate": "2026-05-06"
  }'
```

### Approve it (use the `id` from the response above)

```bash
curl -X POST http://localhost:3000/api/time-off/requests/<id>/approve
```

### Check the updated balance

```bash
curl "http://localhost:3000/api/time-off/balances?employeeId=emp1&locationId=locA"
```

### Simulate an HCM anniversary bonus (batch sync)

```bash
curl -X POST http://localhost:3000/api/time-off/balances/sync \
  -H "Content-Type: application/json" \
  -d '{
    "balances": [
      { "employeeId": "emp1", "locationId": "locA", "availableDays": 15 }
    ]
  }'
```

---

## Running Tests

### Run all tests

```bash
npm test
```

This runs unit tests (`src/**/*.spec.ts`) and e2e tests (`test/**/*.e2e-spec.ts`).

### Run with coverage report

```bash
npm run test:cov
```

Coverage is collected from all `src/**/*.ts` files (excluding `main.ts`). The HTML report is generated in `coverage/lcov-report/index.html`.

### What is tested

**Unit tests** (`src/time-off/time-off.service.spec.ts`) — all external dependencies mocked, no I/O:
- Request creation with sufficient / insufficient HCM balance
- Local cache short-circuit (no HCM call when cache is clearly insufficient)
- Duplicate request detection
- Approval flow with HCM re-fetch and balance update
- Double-approval guard (second approve returns 400)
- Rejection with reason
- Batch balance sync via upsert

**E2E tests** (`test/app.e2e-spec.ts`) — real NestJS app, in-memory SQLite, real mock HCM HTTP server:
- Full create → approve → balance-updated flow
- Full create → reject → reason-stored flow
- Batch sync updates local balance
- Balance insufficient after HCM state change
- Missing required query params returns 400
- Swagger UI accessible at `/api/docs`
- Double-approval returns 400

---

## Development

### Watch mode (auto-restart on file changes)

```bash
npm run start:dev
```

### Build for production

```bash
npm run build
npm run start:prod
```

---

## Project Structure

```
src/
├── app.module.ts               Root module
├── main.ts                     Bootstrap (Swagger, global prefix, global pipes)
├── common/
│   ├── common.module.ts        Provides HcmClientService
│   └── hcm-client.service.ts  HTTP client for HCM with error handling
├── hcm/                        Embedded HCM mock (dev + testing)
│   ├── hcm.controller.ts
│   ├── hcm.service.ts
│   ├── hcm.module.ts
│   └── dto/hcm.dto.ts
└── time-off/
    ├── time-off.module.ts
    ├── time-off.controller.ts  HTTP routes
    ├── time-off.service.ts     Business logic + transactions
    ├── time-off.service.spec.ts Unit tests
    ├── dto/                    Request/response validation
    └── entities/               TypeORM entities

test/
└── app.e2e-spec.ts             End-to-end tests
```

---

## Key Design Decisions

**Two-layer balance validation** — every write goes through a fast local cache check first, then a live HCM authoritative check. The local check avoids unnecessary HCM calls; the HCM check cannot be bypassed.

**Database transactions** — approve and reject are wrapped in `DataSource.transaction()` to prevent partial writes. If HCM filing succeeds but the local cache update fails, the whole operation rolls back.

**Defensive HCM response validation** — HCM errors are not always guaranteed to come as 4xx responses. Every HCM response is validated for correct structure and non-negative balance values regardless of HTTP status.

**Embedded mock HCM** — the app includes a self-contained HCM mock at `/hcm/*` so it can run without a real Workday/SAP connection. The e2e test suite starts a separate real HTTP server with the same logic to avoid shared state.

**SQLite concurrency note** — SQLite does not support row-level pessimistic locking. `DataSource.transaction()` serialises writes at the engine level under WAL mode, which is sufficient for this use case. For production at scale, migrate to PostgreSQL and add `lock: { mode: 'pessimistic_write' }` to the approve flow.

---

## Deliverables Checklist

- [x] `TRD.md` — Technical Requirements Document with challenges, solution, and alternatives
- [x] `ARCHITECTURE.md` — System diagrams, data model, and request flows
- [x] `src/` — Full NestJS source code
- [x] `src/time-off/time-off.service.spec.ts` — Unit tests
- [x] `test/app.e2e-spec.ts` — E2E tests with real mock HCM server
- [x] `src/hcm/` — Embedded HCM mock for local development
- [x] `jest.config.ts` — Coverage configuration
- [x] Swagger UI at `/api/docs`