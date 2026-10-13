# Pure Insights Command Center

A full-stack monitoring and monetization dashboard for report health, data quality, real-time alerts, and cloud cost attribution.

The application uses a **hybrid data architecture**: monitoring and telemetry can run on the supplied CSV/demo dataset, while cost attribution and reconciliation can use Snowflake when `DATA_SOURCE=snowflake` is configured.

## Features

- **Report monitoring:** report inventory, ownership, orphaned-report detection, and health metrics.
- **Role-based access control:** viewer, analyst, and admin permissions.
- **Real-time alerts:** WebSocket-based alert updates for latency breaches and failed refreshes.
- **Telemetry simulation:** replay, pause/resume controls, and synthetic test-event injection.
- **Data quality:** identify anomalies such as negative metering credits and missing report owners.
- **Cost attribution:** allocate Snowflake usage to reports and calculate unit cost per active view.
- **Reconciliation:** compare valid metered credits with attributed credits and separately track quarantined negative-credit windows.

## Technology stack

- Frontend: React and Vite
- Backend: Node.js and Express
- Real-time transport: WebSockets
- Cost analytics: Snowflake SQL and the Snowflake Node.js SDK
- Monitoring input: supplied CSV/demo data

## Requirements

- Node.js 20 or newer
- npm
- Snowflake credentials and permissions when running with the Snowflake cost data source

## Run locally

### 1. Configure the backend

From the repository root:

```bash
cd backend
npm install
```

Copy the root environment template to `backend/.env` and configure it for your intended mode. In PowerShell:

```powershell
Copy-Item ..\.env.example .env
```

Review the available environment variables before starting the server. Use demo mode for a local run without Snowflake credentials. For Snowflake cost analytics, set `DATA_SOURCE=snowflake` and configure the required Snowflake connection settings and access permissions.

Start the API:

```bash
npm start
```

The API listens at `http://localhost:4000` by default.

### 2. Start the frontend

Open a second terminal from the repository root:

```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL shown in the terminal, normally `http://localhost:5173`.

The frontend uses `http://localhost:4000` by default. If required, create `frontend/.env.local` with:

```dotenv
VITE_API_URL=http://localhost:4000
```

## Demo accounts

The local demo configuration provides these identities:

- `admin@pureinsights.demo` — administrative actions
- `analyst@pureinsights.demo` — analysis and report access
- `viewer@pureinsights.demo` — read-only access

Use the demo password configured by `DEMO_PASSWORD` in your local environment. Demo identities and development secrets are for local assessment use only. Never deploy them to production.

## Validation

Run backend checks from `backend/`:

```bash
npm test
npm run smoke
```

Build the frontend from `frontend/`:

```bash
npm install
npm run build
```

The smoke test covers authentication, role permissions, report ownership, cost reconciliation, anomaly reporting, WebSocket ticket security, and alert creation and resolution.

If the test suite is configured to run live Snowflake checks, those checks require valid credentials and network access. Keep credential-dependent integration tests distinct from offline tests when running in a clean environment.

## Documentation

- [`docs/API_WEBSOCKET_SPEC.md`](docs/API_WEBSOCKET_SPEC.md) — REST endpoints, permissions, WebSocket authentication, event types, and operational safeguards.
- [`docs/SNOWFLAKE_VALIDATION_EVIDENCE.md`](docs/SNOWFLAKE_VALIDATION_EVIDENCE.md) — observed Snowflake query results and validation qualifications.
- [`docs/SUBMISSION_VALIDATION.md`](docs/SUBMISSION_VALIDATION.md) — final verification checklist.
- [`snowflake/`](snowflake/) — setup, table, service-user, cost-attribution, and validation query scripts.

## Snowflake SQL execution

Review the SQL scripts in order:

1. `snowflake/01_setup.sql`
2. `snowflake/02_tables.sql`
3. `snowflake/03_service_user.sql`
4. `snowflake/04_cost_attribution.sql`
5. `snowflake/05_cost_queries.sql`

Run them only in an appropriate Snowflake development environment, after reviewing database, schema, warehouse, role, and privilege settings. The service-user script may require elevated administrative permissions; do not grant broad production privileges without review.

The validation evidence records the results observed during the documented Snowflake run. Re-run the queries in your target environment before relying on those values operationally.

## Important limitations

- This project is an assessment prototype, not a production-ready deployment.
- CSV/demo monitoring values are simulated or sample-derived and must not be presented as live production telemetry.
- Snowflake cost metrics are available only when the Snowflake data source is configured and functioning.
- Production deployment would require environment-specific security hardening, monitoring, operational procedures, and further validation.
