// Local / self-hosted entry: one Node process, SQLite (or Postgres if DATABASE_URL is set), live SSE.
import path from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { compress } from 'hono/compress'
import { createApp } from './app.mjs'
import { createStore } from './store/index.mjs'

const PROD = process.env.NODE_ENV === 'production'
// In dev the UI owns PORT (Vite proxies /api to 3001); hosting platforms set PORT for production.
const PORT = Number(process.env.API_PORT || (PROD && process.env.PORT) || 3001)

const store = await createStore(path.resolve(process.env.DATA_DIR || 'data'))
const app = createApp({ store, realtime: process.env.TASKER_REALTIME === 'poll' ? 'poll' : 'sse', files: store.uploadDir ? 'disk' : 'blob' })

if (PROD) {
  app.use('/assets/*', compress())
  app.use('/assets/*', serveStatic({ root: './dist', onFound: (_p, c) => c.header('cache-control', 'public, max-age=31536000, immutable') }))
  app.use('*', serveStatic({ root: './dist' }))
  app.get('*', serveStatic({ path: './dist/index.html' }))
}

await store.purgeDeleted()

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Tasker API → http://localhost:${info.port}${PROD ? '' : '  (UI: http://localhost:5173)'}`)
})
