-- =====================================================================
-- Pure Insights Command Center - cost analysis queries
-- Run each query on its own (select it, then press the run button).
-- =====================================================================
USE ROLE PURE_INSIGHTS_APP;
USE WAREHOUSE PURE_INSIGHTS_WH;
USE DATABASE PURE_INSIGHTS;

-- Q1. Reconciliation: every valid metered credit is accounted for
SELECT * FROM ANALYTICS.V_CREDIT_RECONCILIATION;

-- Q2. Ten most expensive reports per active user view
SELECT report_id, report_name, active_views, attributed_credits,
       ROUND(snowflake_cost_usd, 2)           AS snowflake_cost_usd,
       ROUND(aws_cost_usd, 2)                 AS aws_cost_usd,
       ROUND(total_cost_per_view_usd, 4)      AS total_cost_per_view_usd,
       cost_per_view_rank
FROM ANALYTICS.V_REPORT_UNIT_COST
ORDER BY cost_per_view_rank
LIMIT 10;

-- Q3. Spend concentration: cumulative share of total cost by report
SELECT report_id,
       ROUND(total_cost_usd, 2) AS total_cost_usd,
       ROUND(100 * total_cost_usd / SUM(total_cost_usd) OVER (), 2) AS pct_of_total,
       ROUND(100 * SUM(total_cost_usd) OVER (ORDER BY total_cost_usd DESC, report_id)
                 / SUM(total_cost_usd) OVER (), 2) AS cumulative_pct
FROM ANALYTICS.V_REPORT_UNIT_COST
ORDER BY total_cost_usd DESC
LIMIT 15;

-- Q4. Validation: attribution engine vs the source CSV (tolerance 0.05 credits)
SELECT COUNT(*)                                    AS reports_checked,
       SUM(CASE WHEN abs_diff_credits > 0.05 THEN 1 ELSE 0 END) AS reports_outside_tolerance,
       MAX(abs_diff_credits)                       AS max_abs_diff_credits
FROM ANALYTICS.V_ATTRIBUTION_VALIDATION;

-- Q5. Quarantined negative-credit windows
SELECT * FROM ANALYTICS.V_METERING_ANOMALIES ORDER BY credits_used;

-- Q6. Reports whose AWS cost per view most exceeds the fleet average
WITH fleet AS (
  SELECT SUM(aws_cost_usd) / NULLIF(SUM(active_views), 0) AS fleet_aws_per_view
  FROM ANALYTICS.V_REPORT_UNIT_COST
)
SELECT r.report_id, r.report_name, r.active_views,
       ROUND(r.aws_cost_usd, 2)                                   AS aws_cost_usd,
       ROUND(r.aws_cost_usd / NULLIF(r.active_views, 0), 4)       AS aws_cost_per_view_usd,
       ROUND((r.aws_cost_usd / NULLIF(r.active_views, 0)) / f.fleet_aws_per_view, 2) AS ratio_to_fleet
FROM ANALYTICS.V_REPORT_UNIT_COST r
CROSS JOIN fleet f
ORDER BY ratio_to_fleet DESC
LIMIT 10;

-- Q7. Record-level view of the injected data-quality defects
SELECT issue_type, severity, COUNT(*) AS issue_count,
       COUNT(DISTINCT report_id) AS reports_affected
FROM ANOMALIES.DATA_QUALITY_ISSUES
GROUP BY issue_type, severity
ORDER BY issue_count DESC;
