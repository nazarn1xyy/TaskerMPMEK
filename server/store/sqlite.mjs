// Local storage: a single SQLite file next to an uploads folder. Used by `npm run dev` / `npm start`.
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

export const COLLECTIONS = ['members', 'projects', 'tasks', 'comments', 'attachments']

export function createSqliteStore(dataDir) {
  const uploadDir = path.join(dataDir, 'uploads')
  fs.mkdirSync(uploadDir, { recursive: true })

  const db = new DatabaseSync(path.join(dataDir, 'tasker.db'))
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')
  for (const col of COLLECTIONS) db.exec(`CREATE TABLE IF NOT EXISTS ${col} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`)
  db.exec('CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY, at INTEGER NOT NULL, data TEXT NOT NULL)')
  db.exec('CREATE INDEX IF NOT EXISTS activity_at ON activity (at)')

  // Everything lives in memory and is written through to SQLite — one process owns the file.
  const cache = {}
  const stmts = {}
  for (const col of COLLECTIONS) {
    cache[col] = new Map()
    for (const row of db.prepare(`SELECT id, data FROM ${col}`).all()) cache[col].set(row.id, JSON.parse(row.data))
    stmts[col] = {
      put: db.prepare(`INSERT INTO ${col} (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`),
      del: db.prepare(`DELETE FROM ${col} WHERE id = ?`),
    }
  }
  const putActivity = db.prepare('INSERT OR IGNORE INTO activity (id, at, data) VALUES (?, ?, ?)')
  const recentActivity = db.prepare('SELECT data FROM activity ORDER BY at DESC LIMIT ?')
  let version = Date.now()
  const seen = new Map()

  return {
    uploadDir,
    async all(col) {
      return [...cache[col].values()]
    },
    async snapshot() {
      return Object.fromEntries(COLLECTIONS.map((c) => [c, [...cache[c].values()]]))
    },
    async get(col, id) {
      return cache[col].get(id)
    },
    async put(col, item) {
      cache[col].set(item.id, item)
      stmts[col].put.run(item.id, JSON.stringify(item))
      return item
    },
    async del(col, id) {
      cache[col].delete(id)
      stmts[col].del.run(id)
    },
    async logActivity(entries) {
      for (const e of entries) putActivity.run(e.id, e.at, JSON.stringify(e))
    },
    async activity(limit = 400) {
      return recentActivity.all(limit).map((r) => JSON.parse(r.data))
    },
    async bump() {
      version = Math.max(version + 1, Date.now())
      return version
    },
    async version() {
      return version
    },
    async touch(memberId) {
      if (memberId) seen.set(memberId, Date.now())
    },
    async presence(windowMs) {
      const cutoff = Date.now() - windowMs
      return [...seen].filter(([, at]) => at > cutoff).map(([id]) => id)
    },
    // Soft-deleted tasks are kept for 30 days so «Повернути» works and history stays readable.
    async purgeDeleted() {
      const cutoff = Date.now() - 30 * 24 * 3600 * 1000
      for (const t of cache.tasks.values()) if (t.deletedAt && t.deletedAt < cutoff) await this.del('tasks', t.id)
    },
  }
}
