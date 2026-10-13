-- =====================================================================
-- Pure Insights Command Center - backend service user (run LATER)
-- Only needed once the Node backend connects to Snowflake.
-- Run as ACCOUNTADMIN after 01_setup.sql and 02_tables.sql.
-- =====================================================================
USE ROLE ACCOUNTADMIN;

-- ---------------------------------------------------------------------
-- Service user for the Node backend (key-pair auth, no password)
--    Generate the key pair on your machine first:
--      openssl genrsa 2048 | openssl pkcs8 -topk8 -inform PEM -out rsa_key.p8 -nocrypt
--      openssl rsa -in rsa_key.p8 -pubout -out rsa_key.pub
--    Then paste the public key body (without the BEGIN/END lines) below.
--    NEVER commit rsa_key.p8 - it is gitignored.
-- ---------------------------------------------------------------------
CREATE USER IF NOT EXISTS PURE_INSIGHTS_SVC
  TYPE              = SERVICE
  DEFAULT_ROLE      = PURE_INSIGHTS_APP
  DEFAULT_WAREHOUSE = PURE_INSIGHTS_WH
  DEFAULT_NAMESPACE = PURE_INSIGHTS.CLEAN
  COMMENT           = 'Node backend service account';

ALTER USER PURE_INSIGHTS_SVC SET RSA_PUBLIC_KEY = '<PASTE_PUBLIC_KEY_BODY_HERE>';

GRANT ROLE PURE_INSIGHTS_APP TO USER PURE_INSIGHTS_SVC;

