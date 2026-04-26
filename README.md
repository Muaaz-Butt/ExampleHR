# Time-Off Microservice

NestJS microservice for managing time-off requests, preserving balance integrity, and syncing with an HCM backend.

## Non-Technical Quick Start

If you are not a coder, you can still run the system and check whether it works.

1. Open the Windows Terminal or PowerShell.
2. Go to the project folder:
   ```powershell
   cd "C:\path\to\Wizdaa_Home_Assignment"
   ```
   - Use the actual folder path where you saved the project.
3. Install the files the project needs:
   ```powershell
   npm install
   ```
4. Start the service:
   ```powershell
   npm run start
   ```
   - Wait until you see a message like `Nest application successfully started`.
   - This means the system is running.
5. Open a second terminal window and run a quick check script:
   ```powershell
   node scripts/check-request-flow.js
   ```
   - You should see output for:
     - `CREATE status`
     - `APPROVE status`
     - `GET REQUESTS status`
   - If these all show `200` or `201`, the system is working correctly.

### If you want a simpler check first

1. Make sure the service is running (`npm run start`).
2. In a new terminal, run:
   ```powershell
   node scripts/check-endpoints.js
   ```
3. You should see output for:
   - `POST /api/time-off/balances/sync status`
   - `GET /api/time-off/balances status`

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the service:
   ```bash
   npm run start
   ```
3. Run tests:
   ```bash
   npm test
   ```

## Notes

- API prefix: `/api`
- SQLite database path configurable via `SQLITE_DB_PATH`
  - You only need to set this if you want the database file in a different folder.
  - By default, the app will use `data/sqlite.db`.
  - The app will create the `data/` folder automatically when it starts.
- HCM base URL configurable via `HCM_API_BASE_URL`

## Deliverables Checklist

- [x] Technical Requirements Document in `TRD.md`
- [x] Full NestJS codebase in this repository
- [x] Unit and integration tests in `src/` and `test/`
- [x] Coverage configuration in `jest.config.ts`

## Coverage Proof

Run:
```bash
npm run test:cov
```

This generates a coverage report in the `coverage/` directory and proves that tests are executing against the application logic.

## Endpoint Validation Scripts

The repo includes test scripts for live endpoint validation:

- `node scripts/check-endpoints.js` — validates HCM batch sync and balance query
- `node scripts/check-request-flow.js` — validates request creation, approval, and request listing
