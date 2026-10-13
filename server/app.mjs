// The whole API as one Hono app. Runs as a long-lived Node server locally (SQLite + disk + SSE)
// and as a Vercel Function in production (Postgres + Vercel Blob + polling).
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { bodyLimit } from 'hono/body-limit'
import { basicAuth } from 'hono/basic-auth'
import { compress } from 'hono/compress'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

const MAX_FILE = 100 * 1024 * 1024
const PRESENCE_WINDOW = 30_000

// Field whitelist + defaults per collection. Anything else in a payload is dropped.
const SCHEMA = {
  members: { name: '', avatarId: null, archived: false, order: 0 },
  projects: { name: '', description: '', ownerId: null, archived: false, order: 0 },
  tasks: {
    title: '',
    notes: '',
    status: 'open',
    priority: 0,
    projectId: null,
    assigneeId: null,
    createdBy: null,
    completedAt: null,
    completedBy: null,
    scope: 'none',
    date: null,
    due: null,
    dueTime: null,
    repeat: 'none',
    tags: [],
    checklist: [],
    steps: null,
    order: 0,
    deletedAt: null,
  },
  comments: { taskId: null, authorId: null, text: '' },
}
const OWNER_TYPES = ['task', 'project', 'comment', 'member']

const newId = () => randomUUID().replaceAll('-', '').slice(0, 16)

function pick(col, src, base) {
  const out = base ? { ...base } : {}
  for (const key of Object.keys(SCHEMA[col])) {
    if (src && key in src) out[key] = src[key]
    else if (!base) out[key] = structuredClone(SCHEMA[col][key])
  }
  return out
}

/**
 * @param {object} opts
 * @param {ReturnType<import('./store/sqlite.mjs').createSqliteStore>} opts.store
 * @param {'sse' | 'poll'} opts.realtime
 * @param {'disk' | 'blob'} opts.files
 */
