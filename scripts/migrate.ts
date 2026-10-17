// ============================================================
// scripts/migrate.ts
// Database migration runner — idempotent, tracks applied
// migrations in cv_migrations table.
// ============================================================

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import sql from 'mssql';

const DB_CONFIG: sql.config = {
  server: process.env['DB_SERVER'] ?? 'localhost',
  port: parseInt(process.env['DB_PORT'] ?? '1433', 10),
  database: process.env['DB_NAME'] ?? 'custody_vault',
  user: process.env['DB_USER'] ?? 'sa',
  password: process.env['DB_PASSWORD'] ?? '',
  options: {
    encrypt: process.env['DB_ENCRYPT'] !== 'false',
    trustServerCertificate: process.env['DB_TRUST_SERVER_CERT'] === 'true',
    enableArithAbort: true,
  },
};

async function migrate(): Promise<void> {
  console.log('[Migrate] Connecting to database...');
  const pool = await sql.connect(DB_CONFIG);

  // Ensure migrations table exists
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'cv_migrations')
    CREATE TABLE cv_migrations (
      id INT IDENTITY(1,1) PRIMARY KEY,
      filename NVARCHAR(200) NOT NULL,
      applied_at DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET() NOT NULL,
      CONSTRAINT UQ_cv_migrations_filename UNIQUE (filename)
    )
  `);

  // Read applied migrations
  const appliedResult = await pool.request().query(
    'SELECT filename FROM cv_migrations ORDER BY id',
  );
  const applied = new Set<string>(
    (appliedResult.recordset as Array<{ filename: string }>).map((r) => r.filename),
  );

  // Read migration files from migrations/ directory
  const migrationsDir = path.join(process.cwd(), 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // alphabetical order ensures correct sequence

  let ranCount = 0;

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`[Migrate] Skipping (already applied): ${file}`);
      continue;
    }

    console.log(`[Migrate] Applying: ${file}`);
    const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

    // Split on GO statements (MSSQL batch separator)
    const batches = content.split(/\r?\nGO\r?\n/i).filter((b) => b.trim());

    for (const batch of batches) {
      if (batch.trim()) {
        await pool.request().query(batch);
      }
    }

    // Record migration as applied
    await pool.request()
      .input('filename', sql.NVarChar, file)
      .query('INSERT INTO cv_migrations (filename) VALUES (@filename)');

    console.log(`[Migrate] ✅ Applied: ${file}`);
    ranCount++;
  }

  await pool.close();

  if (ranCount === 0) {
    console.log('[Migrate] No new migrations to apply. Database is up to date.');
  } else {
    console.log(`[Migrate] Applied ${ranCount} migration(s).`);
  }
}

migrate().catch((err) => {
  console.error('[Migrate] Fatal error:', err);
  process.exit(1);
});
