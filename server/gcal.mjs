// Two-way sync between Tasker tasks and each member's own Google Calendar.
//
// Tasker → Google: every dated task lives as an event in a «Таскер» calendar inside the assignee's account
//   (all-day for a day, timed when the task has a time). Moves, renames, reassignments, completion and
//   deletion are pushed right after each write.
// Google → Tasker: the «Таскер» calendar is read incrementally (syncToken). Dragging an event moves the task,
//   renaming renames it, deleting it unschedules the task, and a new event there becomes a new task.
// The member's primary calendar is read-only here: its events are shown next to tasks in the calendar view.
import { createHmac, timingSafeEqual } from 'node:crypto'

const G = 'https://www.googleapis.com/calendar/v3'
const SCOPE = 'openid email https://www.googleapis.com/auth/calendar'
const COL = 'gauth' // private: refresh tokens never leave the server
const PULL_EVERY = 20_000
const EVENT_MINUTES = 60
const DEFAULT_TZ = 'Europe/Kyiv'

const enc = encodeURIComponent

export function createGcal({ store, runOps, newId }) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const secret = process.env.GOOGLE_CLIENT_SECRET
  const enabled = Boolean(clientId && secret)
  const tokens = new Map() // memberId → { access, exp }
  const pulling = new Map() // memberId → in-flight pull

  // ---------- auth ----------

  const sign = (s) => createHmac('sha256', secret).update(s).digest('base64url')
  const makeState = (memberId, origin) => {
    const body = Buffer.from(JSON.stringify({ m: memberId, o: origin, t: Date.now() })).toString('base64url')
    return `${body}.${sign(body)}`
  }
  const readState = (state) => {
    const [body, sig] = String(state || '').split('.')
    if (!body || !sig) return null
    const a = Buffer.from(sig)
    const b = Buffer.from(sign(body))
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
    const data = JSON.parse(Buffer.from(body, 'base64url').toString())
    return Date.now() - data.t < 15 * 60_000 ? data : null
  }

  async function accessToken(rec) {
    const cached = tokens.get(rec.id)
    if (cached && cached.exp > Date.now() + 60_000) return cached.access
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: secret, refresh_token: rec.refreshToken, grant_type: 'refresh_token' }),
    })
    const json = await res.json()
    if (!res.ok) {
      // revoked or expired: forget the connection so the UI asks to reconnect
      if (json.error === 'invalid_grant') await store.put(COL, { ...rec, broken: true })
      throw new Error(`google token: ${json.error || res.status}`)
    }
    tokens.set(rec.id, { access: json.access_token, exp: Date.now() + json.expires_in * 1000 })
    return json.access_token
  }

  async function g(rec, path, init = {}) {
    const res = await fetch(`${G}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${await accessToken(rec)}`, 'content-type': 'application/json', ...init.headers },
    })
    if (res.status === 204) return null
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      const err = new Error(`google ${res.status}: ${json.error?.message ?? ''}`)
      err.status = res.status
      throw err
    }
    return json
  }

  const connections = async () => new Map((await store.all(COL)).filter((r) => r.refreshToken && !r.broken).map((r) => [r.id, r]))

  // ---------- dates ----------

  const addDay = (day, n = 1) => {
    const d = new Date(`${day}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + n)
    return d.toISOString().slice(0, 10)
  }
  const plusMinutes = (time, minutes) => {
    const [h, m] = time.split(':').map(Number)
    const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59)
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  }
  /** The day a task sits on in a calendar: its planned day, or its deadline. */
  const dayOf = (t) => (t.scope === 'day' && t.date ? t.date : t.due || null)
  const local = (iso, tz) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date(iso))
        .map((p) => [p.type, p.value]),
    )
    return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
  }

  // ---------- Tasker → Google ----------

  const eventId = (t, rec) => (t.gEvent && t.gEventOwner === rec.id ? t.gEvent : `tasker${t.id}`)

  function eventBody(t, rec, appUrl) {
    const day = dayOf(t)
    const timed = Boolean(t.dueTime && t.due === day)
    const link = appUrl ? `${appUrl}/#/today?task=${t.id}` : ''
    return {
      summary: `${t.status === 'done' ? '✓ ' : ''}${t.title}`,
      description: [t.notes, link && `Відкрити в Таскері: ${link}`].filter(Boolean).join('\n\n'),
      start: timed ? { dateTime: `${day}T${t.dueTime}:00`, timeZone: rec.tz } : { date: day },
      end: timed ? { dateTime: `${day}T${plusMinutes(t.dueTime, EVENT_MINUTES)}:00`, timeZone: rec.tz } : { date: addDay(day) },
      status: 'confirmed',
      transparency: timed ? 'opaque' : 'transparent',
      extendedProperties: { private: { taskerId: t.id } },
    }
  }

  async function upsert(rec, t, appUrl) {
    const id = eventId(t, rec)
    const body = eventBody(t, rec, appUrl)
    const cal = enc(rec.calendarId)
    try {
      await g(rec, `/calendars/${cal}/events/${id}`, { method: 'PUT', body: JSON.stringify(body) })
    } catch (err) {
      if (err.status !== 404) throw err
      await g(rec, `/calendars/${cal}/events`, { method: 'POST', body: JSON.stringify({ ...body, id }) }).catch(async (e) => {
        // an id that was deleted earlier can't be inserted again, but it can be updated back to life
        if (e.status !== 409) throw e
        await g(rec, `/calendars/${cal}/events/${id}`, { method: 'PUT', body: JSON.stringify(body) })
      })
    }
  }

  async function remove(rec, t) {
    await g(rec, `/calendars/${enc(rec.calendarId)}/events/${eventId(t, rec)}`, { method: 'DELETE' }).catch((err) => {
      if (err.status !== 404 && err.status !== 410) throw err
    })
  }

  /** Mirror one task change into Google. `before`/`after` are the stored task before and after the write. */
  async function push(pairs, appUrl) {
    if (!enabled || !pairs.length) return
    const recs = await connections()
    if (!recs.size) return
    const target = (t) => (t && !t.deletedAt && t.status !== 'cancelled' && t.assigneeId && dayOf(t) ? recs.get(t.assigneeId) : undefined)
    for (const [before, after] of pairs) {
      const from = target(before)
      const to = target(after)
      try {
        if (from && from !== to) await remove(from, before)
        if (to) await upsert(to, after, appUrl)
      } catch (err) {
        console.error('gcal push', after?.id ?? before?.id, err.message)
      }
    }
  }

  /** Put all of a member's dated tasks into their calendar (right after connecting). */
  async function pushAllFor(rec, appUrl) {
    const tasks = (await store.all('tasks')).filter((t) => t.assigneeId === rec.id && !t.deletedAt && t.status !== 'cancelled' && dayOf(t))
    for (const t of tasks) await upsert(rec, t, appUrl).catch((err) => console.error('gcal initial push', t.id, err.message))
  }

  // ---------- Google → Tasker ----------

  async function pull(rec) {
    if (rec.broken) return
    const tasks = new Map((await store.all('tasks')).map((t) => [t.id, t]))
    const ops = []
    let pageToken
    let syncToken = rec.syncToken
    let next
    for (;;) {
      const qs = new URLSearchParams({ showDeleted: 'true', singleEvents: 'true', maxResults: '250' })
      if (syncToken) qs.set('syncToken', syncToken)
      else qs.set('timeMin', new Date(Date.now() - 60 * 86400_000).toISOString())
      if (pageToken) qs.set('pageToken', pageToken)
      let page
      try {
        page = await g(rec, `/calendars/${enc(rec.calendarId)}/events?${qs}`)
      } catch (err) {
        if (err.status === 410 && syncToken) {
          // token expired: one full resync; matching by task id keeps it idempotent
          syncToken = null
          pageToken = undefined
          continue
        }
        throw err
      }
      for (const ev of page.items ?? []) {
        const op = await fromEvent(rec, ev, tasks)
        if (op) ops.push(op)
      }
      pageToken = page.nextPageToken
      if (!pageToken) {
        next = page.nextSyncToken
        break
      }
    }
    if (ops.length) await runOps(ops, rec.id, 'gcal')
    await store.put(COL, { ...(await store.get(COL, rec.id)), syncToken: next ?? rec.syncToken, lastPull: Date.now() })
  }

  async function fromEvent(rec, ev, tasks) {
    const taskId = ev.extendedProperties?.private?.taskerId ?? (ev.id?.startsWith('tasker') ? ev.id.slice(6) : null)
    const t = taskId ? tasks.get(taskId) : null

    if (ev.status === 'cancelled') {
      // deleted in Google: keep the task, just take it off the calendar
      if (!t || t.deletedAt || t.assigneeId !== rec.id || !dayOf(t) || t.status === 'cancelled') return null
      return { type: 'update', col: 'tasks', id: t.id, data: { scope: 'none', date: null, due: null, dueTime: null } }
    }
    if (!ev.start) return null
    const allDay = Boolean(ev.start.date)
    const { day, time } = allDay ? { day: ev.start.date, time: null } : local(ev.start.dateTime, rec.tz)
    const title = (ev.summary || '').replace(/^✓\s*/, '').trim() || 'Без назви'

    if (t) {
      if (t.deletedAt) return null
      const patch = {}
      const oldDay = dayOf(t)
      const oldTime = t.dueTime && t.due === oldDay ? t.dueTime : null
      if (day !== oldDay || time !== oldTime) {
        if (time) Object.assign(patch, { scope: 'day', date: day, due: day, dueTime: time })
        else Object.assign(patch, { scope: 'day', date: day, due: t.due && t.due !== oldDay ? t.due : null, dueTime: t.due && t.due !== oldDay ? t.dueTime : null })
      }
      if (title !== t.title) patch.title = title
      return Object.keys(patch).length ? { type: 'update', col: 'tasks', id: t.id, data: patch } : null
    }

    // a new event made in Google's «Таскер» calendar becomes a task for this member
    if (taskId) return null
    const id = newId()
    await g(rec, `/calendars/${enc(rec.calendarId)}/events/${ev.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ extendedProperties: { private: { taskerId: id } } }),
    }).catch((err) => console.error('gcal tag event', err.message))
    return {
      type: 'create',
      col: 'tasks',
      data: {
        id,
        title,
        notes: ev.description || '',
        assigneeId: rec.id,
        createdBy: rec.id,
        scope: 'day',
        date: day,
        due: time ? day : null,
        dueTime: time,
        gEvent: ev.id,
        gEventOwner: rec.id,
        order: Date.now(),
      },
    }
  }

  /** Throttled pull for one member; safe to call on every poll. */
  async function pullMaybe(memberId) {
    if (!enabled || !memberId || pulling.has(memberId)) return
    const rec = await store.get(COL, memberId)
    if (!rec?.refreshToken || rec.broken || Date.now() - (rec.lastPull ?? 0) < PULL_EVERY) return
    const job = pull(rec)
      .catch((err) => console.error('gcal pull', memberId, err.message))
      .finally(() => pulling.delete(memberId))
    pulling.set(memberId, job)
    await job
  }

  async function pullAll() {
    if (!enabled) return
    for (const rec of (await connections()).values()) await pullMaybe(rec.id)
  }

  // ---------- routes ----------

  function routes(app) {
    const originOf = (c) => process.env.APP_URL?.replace(/\/$/, '') || new URL(c.req.url).origin
    const redirectUri = (origin) => `${origin}/api/gcal/callback`

    app.get('/api/gcal/connect', (c) => {
      if (!enabled) return c.text('Google Calendar не налаштовано: додайте GOOGLE_CLIENT_ID і GOOGLE_CLIENT_SECRET.', 400)
      const member = c.req.query('member')
      if (!member) return c.text('member?', 400)
      const origin = originOf(c)
      const qs = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri(origin),
        response_type: 'code',
        scope: SCOPE,
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state: makeState(member, origin),
      })
      return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${qs}`)
    })

    app.get('/api/gcal/callback', async (c) => {
      const state = readState(c.req.query('state'))
      if (!state) return c.text('Посилання застаріло — спробуйте підключити ще раз.', 400)
      const back = (status) => c.redirect(`${state.o}/#/calendar?gcal=${status}`)
      if (c.req.query('error')) return back('denied')

      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code: c.req.query('code'), client_id: clientId, client_secret: secret, redirect_uri: redirectUri(state.o), grant_type: 'authorization_code' }),
      })
      const tok = await res.json()
      if (!res.ok || !tok.refresh_token) return back('error')

      const email = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString()).email
      const prev = await store.get(COL, state.m)
      const rec = { id: state.m, email, refreshToken: tok.refresh_token, tz: DEFAULT_TZ, calendarId: prev?.email === email ? prev.calendarId : null, syncToken: null, lastPull: 0 }
      tokens.set(rec.id, { access: tok.access_token, exp: Date.now() + tok.expires_in * 1000 })

      const primary = await g(rec, '/calendars/primary')
      rec.tz = primary.timeZone || DEFAULT_TZ
      // reuse the «Таскер» calendar if it already exists in this account
      if (!rec.calendarId) {
        const list = await g(rec, '/users/me/calendarList?minAccessRole=owner')
        rec.calendarId = list.items?.find((x) => x.summary === 'Таскер')?.id ?? null
      }
      if (!rec.calendarId) {
        const cal = await g(rec, '/calendars', { method: 'POST', body: JSON.stringify({ summary: 'Таскер', description: 'Завдання з Таскера. Перетягніть подію — зміниться дата завдання.', timeZone: rec.tz }) })
        rec.calendarId = cal.id
      }
      await store.put(COL, rec)
      await pushAllFor(rec, state.o)
      // read once to get a sync token, so later pulls only see real changes
      await pull(rec).catch((err) => console.error('gcal first pull', err.message))
      return back('connected')
    })

    app.post('/api/gcal/disconnect', async (c) => {
      const member = c.req.header('x-member')
      const rec = member && (await store.get(COL, member))
      if (rec) {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${enc(rec.refreshToken)}`, { method: 'POST' }).catch(() => {})
        await store.del(COL, member)
        tokens.delete(member)
      }
      return c.json({ ok: true })
    })

    // the member's own meetings from their primary calendar, for the Tasker calendar view
    app.get('/api/gcal/events', async (c) => {
      const member = c.req.header('x-member')
      const rec = member && (await store.get(COL, member))
      if (!rec?.refreshToken || rec.broken) return c.json({ events: [] })
      const from = c.req.query('from')
      const to = c.req.query('to')
      const qs = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', maxResults: '500', timeMin: `${addDay(from, -1)}T00:00:00Z`, timeMax: `${addDay(to, 1)}T23:59:59Z` })
      const res = await g(rec, `/calendars/primary/events?${qs}`)
      const events = (res.items ?? [])
        .filter((ev) => ev.status !== 'cancelled' && ev.start)
        .map((ev) => {
          const allDay = Boolean(ev.start.date)
          const start = allDay ? { day: ev.start.date, time: null } : local(ev.start.dateTime, rec.tz)
          const end = allDay ? null : local(ev.end.dateTime, rec.tz)
          return { id: ev.id, title: ev.summary || '(без назви)', day: start.day, time: start.time, endTime: end?.day === start.day ? end.time : null, allDay, link: ev.htmlLink }
        })
        .filter((ev) => ev.day >= from && ev.day <= to)
      c.header('cache-control', 'private, max-age=30')
      return c.json({ events })
    })
  }

  async function status() {
    if (!enabled) return { enabled: false, connected: {} }
    const recs = await store.all(COL)
    return { enabled: true, connected: Object.fromEntries(recs.filter((r) => r.refreshToken).map((r) => [r.id, { email: r.email, broken: Boolean(r.broken) }])) }
  }

  return { enabled, routes, push, pullMaybe, pullAll, status }
}
