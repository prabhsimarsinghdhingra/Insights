
import 'dotenv/config';
import snowflake from 'snowflake-sdk';

const connection = snowflake.createConnection({
  account: process.env.SNOWFLAKE_ACCOUNT,
  username: process.env.SNOWFLAKE_USERNAME,
  password: process.env.SNOWFLAKE_PASSWORD,
  warehouse: process.env.SNOWFLAKE_WAREHOUSE,
  database: process.env.SNOWFLAKE_DATABASE,
  schema: process.env.SNOWFLAKE_SCHEMA,
  role: process.env.SNOWFLAKE_ROLE,
});

function connect() {
  return new Promise((resolve, reject) => {
    connection.connect((err) => err ? reject(err) : resolve());
  });
}

function query(sqlText) {
  return new Promise((resolve, reject) => {
    connection.execute({
      sqlText,
      complete: (err, stmt, rows) => err ? reject(err) : resolve(rows),
    });
  });
}

try {
  await connect();

  const checks = [
    ['Credit reconciliation', `
      SELECT * FROM ANALYTICS.V_CREDIT_RECONCILIATION
    `],
    ['Attribution validation', `
      SELECT * FROM ANALYTICS.V_ATTRIBUTION_VALIDATION LIMIT 5
    `],
    ['Metering anomalies', `
      SELECT * FROM ANALYTICS.V_METERING_ANOMALIES LIMIT 5
    `],
    ['Report credits', `
      SELECT * FROM ANALYTICS.V_REPORT_CREDITS LIMIT 5
    `],
    ['Report unit cost', `
      SELECT * FROM ANALYTICS.V_REPORT_UNIT_COST LIMIT 5
    `],
    ['Query credit attribution', `
      SELECT * FROM ANALYTICS.V_QUERY_CREDIT_ATTRIBUTION LIMIT 5
    `],
  ];

  for (const [name, sql] of checks) {
    console.log(`\n--- ${name} ---`);
    const rows = await query(sql);
    console.log(`Rows returned: ${rows.length}`);
    console.table(rows);
  }
} catch (err) {
  console.error('Data test failed:', err.message);
  process.exitCode = 1;
} finally {
  connection.destroy(() => {});
}
