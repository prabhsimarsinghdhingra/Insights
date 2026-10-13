-- =====================================================================
-- Pure Insights Command Center - Snowflake environment setup
-- Run in a Snowsight SQL worksheet, top to bottom.
-- Run as ACCOUNTADMIN. No passwords or secrets live in this file.
-- The Node backend service user is created later in 03_service_user.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Compute: small warehouse + resource monitor (cost guardrail)
-- ---------------------------------------------------------------------
USE ROLE ACCOUNTADMIN;

CREATE WAREHOUSE IF NOT EXISTS PURE_INSIGHTS_WH
  WAREHOUSE_SIZE      = 'XSMALL'
  AUTO_SUSPEND        = 60          -- seconds idle before suspending
  AUTO_RESUME         = TRUE
  INITIALLY_SUSPENDED = TRUE
  COMMENT             = 'Pure Insights Command Center - app and SQL suite';

-- Hard cap so a runaway query can never burn the trial credits.
CREATE OR REPLACE RESOURCE MONITOR PURE_INSIGHTS_RM
  WITH CREDIT_QUOTA = 10
  FREQUENCY = MONTHLY
  START_TIMESTAMP = IMMEDIATELY
  TRIGGERS ON 80  PERCENT DO NOTIFY
           ON 100 PERCENT DO SUSPEND;

ALTER WAREHOUSE PURE_INSIGHTS_WH SET RESOURCE_MONITOR = PURE_INSIGHTS_RM;

-- ---------------------------------------------------------------------
-- 2. Database, schemas, and a least-privilege application role
-- ---------------------------------------------------------------------
CREATE DATABASE IF NOT EXISTS PURE_INSIGHTS;

CREATE SCHEMA IF NOT EXISTS PURE_INSIGHTS.RAW;               -- untouched CSV load
CREATE SCHEMA IF NOT EXISTS PURE_INSIGHTS.CLEAN;             -- cleaned, typed, flagged
CREATE SCHEMA IF NOT EXISTS PURE_INSIGHTS.ANOMALIES;         -- data-quality issue log
CREATE SCHEMA IF NOT EXISTS PURE_INSIGHTS.SIM_ACCOUNT_USAGE; -- simulated SNOWFLAKE.ACCOUNT_USAGE
CREATE SCHEMA IF NOT EXISTS PURE_INSIGHTS.ANALYTICS;         -- cost attribution views

CREATE ROLE IF NOT EXISTS PURE_INSIGHTS_APP;

GRANT USAGE, OPERATE ON WAREHOUSE PURE_INSIGHTS_WH TO ROLE PURE_INSIGHTS_APP;
GRANT USAGE ON DATABASE PURE_INSIGHTS TO ROLE PURE_INSIGHTS_APP;
GRANT USAGE, CREATE TABLE, CREATE VIEW ON ALL SCHEMAS IN DATABASE PURE_INSIGHTS TO ROLE PURE_INSIGHTS_APP;
GRANT ALL ON FUTURE TABLES IN DATABASE PURE_INSIGHTS TO ROLE PURE_INSIGHTS_APP;
GRANT ALL ON FUTURE VIEWS  IN DATABASE PURE_INSIGHTS TO ROLE PURE_INSIGHTS_APP;

-- Let your own login use the role too, so you can run the SQL suite in Snowsight.
-- Lets your own login use the role (username already filled in).
GRANT ROLE PURE_INSIGHTS_APP TO USER PRABHSIMARSINGHDHINGRA;

-- ---------------------------------------------------------------------
-- 3. Sanity checks
-- ---------------------------------------------------------------------
SHOW WAREHOUSES LIKE 'PURE_INSIGHTS_WH';
SHOW SCHEMAS IN DATABASE PURE_INSIGHTS;
SHOW GRANTS TO ROLE PURE_INSIGHTS_APP;