export function createApp({ store, realtime, files }) {
  // ---------- live clients (SSE mode only) ----------
  const clients = new Set()

  const presence = async () =>
    realtime === 'sse' ? [...new Set([...clients].map((c) => c.memberId).filter(Boolean))] : store.presence(PRESENCE_WINDOW)

  function broadcast(event, payload) {
    if (realtime !== 'sse') return
    const data = JSON.stringify(payload)
    for (const client of clients) client.stream.writeSSE({ event, data }).catch(() => clients.delete(client))
  }
  const broadcastPresence = async () => broadcast('presence', { presence: await presence() })

  // ---------- activity ----------

  async function activityFor(col, before, after, actorId) {
    const at = Date.now()
    const out = []
    const push = (kind, extra = {}) => out.push({ id: newId(), actorId, at, kind, ...extra })

    if (col === 'tasks') {
      const ref = { taskId: after.id, title: after.title, projectId: after.projectId }
      if (!before) {
        push('created', { ...ref, meta: { assigneeId: after.assigneeId } })
        return out
      }
      if (!before.deletedAt && after.deletedAt) push('deleted', ref)
      if (before.deletedAt && !after.deletedAt) push('restored', ref)
      if (before.status !== after.status) push(after.status === 'done' ? 'completed' : after.status === 'cancelled' ? 'cancelled' : 'reopened', ref)
      if (before.assigneeId !== after.assigneeId) push('assigned', { ...ref, meta: { from: before.assigneeId, to: after.assigneeId } })
      if (before.projectId !== after.projectId) push('moved', { ...ref, meta: { from: before.projectId, to: after.projectId } })
      if (before.title !== after.title) push('renamed', { ...ref, meta: { from: before.title } })
      if (before.scope !== after.scope || before.date !== after.date || before.due !== after.due || before.dueTime !== after.dueTime) {
        push('rescheduled', { ...ref, meta: { scope: after.scope, date: after.date, due: after.due, dueTime: after.dueTime } })
      }
    }
    if (col === 'projects' && !before) push('project', { projectId: after.id, title: after.name })
    if (col === 'members' && !before) push('member', { meta: { memberId: after.id, name: after.name } })
    if (col === 'comments' && !before) {
      const task = await store.get('tasks', after.taskId)
      push('commented', { taskId: after.taskId, title: task?.title, meta: { text: after.text.slice(0, 140) } })
    }
    return out
  }

  // ---------- files ----------

  async function removeFiles(att) {
    if (att?.url) {
      const { del } = await import('@vercel/blob')
      await del([att.url, att.thumbUrl].filter(Boolean)).catch((err) => console.error('blob delete', err))
    } else if (files === 'disk') {
      for (const f of [att.id, `${att.id}_t`]) fs.rm(path.join(store.uploadDir, f), { force: true }, () => {})
    }
  }

  async function saveAttachment(item) {
    const activity = []
    if (item.ownerType === 'task') {
      const task = await store.get('tasks', item.ownerId)
      activity.push({ id: newId(), at: item.createdAt, actorId: item.createdBy, kind: 'attached', taskId: item.ownerId, title: task?.title, meta: { name: item.name } })
    }
    await store.put('attachments', item)
    await store.logActivity(activity)
    await store.bump()
    return activity
  }

  // ---------- mutations ----------

  async function applyOp(op, actorId) {
    const { type, col } = op
    if (!SCHEMA[col] && !(col === 'attachments' && type === 'delete')) throw new Error(`unknown collection ${col}`)
    const now = Date.now()

    if (type === 'create') {
      const id = typeof op.data?.id === 'string' && op.data.id.length <= 40 ? op.data.id : newId()
      const before = await store.get(col, id)
      const item = { ...pick(col, op.data), id, createdAt: before?.createdAt ?? now, updatedAt: now }
      if (col === 'tasks') {
        item.createdBy ??= actorId
        if (item.status === 'done' && !item.completedAt) Object.assign(item, { completedAt: now, completedBy: actorId })
      }
      if (col === 'comments') item.authorId ??= actorId
      if (col === 'projects') item.ownerId ??= actorId
      await store.put(col, item)
      return { put: [[col, item]], activity: await activityFor(col, before, item, actorId) }
    }

    const before = await store.get(col, op.id)
    if (!before) return { put: [], activity: [] }

    if (type === 'update') {
      const item = { ...pick(col, op.data, before), updatedAt: now }
      if (col === 'tasks' && before.status !== item.status) {
        if (item.status === 'open') Object.assign(item, { completedAt: null, completedBy: null })
        else Object.assign(item, { completedAt: now, completedBy: actorId })
      }
      await store.put(col, item)
      return { put: [[col, item]], activity: await activityFor(col, before, item, actorId) }
    }

    if (type === 'delete') {
      const put = []
      if (col === 'attachments') await removeFiles(before)
      if (col === 'projects') {
        for (const t of await store.all('tasks')) {
          if (t.projectId === op.id) put.push(['tasks', await store.put('tasks', { ...t, projectId: null, updatedAt: now })])
        }
      }
      await store.del(col, op.id)
      return { put, del: [[col, op.id]], activity: [] }
    }
    throw new Error(`unknown op ${type}`)
  }

  async function runOps(ops, actorId, origin) {
    const put = []
    const del = []
    const activity = []
    for (const op of ops) {
      const r = await applyOp(op, actorId)
      put.push(...r.put)
      if (r.del) del.push(...r.del)
      activity.push(...r.activity)
    }
    await store.logActivity(activity)
    const version = await store.bump()
    const result = { put, del, activity, version }
    broadcast('change', { origin, ...result })
    return result
  }

  // ---------- routes ----------

  const app = new Hono()

  // Optional shared password for the whole team: TASKER_PASSWORD=...
  if (process.env.TASKER_PASSWORD) {
    app.use('/api/*', basicAuth({ username: process.env.TASKER_USER || 'team', password: process.env.TASKER_PASSWORD, realm: 'Tasker' }))
    app.use('/files/*', basicAuth({ username: process.env.TASKER_USER || 'team', password: process.env.TASKER_PASSWORD, realm: 'Tasker' }))
  }

  const actor = (c) => c.req.header('x-member') || null
  const origin = (c) => c.req.header('x-client') || null

  app.use('/api/state', compress())

  app.onError((err, c) => {
    console.error(err)
    // driver errors (e.g. AggregateError on connect) often have an empty message
    const inner = err.errors?.[0] ?? err.cause
    const message = err.message || inner?.message || err.code || inner?.code || err.name || 'Помилка сервера'
    return c.json({ error: message }, 400)
  })

  app.get('/api/state', async (c) => {
    const [snapshot, activity, version, online] = await Promise.all([store.snapshot(), store.activity(), store.version(), presence()])
    return c.json({ ...snapshot, activity, presence: online, version, mode: { realtime, files } })
  })

  app.post('/api/batch', async (c) => {
    const { ops } = await c.req.json()
    if (!Array.isArray(ops) || ops.length > 500) return c.json({ error: 'bad ops' }, 400)
    return c.json(await runOps(ops, actor(c), origin(c)))
  })

  if (realtime === 'sse') {
    app.get('/api/events', (c) => {
      const memberId = c.req.query('member') || null
      c.header('x-accel-buffering', 'no')
      c.header('cache-control', 'no-cache, no-transform')
      return streamSSE(c, async (stream) => {
        const client = { memberId, stream }
        let open = true
        stream.onAbort(() => {
          open = false
          clients.delete(client)
          broadcastPresence()
        })
        clients.add(client)
        broadcastPresence()
        while (open) {
          await stream.sleep(20000)
          if (open) await stream.writeSSE({ event: 'ping', data: '' }).catch(() => (open = false))
        }
      })
    })
  } else {
    // Serverless instances can't hold a shared stream, so clients poll a cheap version counter.
    app.get('/api/poll', async (c) => {
      await store.touch(c.req.query('member') || null)
      const [version, online] = await Promise.all([store.version(), presence()])
      c.header('cache-control', 'no-store')
      return c.json({ version, presence: online })
    })
  }

  if (files === 'blob') {
    // Browsers upload straight to Vercel Blob (function bodies are capped at 4.5 MB); we only sign the request.
    app.post('/api/blob', async (c) => {
      const { handleUpload } = await import('@vercel/blob/client')
      const result = await handleUpload({
        body: await c.req.json(),
        request: c.req.raw,
        onBeforeGenerateToken: async () => ({ maximumSizeInBytes: MAX_FILE, addRandomSuffix: true }),
      })
      return c.json(result)
    })

    app.post('/api/attachments', async (c) => {
      const b = await c.req.json()
      const isBlob = (u) => typeof u === 'string' && /^https:\/\/[a-z0-9.-]+\.blob\.vercel-storage\.com\//i.test(u)
      if (!OWNER_TYPES.includes(b.ownerType) || !isBlob(b.url)) return c.json({ error: 'bad attachment' }, 400)
      const item = {
        id: typeof b.id === 'string' && /^[a-z0-9]{8,40}$/i.test(b.id) ? b.id : newId(),
        ownerType: b.ownerType,
        ownerId: String(b.ownerId || ''),
        name: String(b.name || 'file').slice(0, 200),
        size: Number(b.size) || 0,
        mime: String(b.mime || 'application/octet-stream'),
        url: b.url,
        downloadUrl: isBlob(b.downloadUrl) ? b.downloadUrl : b.url,
        thumbUrl: isBlob(b.thumbUrl) ? b.thumbUrl : null,
        thumb: isBlob(b.thumbUrl),
        width: Number(b.width) || null,
        height: Number(b.height) || null,
        createdBy: actor(c),
        createdAt: Date.now(),
      }
      await saveAttachment(item)
      return c.json(item)
    })
  } else {
    app.post(
      '/api/upload',
      bodyLimit({ maxSize: MAX_FILE + 2 * 1024 * 1024, onError: (c) => c.json({ error: 'Файл більший за 100 МБ' }, 413) }),
      async (c) => {
        const body = await c.req.parseBody()
        const file = body.file
        if (!(file instanceof File)) return c.json({ error: 'no file' }, 400)
        const ownerType = String(body.ownerType || '')
        if (!OWNER_TYPES.includes(ownerType)) return c.json({ error: 'bad owner' }, 400)

        const id = typeof body.id === 'string' && /^[a-z0-9]{8,40}$/i.test(body.id) ? body.id : newId()
        await fs.promises.writeFile(path.join(store.uploadDir, id), Buffer.from(await file.arrayBuffer()))
        const thumb = body.thumb instanceof File
        if (thumb) await fs.promises.writeFile(path.join(store.uploadDir, `${id}_t`), Buffer.from(await body.thumb.arrayBuffer()))

        const item = {
          id,
          ownerType,
          ownerId: String(body.ownerId || ''),
          name: (file.name || 'file').slice(0, 200),
          size: file.size,
          mime: file.type || 'application/octet-stream',
          thumb,
          width: Number(body.width) || null,
          height: Number(body.height) || null,
          createdBy: actor(c),
          createdAt: Date.now(),
        }
        const activity = await saveAttachment(item)
        broadcast('change', { origin: origin(c), put: [['attachments', item]], del: [], activity })
        return c.json(item)
      },
    )

    app.get('/files/:id', async (c) => {
      const raw = c.req.param('id')
      const isThumb = raw.endsWith('_t')
      const id = isThumb ? raw.slice(0, -2) : raw
      const meta = await store.get('attachments', id)
      if (!meta) return c.notFound()
      const file = path.join(store.uploadDir, isThumb ? `${id}_t` : id)
      const stat = await fs.promises.stat(file).catch(() => null)
      if (!stat) return c.notFound()
      // only render inline what a browser can't execute; everything else downloads
      const safeInline = /^(image\/(png|jpe?g|gif|webp|avif|bmp)|application\/pdf|text\/plain|video\/|audio\/)/.test(meta.mime)
      const download = c.req.query('download') !== undefined || (!isThumb && !safeInline)
      const name = encodeURIComponent(meta.name)
      return new Response(Readable.toWeb(fs.createReadStream(file)), {
        headers: {
          'content-type': isThumb ? 'image/webp' : meta.mime,
          'content-length': String(stat.size),
          'cache-control': 'private, max-age=31536000, immutable',
          'content-disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${name}`,
          'x-content-type-options': 'nosniff',
          // Chrome's PDF viewer refuses to render inside a CSP sandbox; it runs isolated on its own
          ...(meta.mime === 'application/pdf' ? {} : { 'content-security-policy': "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'" }),
        },
      })
    })
  }

  return app
}
