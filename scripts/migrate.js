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
  meeting_date  TIMESTAMPTZ,
  meeting_link  TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- For databases created before the meeting fields existed:
ALTER TABLE practice_status ADD COLUMN IF NOT EXISTS meeting_date TIMESTAMPTZ;
ALTER TABLE practice_status ADD COLUMN IF NOT EXISTS meeting_link TEXT;`;

// Stages are ordered (contacted -> meeting_set -> onboarded). Repair rows left in an
// invalid state by earlier versions (highest stage wins), then lock the rule in with a CHECK.
const FIX_SQL = `
UPDATE practice_status SET
  meeting_set = meeting_set OR onboarded,
  contacted   = contacted OR meeting_set OR onboarded
WHERE (onboarded AND NOT meeting_set) OR ((meeting_set OR onboarded) AND NOT contacted);`;
const CHECK_SQL = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'practice_status_stage_chk') THEN
    ALTER TABLE practice_status ADD CONSTRAINT practice_status_stage_chk
      CHECK ((NOT onboarded OR meeting_set) AND (NOT meeting_set OR contacted));
  END IF;
END $$;`;

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Add your Neon connection string to .env (see README).');
    process.exit(1);
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query(SQL);
    const fixed = await client.query(FIX_SQL);
    await client.query(CHECK_SQL);
    console.log(`Corrected ${fixed.rowCount} row(s) with an invalid stage combination.`);
    console.log('practice_status table is ready (schema up to date).');
  } catch (e) {
    console.error('Migration failed: ' + e.message);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
})();
