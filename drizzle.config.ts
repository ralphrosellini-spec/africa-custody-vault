import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite', // placeholder — update when Drizzle ships stable MSSQL dialect
  schema: './src/db/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env['DB_URL'] ?? '',
  },
});
