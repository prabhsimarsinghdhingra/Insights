# Pure Insights Command Center

A demo workflow for report-health monitoring, data-quality review, real-time alerts, and cost attribution. The current repository uses a **local CSV/demo data source**. Snowflake SQL assets are included, but the live Snowflake adapter is not implemented in this version; do not treat demo metrics as live warehouse results.

## Requirements

- Node.js 20 or newer
- npm

## Start the backend

```bash
cd backend
cp ../.env.example .env
npm install
npm start
```

The API listens at `http://localhost:4000` by default. Development demo accounts share the password `PureInsights#2026` unless `DEMO_PASSWORD` is set in `backend/.env`:

- `admin@pureinsights.demo` — admin actions, including acknowledging alerts and telemetry controls
- `analyst@pureinsights.demo` — analysis access
- `viewer@pureinsights.demo` — read-only access

These are demo identities only. Do not deploy the demo credentials or generated development JWT secret to production.

## Start the frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL shown in the terminal (normally `http://localhost:5173`). The frontend uses `http://localhost:4000` by default. To change this, create `frontend/.env.local` with:

```dotenv
VITE_API_URL=http://localhost:4000
```

## Verify

From `backend/`:

```bash
npm test
npm run smoke
```

From `frontend/`:

```bash
npm run build
```

Run these in your local environment after installing dependencies. A source-only ZIP does not prove that dependency installation, the full Express/JWT/WebSocket runtime, or a live Snowflake connection has been verified.

## Demo walkthrough

1. Sign in as the admin demo account.
2. Review the Overview KPIs and note the demo-data banner.
3. Open Live alerts and acknowledge an open alert if present.
4. Use **Inject test event** to submit a synthetic high-latency or failed-refresh reading and inspect the resulting alert.
5. Review report inventory and export its current result set as CSV.
6. Inspect data-quality exceptions and the cost reconciliation result.
7. Explain which metrics are derived from local sample data and which require live Snowflake validation.

## API areas used by the UI

- `GET /api/health/summary`
- `GET /api/reports`
- `GET /api/alerts`
- `POST /api/alerts/:id/ack`
- `GET /api/data-quality/anomalies`
- `GET /api/costs/attribution`
- `GET /api/costs/reconciliation`
- `GET /api/telemetry/status`
- `POST /api/telemetry/control`
- `POST /api/telemetry/inject`

## Important limitations

- The UI is intended as a prototype/demo, not a production deployment.
- Snowflake SQL scripts are provided under `snowflake/`, but live connection wiring and execution must be implemented and verified separately.
- Cost reconciliation currently evaluates the included simulated usage data. The dashboard explicitly labels the source as demo CSV.
- AI suggestion evaluation is represented by a validation checklist and traceability workflow concept; a production AI recommendation evaluator and human-review queue would require additional implementation.
