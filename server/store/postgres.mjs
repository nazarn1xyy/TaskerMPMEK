// Hosted storage: any Postgres (Neon from the Vercel Marketplace sets DATABASE_URL).
// Serverless instances share nothing, so every read goes to the database.
import postgres from 'postgres'

export const COLLECTIONS = ['members', 'projects', 'tasks', 'comments', 'attachments']

export function createPostgresStore(url) {
  const sql = postgres(url, { max: 4, idle_timeout: 20, prepare: false, onnotice: () => {} })

  let ready
  const init = () =>
    (ready ??= (async () => {
      await sql`create table if not exists tasker_rows (col text not null, id text not null, data jsonb not null, primary key (col, id))`
      await sql`create table if not exists tasker_activity (id text primary key, at bigint not null, data jsonb not null)`
      await sql`create index if not exists tasker_activity_at on tasker_activity (at desc)`
      await sql`create table if not exists tasker_meta (key text primary key, value bigint not null)`
      await sql`create table if not exists tasker_presence (member text primary key, seen bigint not null)`
    })().catch((err) => {
      ready = undefined
      throw err
    }))

  return {
    async all(col) {
      await init()
      return (await sql`select data from tasker_rows where col = ${col}`).map((r) => r.data)
    },
    async snapshot() {
      await init()
      const out = Object.fromEntries(COLLECTIONS.map((c) => [c, []]))
      for (const r of await sql`select col, data from tasker_rows`) out[r.col]?.push(r.data)
      return out
    },
    async get(col, id) {
      await init()
      const [row] = await sql`select data from tasker_rows where col = ${col} and id = ${id}`
      return row?.data
    },
    async put(col, item) {
      await init()
      await sql`insert into tasker_rows (col, id, data) values (${col}, ${item.id}, ${sql.json(item)})
        on conflict (col, id) do update set data = excluded.data`
      return item
    },
    async del(col, id) {
      await init()
      await sql`delete from tasker_rows where col = ${col} and id = ${id}`
    },
    async logActivity(entries) {
      if (!entries.length) return
      await init()
      for (const e of entries) await sql`insert into tasker_activity (id, at, data) values (${e.id}, ${e.at}, ${sql.json(e)}) on conflict do nothing`
    },
    async activity(limit = 400) {
      await init()
      return (await sql`select data from tasker_activity order by at desc limit ${limit}`).map((r) => r.data)
    },
    async bump() {
      await init()
      const [row] = await sql`insert into tasker_meta (key, value) values ('version', ${Date.now()})
        on conflict (key) do update set value = greatest(tasker_meta.value + 1, ${Date.now()}) returning value`
      return Number(row.value)
    },
    async version() {
      await init()
      const [row] = await sql`select value from tasker_meta where key = 'version'`
      return Number(row?.value ?? 0)
    },
    async touch(memberId) {
      if (!memberId) return
      await init()
      await sql`insert into tasker_presence (member, seen) values (${memberId}, ${Date.now()})
        on conflict (member) do update set seen = excluded.seen`
    },
    async presence(windowMs) {
      await init()
      return (await sql`select member from tasker_presence where seen > ${Date.now() - windowMs}`).map((r) => r.member)
    },
    async purgeDeleted() {
      await init()
      const cutoff = Date.now() - 30 * 24 * 3600 * 1000
      await sql`delete from tasker_rows where col = 'tasks' and (data->>'deletedAt')::bigint < ${cutoff}`
    },
  }
}
