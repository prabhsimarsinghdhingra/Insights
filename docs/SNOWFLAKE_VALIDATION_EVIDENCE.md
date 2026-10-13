# Snowflake Validation Evidence

**Project:** Pure Insights Command Center  
**Validation date:** 14 October 2026  
**Environment:** User-provided Snowflake Snowsight screenshots and Q5 CSV export  
**Important:** These results reflect the supplied Snowflake run. They do not establish that the app backend is connected to Snowflake; this project version uses local demo data in the application.

## Summary

| Check | Observed result | Assessment |
|---|---|---|
| Q1 — `ANALYTICS.V_CREDIT_RECONCILIATION` | Metered valid credits: 1,206,352.48; attributed credits: 1,206,352.48; unattributed credits: 0; quarantined negative credits: -161.04; quarantined windows: 24 | Totals reconcile. Review view/filter logic to independently establish that quarantined windows are excluded from valid allocation. |
| Q4 — `ANALYTICS.V_ATTRIBUTION_VALIDATION` | 100 reports checked; 0 outside tolerance; maximum absolute discrepancy: 0.007183418937 credits; tolerance: 0.05 credits | Pass for the tested 100 records. |
| Q4 diagnostic — rows where `ABS_DIFF_CREDITS > 0.05` | 0 rows | Pass; consistent with aggregate Q4 result. |
| Q5 — `ANALYTICS.V_METERING_ANOMALIES` | CSV export contains 24 rows; all are `NEGATIVE_CREDITS`; warehouse shown is `PORTAL_WH`; sum of `CREDITS_USED` is -161.04 | Reconciles with Q1 anomaly count and total. Exclusion from allocation should be confirmed from the view definition or allocation logic. |

## Q1 — Credit reconciliation

Query executed:

```sql
SELECT *
FROM ANALYTICS.V_CREDIT_RECONCILIATION;
```

Observed output:

- `METERED_VALID_CREDITS`: 1,206,352.48
- `ATTRIBUTED_CREDITS`: 1,206,352.48
- `UNATTRIBUTED_CREDITS`: 0
- `QUARANTINED_NEGATIVE_CREDITS`: -161.04
- `QUARANTINED_WINDOWS`: 24

Interpretation: the aggregate valid-metered and attributed totals match exactly. This is a reconciliation result, not by itself independent proof that every allocation is correctly mapped.

## Q4 — Attribution accuracy

Aggregate query executed against `ANALYTICS.V_ATTRIBUTION_VALIDATION` using the project's 0.05-credit tolerance.

Observed output:

- `REPORTS_CHECKED`: 100
- `REPORTS_OUTSIDE_TOLERANCE`: 0
- `MAX_ABS_DIFF_CREDITS`: 0.007183418937

Diagnostic query executed:

```sql
SELECT *
FROM ANALYTICS.V_ATTRIBUTION_VALIDATION
WHERE abs_diff_credits > 0.05
ORDER BY abs_diff_credits DESC;
```

Observed result: 0 rows. The maximum discrepancy is below the tolerance.

## Q5 — Negative-credit anomalies

Query executed:

```sql
SELECT *
FROM ANALYTICS.V_METERING_ANOMALIES
ORDER BY credits_used;
```

The exported CSV contains 24 rows with these columns: `START_TIME`, `END_TIME`, `WAREHOUSE_NAME`, `CREDITS_USED`, `ANOMALY_TYPE`.

Observed summary:

- Row count: 24
- `ANOMALY_TYPE`: `NEGATIVE_CREDITS` for all rows
- `WAREHOUSE_NAME`: `PORTAL_WH` for all rows
- Sum of `CREDITS_USED`: -161.04
- Most negative record: -13.60 credits

The row count and sum match Q1's quarantine summary. To prove the records are excluded from valid allocation, review the definitions of `ANALYTICS.V_CREDIT_RECONCILIATION` and the allocation view/query and confirm the negative-window filter is applied before valid metered credits are totaled.

## Remaining validation before final submission

- [ ] Confirm the SQL/view logic excludes negative-credit windows from valid allocation.
- [ ] Run backend `npm test` and `npm run smoke` locally and retain terminal output.
- [ ] Run frontend `npm run build` locally and retain terminal output.
- [ ] Verify admin-only actions are rejected for non-admin users.
- [ ] Ensure the frontend clearly labels demo CSV metrics and does not imply a live Snowflake connection.
- [ ] Check the ZIP for secrets and populated `.env` files before submission.

## Limitations

- The SQL results above are based on the user's supplied Snowsight screenshots and exported Q5 CSV.
- No direct connection to the user's Snowflake account was performed by the assistant.
- A balanced aggregate does not alone prove allocation correctness or correct quarantine exclusion.
- The application backend's live Snowflake integration remains unverified and is documented separately from these SQL validation results.
