# Submission Validation Notes

## 1. Validation summary

Validation performed locally on 14 October 2026 for the Pure Insights Command Center assessment.

| Check | Observed result | Status |
|---|---|---|
| Backend automated tests | 40 passed, 0 failed | PASS |
| Backend smoke test | All checks passed | PASS |
| Frontend production build | Vite build completed successfully; 1,571 modules transformed | PASS |
| Role-based access control | Viewer, analyst, and admin access checks passed in smoke test | PASS |
| Report ownership workflow | Admin assigned an owner; orphan count decreased from 14 to 13 | PASS |
| WebSocket ticket security | Missing and reused tickets rejected; valid ticket connected | PASS |
| Real-time alerts | Injected 55-second latency and failed refresh produced two critical alerts | PASS |
| Alert lifecycle | Creation, acknowledgement, and resolution events verified | PASS |
| Snowflake credit reconciliation | Observed valid metered credits and attributed credits both 1,206,352.48; unattributed credits 0 | PASS for observed query results |
| Attribution validation | 100 reports checked; 0 outside 0.05-credit tolerance; maximum absolute difference 0.007183418937 | PASS for observed query results |
| Negative-credit anomalies | 24 negative-credit rows totalling -161.04 credits observed | PASS for observed query results |
| Negative-credit exclusion logic | SQL filters valid windows with `credits_used >= 0` and reports negative windows separately | IMPLEMENTED; query results observed |
| API/WebSocket documentation | `docs/API_WEBSOCKET_SPEC.md` created | DOCUMENTED |
| Clean installation from scratch | Not yet independently verified | PENDING |
| CSV export content | Not separately verified in this audit | PENDING |
| Final secret scan and clean submission archive | Must be checked before submission | PENDING |

## 2. Data-source architecture

The application supports a hybrid data configuration:

- Monitoring and telemetry can use the supplied CSV/demo dataset.
- Cost attribution and reconciliation can use Snowflake when `DATA_SOURCE=snowflake` is configured.
- Dashboard metrics must be interpreted according to their source; CSV/demo monitoring values are not live production telemetry.

The Snowflake validation evidence records query results observed in the user's Snowflake environment. Those results should not be interpreted as proof that every part of the application uses live Snowflake data.

## 3. Snowflake validation

The observed validation results are recorded in `SNOWFLAKE_VALIDATION_EVIDENCE.md`.

Key results:

- Valid metered credits: 1,206,352.48.
- Attributed credits: 1,206,352.48.
- Unattributed credits: 0.
- Quarantined negative-credit windows: 24.
- Quarantined negative credits: -161.04.
- Reports checked: 100.
- Reports outside tolerance: 0.
- Maximum absolute attribution difference: 0.007183418937 credits.
- Attribution tolerance: 0.05 credits.

The SQL in `snowflake/04_cost_attribution.sql` filters negative-credit windows from valid allocation and reports them separately. These observed results support reconciliation for the tested dataset; they do not prove correctness for every possible data condition.

## 4. Commands used for local validation

Backend tests, from `backend/`:

```bash
npm test
npm run smoke
```

Frontend production build, from `frontend/`:

```bash
npm run build
```

The reported backend test run included live Snowflake checks. Re-running the full test suite may therefore require valid Snowflake credentials and network access. Confirm the test configuration before claiming that all tests can run offline.

## 5. Remaining checks before submission

- [ ] Perform a clean installation using the documented setup instructions.
- [ ] Verify CSV export contents against the displayed report rows.
- [ ] Review `README.md`, `.env.example`, and all documentation for accuracy.
- [ ] Confirm no populated `.env` files, passwords, private keys, or other secrets are tracked or included in the submission archive.
- [ ] Verify the final Git working tree and push all intended documentation changes.
- [ ] Ensure the final submission PDF is consistent with the implemented hybrid architecture and observed validation evidence.

## 6. Evidence and limitations

- Backend test and smoke-test results were observed in the user's terminal output.
- The frontend production build was observed in the user's terminal output.
- Snowflake results were recorded from supplied query results and exports.
- The SQL source was inspected to confirm the negative-credit filter.
- Clean-clone installation and CSV export verification remain pending.
- This is an assessment prototype, not a production-ready deployment.
