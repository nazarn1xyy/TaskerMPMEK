// Postgres when a connection string is present (Vercel + Neon), otherwise a local SQLite file.
export function databaseUrl() {
  const raw = process.env.DATABASE_URL || process.env.POSTGRES_URL
  if (!raw) return null
  // Neon adds channel_binding=require; postgres.js would forward it to the server as an unknown setting
  const url = new URL(raw)
  url.searchParams.delete('channel_binding')
  return url.toString()
}

export async function createStore(dataDir) {
  const url = databaseUrl()
  if (url) {
    const { createPostgresStore } = await import('./postgres.mjs')
    return createPostgresStore(url)
  }
  const { createSqliteStore } = await import('./sqlite.mjs')
  return createSqliteStore(dataDir)
}
