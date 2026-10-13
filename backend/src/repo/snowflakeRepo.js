
import snowflake from 'snowflake-sdk';
import { paginate, sortRows } from '../http/params.js';

const COST_SORTS = [
  'cost_per_view_rank',
  'report_id',
  'attributed_credits',
  'snowflake_cost_usd',
  'aws_cost_usd',
  'total_cost_usd',
  'credits_per_view',
  'total_cost_per_view_usd',
  'active_views',
];

function execute(connection, sqlText, binds = []) {
  return new Promise((resolve, reject) => {
    connection.execute({
      sqlText,
      binds,
      complete(err, statement, rows) {
        if (err) reject(err);
        else resolve(rows ?? []);
      },
    });
  });
}

export async function createSnowflakeRepo({ fallbackRepo, creditPriceUsd = 3 }) {
  const required = [
    'SNOWFLAKE_ACCOUNT',
    'SNOWFLAKE_USERNAME',
    'SNOWFLAKE_PASSWORD',
    'SNOWFLAKE_WAREHOUSE',
    'SNOWFLAKE_DATABASE',
    'SNOWFLAKE_SCHEMA',
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing Snowflake configuration: ${missing.join(', ')}`);
  }

  const connection = snowflake.createConnection({
    account: process.env.SNOWFLAKE_ACCOUNT,
    username: process.env.SNOWFLAKE_USERNAME,
    password: process.env.SNOWFLAKE_PASSWORD,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE,
    database: process.env.SNOWFLAKE_DATABASE,
    schema: process.env.SNOWFLAKE_SCHEMA,
    role: process.env.SNOWFLAKE_ROLE || undefined,
  });

  await new Promise((resolve, reject) => {
    connection.connect((err) => (err ? reject(err) : resolve()));
  });

  const database = process.env.SNOWFLAKE_DATABASE;
  const schema = process.env.SNOWFLAKE_SCHEMA;

  // Identifiers come from environment configuration, not request input.
  const view = (name) => `"${database}"."${schema}"."${name}"`;

  
async function costAttribution({ sort, order, paging }) {
  const rows = await execute(
    connection,
    `SELECT
      REPORT_ID AS "report_id",
      REPORT_NAME AS "report_name",
      SNAPSHOTS AS "snapshots",
      ACTIVE_VIEWS AS "active_views",
      ATTRIBUTED_CREDITS AS "attributed_credits",
      SNOWFLAKE_COST_USD AS "snowflake_cost_usd",
      AWS_COST_USD AS "aws_cost_usd",
      TOTAL_COST_USD AS "total_cost_usd",
      CREDITS_PER_VIEW AS "credits_per_view",
      SNOWFLAKE_COST_PER_VIEW_USD AS "snowflake_cost_per_view_usd",
      TOTAL_COST_PER_VIEW_USD AS "total_cost_per_view_usd",
      AVG_LOAD_TIME_SEC AS "avg_load_time_sec",
      COST_PER_VIEW_RANK AS "cost_per_view_rank"
    FROM ${view('V_REPORT_UNIT_COST')}`
  );

  const sorted = sortRows(
    rows,
    COST_SORTS.includes(sort) ? sort : 'cost_per_view_rank',
    order
  );

  return {
    ...paginate(sorted, paging),
    credit_price_usd: creditPriceUsd,
  };
}


  async function costReconciliation() {
    const [reconciliationRows, validationRows] = await Promise.all([
      execute(connection, `SELECT * FROM ${view('V_CREDIT_RECONCILIATION')}`),
      execute(connection, `
        SELECT
          COUNT(*) AS reports_checked,
          COUNT_IF(ABS_DIFF_CREDITS > 0.05) AS reports_outside_tolerance,
          COALESCE(MAX(ABS_DIFF_CREDITS), 0) AS max_abs_diff_credits
        FROM ${view('V_ATTRIBUTION_VALIDATION')}
      `),
    ]);

    const r = reconciliationRows[0] ?? {};
    const v = validationRows[0] ?? {};

    return {
      metered_valid_credits: r.METERED_VALID_CREDITS,
      attributed_credits: r.ATTRIBUTED_CREDITS,
      unattributed_credits: r.UNATTRIBUTED_CREDITS,
      quarantined_negative_credits: r.QUARANTINED_NEGATIVE_CREDITS,
      quarantined_windows: r.QUARANTINED_WINDOWS,
      validation: {
        reports_checked: Number(v.REPORTS_CHECKED ?? 0),
        tolerance_credits: 0.05,
        reports_outside_tolerance: Number(v.REPORTS_OUTSIDE_TOLERANCE ?? 0),
        max_abs_diff_credits: Number(v.MAX_ABS_DIFF_CREDITS ?? 0),
      },
      data_source: 'snowflake',
    };
  }

  return {
    // Keep unrelated features on the existing repository until separately
    // connected to live source data.
    ...fallbackRepo,

    sourceName: 'snowflake-costs + demo-csv-monitoring',

    async costAttribution(args) {
      return costAttribution(args);
    },

    async costReconciliation() {
      return costReconciliation();
    },

    async close() {
      await new Promise((resolve) => connection.destroy(() => resolve()));
    },
  };
}
