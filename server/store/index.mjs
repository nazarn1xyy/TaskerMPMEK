// Postgres when a connection string is present (Vercel + Neon), otherwise a local SQLite file.
export const databaseUrl = () => process.env.DATABASE_URL || process.env.POSTGRES_URL || null

export async function createStore(dataDir) {
  const url = databaseUrl()
  if (url) {
    const { createPostgresStore } = await import('./postgres.mjs')
    return createPostgresStore(url)
  }
  const { createSqliteStore } = await import('./sqlite.mjs')
  return createSqliteStore(dataDir)
}
