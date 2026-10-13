-- =====================================================================
-- Pure Insights Command Center - Cloud cost allocation engine
-- Run after the data (including the simulated ACCOUNT_USAGE tables) is loaded.
--
-- Method: each hourly warehouse metering window carries a credit total.
-- Within a window, credits are split across the queries that started in it
-- in proportion to query execution time, and every query is tagged with
-- the report_id that issued it. Summing per tag gives credits per report.
--
-- Anomaly handling: windows with negative credits_used are impossible in
-- real metering data, so they are quarantined, never netted into totals.
--
-- Unit cost per active user view uses only snapshots with valid credits
-- (CLEAN.credits_valid) for both the numerator and the denominator, so the
-- ratio compares like with like.
-- =====================================================================
USE ROLE PURE_INSIGHTS_APP;
USE WAREHOUSE PURE_INSIGHTS_WH;
USE DATABASE PURE_INSIGHTS;

-- ---------------------------------------------------------------------
-- Pricing assumption (edit to your contract rate)
-- ---------------------------------------------------------------------
CREATE OR REPLACE TABLE ANALYTICS.COST_PARAMS (
  credit_price_usd  NUMBER(10,4) NOT NULL,
  note              VARCHAR
);
INSERT INTO ANALYTICS.COST_PARAMS VALUES (3.00, 'Assumed on-demand USD per Snowflake credit; replace with the contract rate');

-- ---------------------------------------------------------------------
-- 1. Quarantined metering windows (negative credit consumption)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW ANALYTICS.V_METERING_ANOMALIES AS
SELECT
  start_time,
  end_time,
  warehouse_name,
  credits_used,
  'NEGATIVE_CREDITS' AS anomaly_type
FROM SIM_ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY
WHERE credits_used < 0;

-- ---------------------------------------------------------------------
-- 2. Credits attributed to every individual query
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW ANALYTICS.V_QUERY_CREDIT_ATTRIBUTION AS
WITH valid_windows AS (
  SELECT start_time, end_time, warehouse_name, credits_used
  FROM SIM_ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY
  WHERE credits_used >= 0
),
windowed_queries AS (
  SELECT
    q.query_id,
    q.query_tag AS report_id,
    q.warehouse_name,
    q.execution_time,
    w.start_time AS window_start,
    w.credits_used AS window_credits
  FROM SIM_ACCOUNT_USAGE.QUERY_HISTORY q
  JOIN valid_windows w
    ON q.warehouse_name = w.warehouse_name
   AND q.start_time >= w.start_time
   AND q.start_time <  w.end_time
),
with_totals AS (
  SELECT
    *,
    SUM(execution_time) OVER (PARTITION BY warehouse_name, window_start) AS window_exec_time
  FROM windowed_queries
)
SELECT
  query_id,
  report_id,
  warehouse_name,
  window_start,
  execution_time,
  window_credits,
  window_exec_time,
  window_credits * execution_time / NULLIF(window_exec_time, 0) AS attributed_credits
FROM with_totals;

-- ---------------------------------------------------------------------
-- 3. Credits per report (untagged queries land in UNTAGGED)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW ANALYTICS.V_REPORT_CREDITS AS
SELECT
  COALESCE(report_id, 'UNTAGGED') AS report_id,
  COUNT(*)                        AS query_count,
  SUM(execution_time)             AS execution_ms,
  SUM(attributed_credits)         AS attributed_credits
FROM ANALYTICS.V_QUERY_CREDIT_ATTRIBUTION
GROUP BY COALESCE(report_id, 'UNTAGGED');

-- ---------------------------------------------------------------------
-- 4. Reconciliation: metered = attributed + unattributed, negatives apart
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW ANALYTICS.V_CREDIT_RECONCILIATION AS
WITH totals AS (
  SELECT
    (SELECT SUM(credits_used) FROM SIM_ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY WHERE credits_used >= 0) AS metered_valid_credits,
    (SELECT SUM(attributed_credits) FROM ANALYTICS.V_QUERY_CREDIT_ATTRIBUTION)                           AS attributed_credits,
    (SELECT SUM(credits_used) FROM SIM_ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY WHERE credits_used < 0)  AS quarantined_negative_credits,
    (SELECT COUNT(*)          FROM SIM_ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY WHERE credits_used < 0)  AS quarantined_windows
)
SELECT
  metered_valid_credits,
  attributed_credits,
  metered_valid_credits - COALESCE(attributed_credits, 0) AS unattributed_credits,
  quarantined_negative_credits,
  quarantined_windows
FROM totals;

-- ---------------------------------------------------------------------
-- 5. Unit cost per active user view, one row per report
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW ANALYTICS.V_REPORT_UNIT_COST AS
WITH report_usage AS (
  SELECT
    report_id,
    MAX(report_name)           AS report_name,
    COUNT(*)                   AS snapshots,
    SUM(monthly_active_views)  AS active_views,
    SUM(aws_hosting_cost_usd)  AS aws_cost_usd,
    AVG(avg_load_time_sec)     AS avg_load_time_sec
  FROM CLEAN.REPORT_METRICS_CLEAN
  WHERE credits_valid
  GROUP BY report_id
),
costed AS (
  SELECT
    u.report_id,
    u.report_name,
    u.snapshots,
    u.active_views,
    c.attributed_credits,
    c.attributed_credits * p.credit_price_usd                        AS snowflake_cost_usd,
    u.aws_cost_usd,
    c.attributed_credits * p.credit_price_usd + u.aws_cost_usd       AS total_cost_usd,
    u.avg_load_time_sec
  FROM report_usage u
  JOIN ANALYTICS.V_REPORT_CREDITS c ON c.report_id = u.report_id
  CROSS JOIN ANALYTICS.COST_PARAMS p
)
SELECT
  report_id,
  report_name,
  snapshots,
  active_views,
  attributed_credits,
  snowflake_cost_usd,
  aws_cost_usd,
  total_cost_usd,
  attributed_credits / NULLIF(active_views, 0)  AS credits_per_view,
  snowflake_cost_usd / NULLIF(active_views, 0)  AS snowflake_cost_per_view_usd,
  total_cost_usd     / NULLIF(active_views, 0)  AS total_cost_per_view_usd,
  avg_load_time_sec,
  RANK() OVER (ORDER BY total_cost_usd / NULLIF(active_views, 0) DESC) AS cost_per_view_rank
FROM costed;

-- ---------------------------------------------------------------------
-- 6. Validation against the source CSV (ground truth)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW ANALYTICS.V_ATTRIBUTION_VALIDATION AS
SELECT
  s.report_id,
  s.source_credits,
  a.attributed_credits,
  ABS(s.source_credits - COALESCE(a.attributed_credits, 0)) AS abs_diff_credits
FROM (
  SELECT report_id, SUM(snowflake_credits_consumed) AS source_credits
  FROM CLEAN.REPORT_METRICS_CLEAN
  WHERE credits_valid
  GROUP BY report_id
) s
LEFT JOIN ANALYTICS.V_REPORT_CREDITS a ON a.report_id = s.report_id;
