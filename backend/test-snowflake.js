
import 'dotenv/config';
import snowflake from 'snowflake-sdk';

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
  console.error('Missing configuration:', missing.join(', '));
  process.exit(1);
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

function connect() {
  return new Promise((resolve, reject) => {
    connection.connect((err, conn) => {
      if (err) reject(err);
      else resolve(conn);
    });
  });
}

function execute(sqlText) {
  return new Promise((resolve, reject) => {
    connection.execute({
      sqlText,
      complete: (err, statement, rows) => {
        if (err) reject(err);
        else resolve(rows);
      },
    });
  });
}

try {
  await connect();
  console.log('SUCCESS: Connected to Snowflake.');

  const rows = await execute(`
    SELECT
      CURRENT_ACCOUNT() AS ACCOUNT_NAME,
      CURRENT_USER() AS USER_NAME,
      CURRENT_ROLE() AS ACTIVE_ROLE,
      CURRENT_WAREHOUSE() AS ACTIVE_WAREHOUSE,
      CURRENT_DATABASE() AS ACTIVE_DATABASE,
      CURRENT_SCHEMA() AS ACTIVE_SCHEMA
  `);

  console.table(rows);

  const views = await execute(`
    SELECT TABLE_SCHEMA, TABLE_NAME
    FROM ${process.env.SNOWFLAKE_DATABASE}.INFORMATION_SCHEMA.VIEWS
    WHERE TABLE_SCHEMA = 'ANALYTICS'
    ORDER BY TABLE_NAME
  `);

  console.log(`Visible ANALYTICS views: ${views.length}`);
  console.table(views);
} catch (error) {
  console.error('Snowflake test failed:', error);
console.error('Error code:', error.code);
console.error('SQL state:', error.sqlState);
console.error('Cause:', error.cause);
  process.exitCode = 1;
} finally {
  connection.destroy(() => {});
}
