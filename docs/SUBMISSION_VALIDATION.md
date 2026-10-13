# Submission Validation Notes

## Current source/data status

- The application is configured for the local `demo` data source by default.
- The frontend displays a demo-data warning because live Snowflake connection wiring is not included in this version.
- The Snowflake SQL scripts in `../snowflake/` should be executed in the intended account and checked against expected values before describing them as verified.

## Recommended final checks

- [ ] `npm install` succeeds in `backend/` and `frontend/`.
- [ ] `npm test` passes in `backend/`.
- [ ] `npm run smoke` passes against the real backend.
- [ ] `npm run build` passes in `frontend/`.
- [ ] Admin login succeeds and non-admin roles cannot use admin-only controls.
- [ ] Alert acknowledgement, telemetry pause/resume, and injected event work through the actual API.
- [ ] Report CSV export contains the visible report rows.
- [ ] Cost queries are executed against the target Snowflake account, if access is available, and outputs are reconciled independently.
- [ ] No private keys, passwords, account identifiers, or populated `.env` files are included in the submission.

## Evidence template

| Check | Expected | Actual | Status | Evidence / follow-up |
|---|---|---|---|---|
| Backend test suite | All tests pass | Not yet verified in clean environment | Pending | Attach terminal output |
| Smoke checks | All checks pass against actual server | Not yet verified in clean environment | Pending | Attach terminal output |
| Frontend production build | Build succeeds | Not yet verified in clean environment | Pending | Attach terminal output |
| SQL reconciliation | No unexplained variance beyond agreed tolerance | Must be run in Snowflake | Pending | Save query output |
| Demo source labeling | All simulated metrics clearly labeled | Implemented in UI copy | Review | Screenshot Overview and Costs |


## Verified Snowflake evidence (14 October 2026)

See `SNOWFLAKE_VALIDATION_EVIDENCE.md` for the user's observed Q1, Q4, Q4 diagnostic, and Q5 results. Q4 and the anomaly-total reconciliation passed on the supplied results. Negative-window exclusion logic still requires inspection; backend Snowflake connectivity is not implied by these query results.
