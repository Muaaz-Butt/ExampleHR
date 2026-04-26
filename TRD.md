# Technical Requirements Document

## Objective
Build a Time-Off Microservice for ReadyOn / ExampleHR that manages the lifecycle of employee requests, keeps leave balances accurate, and defends against HCM drift.

## Key Requirements
- Maintain per-employee, per-location leave balances.
- Ensure HCM remains the source of truth.
- Support realtime HCM validation when filing a time-off request.
- Accept batch balance updates from HCM.
- Defend against cases where HCM does not report errors consistently.
- Provide instant feedback to employees and trustable data for managers.

## System Overview

The service is built as a NestJS backend with SQLite persistence and a lightweight HCM client.

### Core entities
- `Balance`: local cache of HCM-permitted leave balances.
- `TimeOffRequest`: request lifecycle state with `PENDING`, `APPROVED`, and `REJECTED`.

### Data flow
1. An employee requests time off.
2. The service refreshes the balance from HCM.
3. If HCM confirms available days, the request is created.
4. On approval, the service files the time off against HCM and updates the local cache.
5. HCM can also send batch balance refreshes to keep local data in sync.

## API Surface

- `POST /api/time-off/requests`
  - Create a new time-off request.
  - Validates balance via HCM.

- `POST /api/time-off/requests/:id/approve`
  - Approve a pending request.
  - Files the request with HCM and updates cached balance.

- `GET /api/time-off/requests`
  - List existing requests with optional filtering by employee and location.

- `GET /api/time-off/balances`
  - Read local balance cache.
  - Optional `refresh=true` to refresh from HCM.

- `POST /api/time-off/balances/sync`
  - Receive HCM batch balance corpus.
  - Upserts local balances and reconciles stale data.

## Design Decisions

### Source of truth
- HCM is treated as authoritative.
- Local SQLite cache supports fast reads and request validation.
- The service refreshes balances from HCM before critical write operations.

### Balance safety
- Create and approve flows both validate with HCM.
- The service is defensive: if HCM is unavailable or returns invalid data, the request is blocked.

### Batch sync
- Batch balance refresh is idempotent and merges based on `employeeId` + `locationId`.
- This supports independent HCM updates such as anniversary bonuses or yearly resets.

## Alternatives Considered

1. Event-driven architecture with message queue
   - More robust for cross-system events.
   - Rejected for this scope in favor of REST endpoints and a lightweight service.

2. Full eventual consistency without realtime validation
   - Simpler, but too risky for balance-sensitive approvals.
   - Chosen approach uses strong validation on approve.

3. Distributed cache / no local persistence
   - Could improve performance, but local SQLite cache simplifies integration and tests.

## Testing Strategy

The system uses a combination of unit and integration tests to achieve strong regression protection and ensure the service remains robust as requirements evolve.

- **Unit tests** cover the critical business rules in `TimeOffService`:
  - request creation validation against HCM balance
  - approval authorization flow for pending requests
  - balance reconciliation from HCM responses
- **Integration/E2E tests** use a real NestJS application instance and a local mock HCM server, which simulates:
  - realtime HCM balance lookup
  - HCM time-off filing behavior
  - batch balance sync updates
- The test suite is intentionally designed for agentic development: the service logic is driven by testable requirements, and the tests document expected HCM interactions and defensive behavior.
- Coverage configuration is enabled in `jest.config.ts`, so the project can generate proof of coverage with `npm run test:cov`.

Test coverage specifically guards against regressions in the following scenarios:
  - creating a request when HCM balance is sufficient
  - rejecting a request when HCM balance is insufficient
  - approving a pending request only once
  - updating cached balance after approval
  - syncing external batch HCM updates
  - rejecting requests when HCM balance has drifted downward

## Design Thinking and Architecture

- The core design treats HCM as the authoritative source of truth while maintaining a local SQLite cache for faster read operations and request validation.
- We chose NestJS because it provides strong module organization, dependency injection, and a clear structure for REST API services.
- The service is intentionally small and focused: a `TimeOffService` handles lifecycle rules, a `Balance` entity stores per-employee per-location state, and a `HcmClientService` encapsulates remote HCM communication.
- The decision to validate balances on both request creation and approval is a defensive choice to protect against stale local state and possible external HCM updates.
- Batch sync support is included to model HCM-driven balance refreshes such as anniversary bonus or yearly resets, which aligns with the requirement that HCM updates can happen independently.

## Known Gaps and Future Improvements

The current implementation deliberately stays within the described scope. It covers the main time-off lifecycle, HCM sync, and defensive validation, but there are additional capabilities that would strengthen the system if added later:

- **Manager approval role**
  - The system currently supports request approval, but it does not enforce a separate manager role or RBAC policy.
  - Future work: add authentication, role-based guards, and manager-specific approval endpoints.

- **Explicit rejection endpoint**
  - Requests may be rejected indirectly through validation failure, but there is no dedicated `POST /requests/:id/reject` endpoint.
  - Future work: add a rejection workflow for manager decisioning with rejection reason tracking.

- **Better HCM defensive reconciliation**
  - The implementation is defensive at request time, but it does not yet include automatic reconciliation for cases where HCM silently changes balance without immediate request activity.
  - Future work: add periodic reconciliation jobs or event-driven reconciliation that compares local cache with HCM values and resolves drift.

- **More explicit HCM drift recovery flow**
  - A batch sync endpoint exists, but the system does not yet proactively detect and recover from drift.
  - Future work: implement a reconciliation service, scheduled batch refreshes, audits for balance mismatches, and alerts for inconsistent state.

## Deployment Notes

- The service can run with `npm run start`.
- `HCM_API_BASE_URL` must point to the HCM service used by the customer.
- SQLite is used for ease of local development and proof-of-value.

## Deliverables Proof

- `TRD.md` contains the functional requirements, architecture, design reasoning, testing strategy, and gaps.
- Code lives in `src/` and common supporting files at the repository root.
- Tests are implemented in `src/time-off/time-off.service.spec.ts` and `test/app.e2e-spec.ts`.
- Coverage is configured via `jest.config.ts`; run `npm run test:cov` to generate a report.

