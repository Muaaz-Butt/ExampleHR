# Technical Requirements Document (TRD)
## Time-Off Microservice — ExampleHR / ReadyOn

**Stack:** NestJS · SQLite · TypeORM  

---

## Table of Contents

1. [Objective](#objective)
2. [Context & User Personas](#context--user-personas)
3. [Challenges](#challenges)
4. [Suggested Solution](#suggested-solution)
5. [API Surface](#api-surface)
6. [Data Model](#data-model)
7. [Design Decisions](#design-decisions)
8. [Alternatives Considered](#alternatives-considered)
9. [Testing Strategy](#testing-strategy)
10. [Known Gaps & Future Work](#known-gaps--future-work)
11. [Deployment Notes](#deployment-notes)
12. [Deliverables](#deliverables)

---

## Objective

Build a Time-Off Microservice that manages the full lifecycle of an employee time-off request and maintains leave balance integrity in sync with an external Human Capital Management (HCM) system (e.g. Workday, SAP). The HCM is the authoritative source of truth for all balance data. This service acts as an intermediary layer that provides fast reads, validates writes against the HCM, and defends against inconsistency between the two systems.

---

## Context & User Personas

ExampleHR / ReadyOn is not the only system that writes to HCM. External events — work anniversaries, year-start resets, admin corrections — can change an employee's HCM balance at any time, without notifying this service. The core problem is **keeping two systems consistent when either can change independently**.

| Persona | Goal | Pain Point |
|---|---|---|
| **Employee** | See an accurate balance; get instant feedback when submitting a request | Submitting a request and not knowing if it was accepted |
| **Manager** | Approve requests with confidence that the data is valid | Approving based on stale balance data that HCM later rejects |

---

## Challenges

### Challenge 1 — HCM error signaling is not guaranteed

The assignment explicitly states: *"We can count on HCM to send back errors… HOWEVER this may not be always guaranteed; we want to be defensive about it."*

HCM may return HTTP 200 with a response body that contains a negative or otherwise invalid `availableDays` value instead of a proper 4xx error. The service cannot rely solely on HCM HTTP status codes to block invalid operations.

**Mitigation:** Every HCM response is validated structurally (required fields, correct types, finite number) and semantically (non-negative `availableDays`). Any response that fails either check is treated as an HCM failure and the operation is blocked. This validation runs in `HcmClientService.validateBalanceResponse()` and is applied to both `fetchBalance` and `fileTimeOff` responses.

---

### Challenge 2 — External balance drift

HCM balance can change without this service being notified. A work anniversary bonus, a year-start reset, or an admin correction can reduce or increase an employee's balance between the moment a request is created (PENDING) and the moment it is approved. Without a re-check at approval time, the service could approve a request against a balance that no longer exists.

**Mitigation:**
- On **request creation**: fetch fresh balance from HCM (not just local cache) before creating the PENDING record.
- On **approval**: re-fetch from HCM immediately before filing the time-off, then file and update the local cache atomically. This second HCM call is the critical safety net against drift.
- On **external HCM push**: the `POST /api/time-off/balances/sync` endpoint accepts a full batch of balance updates from HCM (e.g. after an anniversary run) and upserts them into the local cache.

---

### Challenge 3 — Concurrent approval race conditions

Two managers approving the same employee's request simultaneously, or two requests for the same employee being approved in parallel, can cause a double-debit of balance. Without coordination, both approve flows can read the same stale balance, pass the local check, and both file against HCM.

**Mitigation:** Every approval is wrapped in a `DataSource.transaction()`. This serialises write operations at the database level. Note: SQLite does not support row-level pessimistic locking (`SELECT ... FOR UPDATE`). Under SQLite's Write-Ahead Logging (WAL) mode, concurrent write transactions are serialised by the SQLite engine itself, which is sufficient for this use case. If the deployment needs true row-level locking, the database layer should be migrated to PostgreSQL (see Alternatives).

---

### Challenge 4 — Pending requests do not reserve balance

When a PENDING request is created, the local balance cache is not decremented. An employee with 5 available days can submit three separate 3-day PENDING requests — each one will pass the HCM check at creation time because the balance has not been reserved. This is a fundamental tension between optimistic UX (instant feedback) and strict integrity (no over-commitment).

**Mitigation (current):** Re-validate against HCM at approval time. The first approval debits HCM; subsequent approvals for the same employee will fail at the HCM re-fetch step because HCM's balance will now be insufficient. The employee may see a misleadingly positive balance during the PENDING window.

**Known limitation:** This is an acceptable trade-off under the current scope. The complete solution is a balance reservation system (see Known Gaps).

---

### Challenge 5 — Local cache staleness on read

`GET /api/time-off/balances` returns the local SQLite cache by default. If HCM updated the balance externally and no batch sync has been triggered, the cached value will be stale.

**Mitigation:** The endpoint accepts a `?refresh=true` query parameter that forces a live HCM fetch and overwrites the cached value before returning. Employees who need an authoritative balance can explicitly request a refresh.

---

### Challenge 6 — Duplicate request submissions

Network retries or double-clicks can cause the same time-off request to be submitted twice, resulting in two PENDING records for the same date range.

**Mitigation:** On request creation, the service checks for an existing request with the same `employeeId`, `locationId`, `startDate`, and `endDate`. If one exists, a `400 Bad Request` is returned immediately without hitting HCM.

---

## Suggested Solution

### Architecture Overview

```
Employee / Manager
       │
       ▼
┌─────────────────────────────────────────────────┐
│              NestJS Application                 │
│                                                 │
│  ┌─────────────────┐     ┌───────────────────┐  │
│  │ TimeOffController│    │   HcmController   │  │
│  │  /api/time-off/* │    │   /hcm/*          │  │
│  └────────┬─────────┘    │ (embedded mock)   │  │
│           │              └───────────────────┘  │
│  ┌────────▼─────────┐                           │
│  │  TimeOffService  │                           │
│  │  (business logic)│                           │
│  └────────┬─────────┘                           │
│           │                                     │
│  ┌────────▼─────────┐    ┌───────────────────┐  │
│  │   TypeORM /      │    │  HcmClientService │  │
│  │   SQLite cache   │    │  (HTTP to HCM)    │  │
│  └──────────────────┘    └─────────┬─────────┘  │
└─────────────────────────────────────┼───────────┘
                                      │
                                      ▼
                            External HCM (Workday / SAP)
                            or embedded /hcm/* mock
```

### Two-Layer Balance Validation

Every write operation goes through two sequential checks:

1. **Local cache pre-check** — zero-latency short-circuit. If the local SQLite cache already shows insufficient balance, the operation is rejected immediately without making an HCM network call.
2. **HCM authoritative check** — a live fetch from HCM before every state-changing operation (create and approve). This is the definitive guard and cannot be bypassed.

This design tolerates brief HCM unavailability for read operations (employees see cached balance) while remaining strict on writes (all writes require a live HCM confirmation).

### Request Lifecycle

```
[Employee submits]
      │
      ├─ Duplicate check (local DB)
      ├─ Local cache pre-check (fast fail)
      ├─ HCM fetchBalance (authoritative)
      └─ Save PENDING record
                │
       [Manager acts]
                │
         ┌──────┴──────┐
         │             │
      Approve        Reject
         │             │
         ├─ Begin DB   └─ Mark REJECTED
         │   transaction    + reason
         ├─ HCM fetchBalance (re-check drift)
         ├─ HCM fileTimeOff (debit)
         ├─ Update local cache
         └─ Mark APPROVED
```

### Embedded HCM Mock

An in-process `HcmModule` is included in the application and exposes `/hcm/*` routes. This serves two purposes:

1. **Local development**: the service can run fully standalone without a real Workday/SAP connection.
2. **E2E testing**: the e2e test suite starts a separate real HTTP server (not the embedded module) using the same mock logic, ensuring tests are isolated and do not share state with the running application.

The mock maintains an in-memory balance map keyed by `employeeId:locationId`. It correctly enforces insufficient balance errors and supports batch sync updates.

---

## API Surface

All endpoints are prefixed with `/api`. The embedded HCM mock is available at `/hcm` (no prefix).

### Time-Off Endpoints

#### `POST /api/time-off/requests`
Create a new time-off request.

**Body:**
```json
{
  "employeeId": "emp1",
  "locationId": "locA",
  "days": 2,
  "startDate": "2026-05-05",
  "endDate": "2026-05-06"
}
```

**Validation:**
- `days` must be ≥ 0.5
- `days` must not exceed the calendar span of `startDate` to `endDate` (inclusive)
- `endDate` must not be before `startDate`

**Response:** `201 Created` — the created `TimeOffRequest` object with `status: "PENDING"`

**Error cases:**
- `400` — duplicate request for same dates
- `400` — insufficient local or HCM balance
- `503` — HCM unavailable

---

#### `POST /api/time-off/requests/:id/approve`
Approve a pending request.

**Flow:** Re-fetches HCM balance → files time-off with HCM → updates local cache → marks request APPROVED. All mutations are wrapped in a database transaction.

**Response:** `201 Created` — the updated `TimeOffRequest` with `status: "APPROVED"`

**Error cases:**
- `404` — request not found
- `400` — request is not in PENDING status
- `400` — insufficient local or HCM balance (drift detected)
- `503` — HCM unavailable

---

#### `POST /api/time-off/requests/:id/reject`
Reject a pending request.

**Body (optional):**
```json
{ "rejectionReason": "Coverage conflict on those dates" }
```

**Validation:** If `rejectionReason` is provided, it must be at least 10 characters.

**Response:** `201 Created` — the updated `TimeOffRequest` with `status: "REJECTED"`

---

#### `GET /api/time-off/requests`
List requests with optional filters.

**Query params:** `employeeId`, `locationId` (both optional)

**Response:** `200 OK` — array of `TimeOffRequest`, ordered by `requestedAt DESC`

---

#### `GET /api/time-off/balances`
Get leave balance for an employee at a location.

**Query params:** `employeeId` (required), `locationId` (required), `refresh` (optional boolean)

**Behaviour:**
- `refresh=false` (default) — returns cached local value
- `refresh=true` — fetches from HCM, updates cache, returns fresh value

**Response:** `200 OK` — `Balance` object

---

#### `POST /api/time-off/balances/sync`
Receive a batch balance update from HCM. Used for anniversary bonuses, year-start resets, and admin corrections.

**Body:**
```json
{
  "balances": [
    { "employeeId": "emp1", "locationId": "locA", "availableDays": 15 }
  ]
}
```

**Behaviour:** Upserts all records based on `(employeeId, locationId)` composite key. Idempotent — calling with the same data twice has no side effect.

**Response:** `201 Created` — array of upserted `Balance` objects

---

### Embedded HCM Mock Endpoints

These endpoints are only for local development and testing. They are excluded from the `/api` prefix.

| Method | Path | Description |
|---|---|---|
| `GET` | `/hcm/balance` | Fetch balance for employee + location |
| `POST` | `/hcm/timeoff` | File time-off (debits balance) |
| `POST` | `/hcm/batch-sync` | Update multiple balances at once |

---

## Data Model

### `balance` table

| Column | Type | Notes |
|---|---|---|
| `id` | UUID (PK) | Auto-generated |
| `employeeId` | varchar | |
| `locationId` | varchar | |
| `availableDays` | real | Supports half-days |
| `source` | varchar | Always `'HCM'` |
| `createdAt` | datetime | Auto-set |
| `updatedAt` | datetime | Auto-updated |

Unique constraint: `(employeeId, locationId)`

### `time_off_request` table

| Column | Type | Notes |
|---|---|---|
| `id` | UUID (PK) | Auto-generated |
| `employeeId` | varchar | |
| `locationId` | varchar | |
| `days` | real | Supports half-days |
| `startDate` | varchar | ISO date string |
| `endDate` | varchar | ISO date string |
| `status` | varchar | `PENDING`, `APPROVED`, `REJECTED` |
| `rejectionReason` | text | Nullable |
| `requestedAt` | datetime | Auto-set |
| `updatedAt` | datetime | Auto-updated |

---

## Design Decisions

### HCM as the authoritative source of truth
Local SQLite is a cache, not a ledger. Every balance-affecting decision (create, approve) fetches a live value from HCM. The local cache exists to serve fast reads and provide a short-circuit when the cache clearly shows insufficient balance — it is never the sole decision-maker for writes.

### Database transactions on all state-changing approve/reject flows
`approveRequest` and `rejectRequest` are wrapped in `DataSource.transaction()`. This prevents a partially-written state (e.g., HCM debited but local cache not updated) from leaving the system in an inconsistent state. If any step within the transaction throws, all changes are rolled back.

### `synchronize: !isProduction`
TypeORM's `synchronize` option auto-applies schema changes on startup. This is enabled in development and disabled in production (`NODE_ENV=production`) to prevent accidental schema mutations. Production deployments should use TypeORM migrations.

### ConfigModule with startup validation
`ConfigModule.forRoot({ validate })` throws at startup if `HCM_API_BASE_URL` is not set, giving a clear misconfiguration error rather than silently failing at the first HCM call.

### Structural + semantic HCM response validation
Because HCM errors are not guaranteed, every response is validated for structure (required fields, correct types) and semantics (non-negative balance). This is implemented in `HcmClientService.validateBalanceResponse()`.

---

## Alternatives Considered

### 1. Event-driven architecture (message queue)

**Description:** Instead of synchronous REST calls to HCM, publish events to a queue (RabbitMQ, Kafka). HCM publishes balance change events; this service subscribes and updates its cache asynchronously.

**Advantages:**
- Decoupled — HCM outages don't block employee requests
- Naturally handles the "HCM updates independently" scenario
- Audit log built-in via event stream

**Why rejected for this scope:**
- Requires additional infrastructure (broker, consumer group management)
- Eventual consistency means there is a window where the local balance is wrong — unacceptable for a financial-adjacent system without additional safeguards
- Significantly increases operational complexity for a proof-of-value implementation

**When to revisit:** If HCM latency becomes a problem at scale, or if HCM starts publishing webhook/event streams natively.

---

### 2. Full eventual consistency (no realtime validation)

**Description:** Accept all requests locally and reconcile with HCM asynchronously via scheduled jobs or webhooks. Never block an employee on a synchronous HCM call.

**Advantages:** Maximally resilient to HCM outages; instant UX

**Why rejected:** An employee could be approved for time off they don't have. Reconciliation after the fact requires a rollback workflow (notifying the employee their approval was reversed) which is worse UX than a pre-emptive block. The assignment explicitly requires defensive validation.

---

### 3. Pessimistic row-level locking (PostgreSQL)

**Description:** Use `SELECT ... FOR UPDATE` on the `Balance` row inside the approve transaction to prevent concurrent approvals from reading the same stale value.

**Advantages:** The strongest possible concurrency guarantee — exactly one transaction holds the lock at a time.

**Why not used:** SQLite does not support row-level locking. SQLite operates with a single writer at a time under WAL mode, which serialises concurrent write transactions at the engine level. This provides the same safety guarantee for our use case, without row-level granularity. **If this service is migrated to PostgreSQL in production, pessimistic locking should be added to `approveRequest`** using TypeORM's `lock: { mode: 'pessimistic_write' }` option.

---

### 4. Balance reservation on PENDING

**Description:** When a request is created and moves to PENDING, immediately deduct the requested days from the local balance cache (a "soft hold"). Release the hold on rejection; confirm it on approval.

**Advantages:** Prevents an employee from creating multiple overlapping PENDING requests that each individually pass the balance check.

**Why not used:** Adds significant complexity — the hold must be tracked separately from the confirmed balance, released correctly on rejection/expiry, and reconciled against HCM batch updates. Requires an additional `pendingDays` column or a separate `BalanceHold` entity.

**When to revisit:** If employees are observed gaming the system by creating multiple PENDING requests simultaneously. The current design catches this at approval time (only the first approval succeeds; subsequent ones fail the HCM re-check).

---

### 5. No local cache (always hit HCM)

**Description:** Remove SQLite entirely. Every read and write calls HCM directly.

**Advantages:** No cache staleness; no sync complexity.

**Why rejected:** HCM availability becomes a single point of failure for every read operation, including balance displays. HCM latency (200–500ms for enterprise systems) would be visible on every page load. The local cache allows the service to serve reads even during brief HCM outages and provides a fast-fail pre-check that avoids unnecessary HCM calls.

---

## Testing Strategy

The test suite is designed for regression protection and agentic development — tests document the expected system behaviour and guard against future changes breaking existing guarantees.

### Unit Tests (`src/time-off/time-off.service.spec.ts`)

All external dependencies (repositories, HCM client, DataSource) are mocked. Tests run in milliseconds with no I/O.

**Covered scenarios:**
- Creates a PENDING request when HCM balance is sufficient
- Blocks request creation when HCM balance is insufficient
- Blocks request creation when local cache already shows insufficient balance (without calling HCM)
- Blocks duplicate requests for the same employee, location, and dates
- Approves a PENDING request, calls HCM `fileTimeOff`, and updates local balance cache
- Blocks approval when local cached balance is insufficient (without calling HCM)
- Blocks approval when request is already APPROVED (double-approval guard)
- Blocks approval when HCM `fileTimeOff` returns a negative balance
- Rejects a PENDING request with an optional reason
- Blocks rejection when request is not in PENDING status
- Syncs batch balances using upsert (verifies single DB operation)

### E2E Tests (`test/app.e2e-spec.ts`)

A real NestJS application instance is started with an in-memory SQLite database. A separate real HTTP server (not the embedded HcmModule) is started on a random port and configured as `HCM_API_BASE_URL`. This ensures tests exercise the full request stack with real HTTP and real database writes.

**Covered scenarios:**
- Creates a time-off request and receives a PENDING response with a valid UUID
- Approves a request end-to-end and verifies the local cached balance is updated
- Rejects a request end-to-end and verifies the rejection reason is stored
- Batch sync updates the local balance and the new value is returned on the next balance read
- Blocks a new request when the mock HCM state is set to insufficient balance
- Returns HTTP 400 when `GET /balances` is called without required query parameters
- Verifies the Swagger UI is accessible at `/api/docs`
- Blocks approval of an already-approved request (second call returns 400)

### Mock HCM Server Design

The e2e mock server is a plain Node.js HTTP server with stateful in-memory balance storage. It:
- Returns the current balance for `GET /hcm/balance`
- Deducts days and returns the new balance for `POST /hcm/timeoff`; returns 400 if insufficient
- Updates balances for `POST /hcm/batch-sync`

This simulates real HCM behaviour including the insufficient-balance error path.

### Coverage

Run `npm run test:cov` to generate a coverage report in `coverage/`. The configuration in `jest.config.ts` collects coverage from all `src/**/*.ts` files (excluding `main.ts`).

---

## Known Gaps & Future Work

### Authentication & RBAC
No authentication is implemented. Any caller can approve, reject, or sync balances. Production deployment requires JWT or session-based auth with role guards: only managers should approve/reject; only trusted HCM IP ranges should post to the sync endpoint.

### Balance reservation on PENDING
As described in Alternatives, PENDING requests do not reserve balance. An employee can hold multiple overlapping PENDING requests. The first one approved will succeed; subsequent ones will fail at the HCM re-check. A future `BalanceHold` entity would enforce this at creation time.

### Scheduled HCM reconciliation
The service currently relies on HCM to push batch updates or on `?refresh=true` reads. It has no scheduled job that proactively polls HCM and compares cached values. A `ReconciliationService` with `@nestjs/schedule` and a configurable cron interval would close this gap.

### Audit log
There is no immutable record of who approved or rejected a request, or what the balance was at the time. A `TimeOffAuditLog` entity would record every state transition with actor, timestamp, and balance snapshot.

### Production database
SQLite is appropriate for proof-of-value and development. Production deployment should use PostgreSQL to gain row-level locking, connection pooling, and proper migration tooling. Switching requires only a TypeORM driver change and enabling pessimistic locking in `approveRequest`.

### Half-day validation with business day awareness
The `DaysWithinDateRange` validator checks that `days` does not exceed the calendar span. It does not validate against business days or public holidays. A calendar service would be needed for accurate business-day validation.

---

## Deployment Notes

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `HCM_API_BASE_URL` | Yes | — | URL of the HCM system. App will not start without this. |
| `SQLITE_DB_PATH` | No | `data/sqlite.db` | Path to the SQLite database file. Use `:memory:` for tests. |
| `PORT` | No | `3000` | HTTP port the app listens on. |
| `NODE_ENV` | No | `development` | Set to `production` to disable schema auto-sync. |

### Starting the service

```bash
cp .env.example .env          # copy and fill in HCM_API_BASE_URL
npm install
npm run start
```

### Running tests

```bash
npm test            # unit + e2e
npm run test:cov    # with coverage report
```

### Schema management

In development (`NODE_ENV != production`), TypeORM auto-synchronises the schema on startup. In production, disable auto-sync and use TypeORM migrations:

```bash
npx typeorm migration:generate -n InitialSchema
npx typeorm migration:run
```

---

## Deliverables

| Deliverable | Location |
|---|---|
| This TRD | `TRD.md` |
| NestJS source code | `src/` |
| Unit tests | `src/time-off/time-off.service.spec.ts` |
| E2E tests | `test/app.e2e-spec.ts` |
| Embedded HCM mock | `src/hcm/` |
| Coverage config | `jest.config.ts` |
| Architecture diagrams | `ARCHITECTURE.md` |
| Setup instructions | `README.md` |