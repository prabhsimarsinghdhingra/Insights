-- =====================================================================
-- Pure Insights Command Center - table definitions
-- Run after 01_setup.sql, as PURE_INSIGHTS_APP (or ACCOUNTADMIN).
-- =====================================================================
USE ROLE PURE_INSIGHTS_APP;
USE WAREHOUSE PURE_INSIGHTS_WH;
USE DATABASE PURE_INSIGHTS;

-- ---------------------------------------------------------------------
-- RAW: the CSV exactly as delivered. Never modified after load.
-- ---------------------------------------------------------------------
CREATE OR REPLACE TABLE RAW.REPORT_METRICS_RAW (
  src_row_num                 NUMBER        NOT NULL,   -- 1-based row position in the CSV
  report_id                   VARCHAR,
  report_name                 VARCHAR,
  owner_email                 VARCHAR,                  -- NULL or 'ORPHANED_REPORT' when orphaned
  last_refresh_status         VARCHAR,
  monthly_active_views        NUMBER,
  snowflake_credits_consumed  FLOAT,
  avg_load_time_sec           FLOAT,
  aws_hosting_cost_usd        FLOAT,
  query_count_last_30d        NUMBER,
  concurrent_user_peak        NUMBER
);

-- ---------------------------------------------------------------------
-- CLEAN: typed, normalized, with explicit flag columns (nothing silently dropped)
-- ---------------------------------------------------------------------
CREATE OR REPLACE TABLE CLEAN.REPORT_METRICS_CLEAN (
  src_row_num                 NUMBER        NOT NULL,
  report_id                   VARCHAR       NOT NULL,
  report_name                 VARCHAR,
  owner_email                 VARCHAR,                  -- NULL when orphaned (normalized)
  is_orphaned                 BOOLEAN       NOT NULL,
  orphan_reason               VARCHAR,                  -- MISSING_OWNER | ORPHANED_REPORT_LITERAL
  last_refresh_status         VARCHAR       NOT NULL,
  refresh_alert_level         VARCHAR       NOT NULL,   -- NONE | WARNING | CRITICAL
  monthly_active_views        NUMBER        NOT NULL,
  snowflake_credits_consumed  FLOAT         NOT NULL,   -- original value, kept for audit
  credits_valid               BOOLEAN       NOT NULL,   -- FALSE for negative credits
  avg_load_time_sec           FLOAT         NOT NULL,
  latency_tier                VARCHAR       NOT NULL,   -- OK | WARNING (>15s) | CRITICAL (>30s)
  aws_hosting_cost_usd        FLOAT         NOT NULL,
  aws_cost_per_view           FLOAT,                    -- NULL when views = 0
  query_count_last_30d        NUMBER        NOT NULL,
  concurrent_user_peak        NUMBER        NOT NULL,
  issue_count                 NUMBER        NOT NULL    -- number of ANOMALIES rows for this record
);

-- ---------------------------------------------------------------------
-- ANOMALIES: one row per detected data-quality issue
-- ---------------------------------------------------------------------
CREATE OR REPLACE TABLE ANOMALIES.DATA_QUALITY_ISSUES (
  issue_id      NUMBER        AUTOINCREMENT,
  src_row_num   NUMBER        NOT NULL,
  report_id     VARCHAR       NOT NULL,
  issue_type    VARCHAR       NOT NULL,   -- see clean.js for the full rule list
  severity      VARCHAR       NOT NULL,   -- HIGH | MEDIUM | LOW
  detail        VARCHAR,
  detected_at   TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- ---------------------------------------------------------------------
-- SIM_ACCOUNT_USAGE: mirrors the column names of the real
-- SNOWFLAKE.ACCOUNT_USAGE views we cannot write to. Populated by a
-- generator script that reconciles to the CSV credit totals.
-- ---------------------------------------------------------------------
CREATE OR REPLACE TABLE SIM_ACCOUNT_USAGE.QUERY_HISTORY (
  query_id              VARCHAR       NOT NULL,
  query_tag             VARCHAR,                -- carries report_id, the attribution key
  query_type            VARCHAR,
  user_name             VARCHAR,
  warehouse_name        VARCHAR,
  start_time            TIMESTAMP_LTZ,
  end_time              TIMESTAMP_LTZ,
  total_elapsed_time    NUMBER,                 -- milliseconds
  execution_time        NUMBER                  -- milliseconds, the attribution weight
);

CREATE OR REPLACE TABLE SIM_ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY (
  start_time                TIMESTAMP_LTZ NOT NULL,
  end_time                  TIMESTAMP_LTZ NOT NULL,
  warehouse_name            VARCHAR       NOT NULL,
  credits_used              FLOAT         NOT NULL,
  credits_used_compute      FLOAT,
  credits_used_cloud_services FLOAT
);
