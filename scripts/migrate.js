// One-time (idempotent) migration: node scripts/migrate.js  (or: npm run migrate)
// Creates the outreach-CRM table in the Postgres database named by DATABASE_URL.
require('dotenv').config({ quiet: true });
const { Client } = require('pg');

const SQL = `
CREATE TABLE IF NOT EXISTS practice_status (
  practice_id   TEXT PRIMARY KEY,   -- matches \`id\` in data/practices.json
  website       TEXT,
  contacted     BOOLEAN NOT NULL DEFAULT false,
  meeting_set   BOOLEAN NOT NULL DEFAULT false,
  onboarded     BOOLEAN NOT NULL DEFAULT false,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);`;

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Add your Neon connection string to .env (see README).');
    process.exit(1);
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query(SQL);
    console.log('practice_status table is ready.');
  } catch (e) {
    console.error('Migration failed: ' + e.message);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
})();
