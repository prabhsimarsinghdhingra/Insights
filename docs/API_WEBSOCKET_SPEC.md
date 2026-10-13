# Pure Insights Command Center — REST API & WebSocket Specification

## 1. Overview

The backend provides REST endpoints for authentication, report monitoring, data quality, telemetry, alerts, and cost attribution. WebSockets deliver live telemetry and alert events to connected clients.

- Local API URL: `http://localhost:4000`
- WebSocket path: `/ws/alerts`

## 2. Authentication and authorization

Authenticate using `POST /api/auth/login`. Use the returned bearer token in the `Authorization: Bearer <token>` header for protected REST requests.

Public endpoints:
- `GET /api/ping`
- `POST /api/auth/login`

`GET /api/auth/me` requires an authenticated user. Other routes require the permissions below.

| Permission | Operations |
|---|---|
| `health:read` | Read health summary |
| `reports:read` | List reports, list orphaned reports, read report details |
| `reports:assign` | Assign report owner |
| `alerts:read` | Read alerts and telemetry status; request WebSocket ticket |
| `alerts:ack` | Acknowledge alerts |
| `telemetry:control` | Control telemetry replay and inject test events |
| `dq:read` | Read data-quality anomalies |
| `costs:read` | Read cost attribution and reconciliation |

Role-to-permission mappings are configured in the backend. Missing or invalid authentication returns HTTP 401; insufficient permission returns HTTP 403.

## 3. REST endpoint catalogue

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/ping` | Public | Liveness check |
| POST | `/api/auth/login` | Public | Authenticate user |
| GET | `/api/auth/me` | Authenticated | Get current user identity and role |
| POST | `/api/auth/ws-ticket` | `alerts:read` | Issue a WebSocket ticket |
| GET | `/api/health/summary` | `health:read` | Monitoring summary |
| GET | `/api/reports` | `reports:read` | List reports |
| GET | `/api/reports/orphaned` | `reports:read` | List reports without valid owners |
| GET | `/api/reports/:id` | `reports:read` | Get report details |
| POST | `/api/reports/:id/owner` | `reports:assign` | Assign report owner |
| GET | `/api/alerts` | `alerts:read` | List alerts |
| POST | `/api/alerts/:id/ack` | `alerts:ack` | Acknowledge alert |
| GET | `/api/telemetry/status` | `alerts:read` | Get telemetry replay status |
| POST | `/api/telemetry/control` | `telemetry:control` | Pause or resume replay |
| POST | `/api/telemetry/inject` | `telemetry:control` | Inject synthetic event |
| GET | `/api/data-quality/anomalies` | `dq:read` | List data-quality anomalies |
| GET | `/api/costs/attribution` | `costs:read` | Report-level cost attribution |
| GET | `/api/costs/reconciliation` | `costs:read` | Metered-versus-attributed reconciliation |

## 4. Error behavior

Observed API behavior includes:

- `400 Bad Request`: malformed JSON or invalid parameters.
- `401 Unauthorized`: missing or invalid authentication, or invalid WebSocket ticket.
- `403 Forbidden`: insufficient permission.
- `404 Not Found`: unknown route or resource.
- `409 Conflict`: operation invalid for the resource's current state, such as acknowledging a resolved alert.

Consult the running API for exact error response bodies; this document does not prescribe unverified response schemas.

## 5. WebSocket authentication and connection

1. Call `POST /api/auth/ws-ticket` using normal bearer-token authentication.
2. Connect to `/ws/alerts?ticket=<ticket>` on the backend WebSocket origin.
3. Redeem the ticket within approximately 30 seconds. Tickets are single-use; missing, expired, or reused tickets are rejected.
4. After connection, the server sends an initial snapshot.
5. The server pushes subsequent telemetry and alert events as JSON text frames.

The short-lived ticket avoids putting the longer-lived JWT in the WebSocket URL.

## 6. WebSocket message format

Server-to-client messages use this JSON envelope:

```json
{
  "type": "snapshot",
  "ts": "ISO-8601 timestamp",
  "data": {}
}
```

Supported message types:

| Type | Meaning |
|---|---|
| `snapshot` | Initial state on connection |
| `telemetry.event` | Telemetry reading event |
| `telemetry.status` | Telemetry replay status |
| `alert.created` | New alert created |
| `alert.updated` | Existing alert updated |
| `alert.resolved` | Alert resolved |

The WebSocket channel is server-push only. Client messages are ignored, and inbound frames are limited to 1 KB.

## 7. Alert behavior

The telemetry engine evaluates incoming readings and emits typed events to connected clients.

- Latency above 15 seconds triggers a warning-level breach.
- Severe latency can escalate to critical severity.
- Failed or timed-out refreshes trigger critical alerts.
- Recovery can resolve alerts.
- Alert acknowledgement uses `POST /api/alerts/:id/ack` and requires `alerts:ack`.

The engine supports deduplication, escalation, downgrade, and automatic resolution.

## 8. WebSocket safeguards

The implementation includes:

- Configurable origin validation.
- Maximum client count, default 200.
- Heartbeat checks, default interval 30 seconds.
- Termination of clients that fail heartbeat checks.
- Termination of slow consumers exceeding the output-buffer threshold.
- Maximum inbound payload size of 1 KB.
- Single-use, expiring tickets with a cap on outstanding tickets.

## 9. Data-source behavior

The application supports a hybrid configuration: monitoring and telemetry can use CSV/demo data, while cost attribution and reconciliation can use Snowflake when `DATA_SOURCE=snowflake` is configured. Not every dashboard metric should be described as live Snowflake data.

## 10. Validation

From `backend/`, run:

```bash
npm test
npm run smoke
```

The smoke test exercises authentication, RBAC, report ownership, cost reconciliation, anomalies, WebSocket ticket security, and alert creation, acknowledgement, and resolution.

See `../snowflake/` for the SQL suite and `SNOWFLAKE_VALIDATION_EVIDENCE.md` for recorded query results.
