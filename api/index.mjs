// Vercel Function entry. vercel.json rewrites every /api/* request here.
import { Hono } from 'hono'
import { handle } from 'hono/vercel'
import { createApp } from '../server/app.mjs'
import { createPostgresStore } from '../server/store/postgres.mjs'
import { databaseUrl } from '../server/store/index.mjs'

const url = databaseUrl()

const app = url
  ? createApp({ store: createPostgresStore(url), realtime: 'poll', files: 'blob' })
  : new Hono().all('/api/*', (c) =>
      c.json({ error: 'База даних не підключена: додайте Neon Postgres у Vercel → Storage, щоб зʼявилась змінна DATABASE_URL.' }, 500),
    )

const handler = handle(app)
export const GET = handler
export const POST = handler
export const PUT = handler
export const PATCH = handler
export const DELETE = handler
