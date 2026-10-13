import { create } from 'zustand'
import { api, connectEvents, setActor, type ChangePayload, type Op, type StatePayload } from './api'
import type { Activity, Attachment, Collection, CollectionMap, Comment, Member, OwnerType, Project, Status, Task } from './types'
import { addDays, addMonths, diffDays, todayIso, weekday } from './dates'

type Table<T> = Record<string, T>

export interface Toast {
  id: number
  text: string
  action?: { label: string; run: () => void }
  tone?: 'error'
}

interface State {
  ready: boolean
  error: string | null
  me: string | null
  online: boolean
  presence: string[]
  members: Table<Member>
  projects: Table<Project>
  tasks: Table<Task>
  comments: Table<Comment>
  attachments: Table<Attachment>
  activity: Activity[]
  toasts: Toast[]
  uploads: Record<string, { name: string; ownerId: string; progress: number }>
}

const ME_KEY = 'tasker.me'

export const useStore = create<State>(() => ({
  ready: false,
  error: null,
  me: localStorage.getItem(ME_KEY),
  online: true,
  presence: [],
  members: {},
  projects: {},
  tasks: {},
  comments: {},
  attachments: {},
  activity: [],
  toasts: [],
  uploads: {},
}))

const set = useStore.setState
const get = useStore.getState

export const uid = () => {
  const a = new Uint8Array(8)
  crypto.getRandomValues(a)
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const toTable = <T extends { id: string }>(rows: T[]) => Object.fromEntries(rows.map((r) => [r.id, r])) as Table<T>

let mode: StatePayload['mode'] = { realtime: 'sse', files: 'disk' }
let knownVersion = 0

function load(p: StatePayload, notify = false) {
  const me = get().me
  if (p.mode) mode = p.mode
  knownVersion = p.version ?? knownVersion
  if (notify) {
    const seen = new Set(get().activity.map((a) => a.id))
    notifyFromActivity(p.activity.filter((a) => !seen.has(a.id)))
  }
  set({
    ready: true,
    error: null,
    members: toTable(p.members),
    projects: toTable(p.projects),
    tasks: toTable(p.tasks),
    comments: toTable(p.comments),
    attachments: toTable(p.attachments),
    activity: p.activity,
    presence: p.presence,
    me: me && p.members.some((m) => m.id === me && !m.archived) ? me : null,
  })
}

// ---------- sync ----------

/** Rows with an in-flight local edit; incoming copies of them are held back until our write lands. */
const pending = new Map<string, number>()
const bump = (id: string, d: number) => {
  const n = (pending.get(id) ?? 0) + d
  if (n <= 0) pending.delete(id)
  else pending.set(id, n)
}

function applyChange(p: ChangePayload, skipPending: boolean) {
  const s = get()
  const next: Partial<Record<Collection, Table<unknown>>> = {}
  const table = (col: Collection) => (next[col] ??= { ...(s[col] as Table<unknown>) })
  for (const [col, item] of p.put) {
    if (skipPending && pending.has(item.id)) continue
    table(col)[item.id] = item
  }
  for (const [col, id] of p.del) delete table(col)[id]
  const patch: Partial<State> = next as Partial<State>
  if (p.activity.length) patch.activity = [...p.activity.slice().reverse(), ...s.activity].slice(0, 1000)
  set(patch)
  return s
}

let disconnect: (() => void) | null = null

export async function boot() {
  try {
    load(await api.state())
  } catch (e) {
    set({ error: (e as Error).message, ready: true })
    return
  }
  setActor(get().me)
  connect()
}

function connect() {
  disconnect?.()
  if (mode.realtime === 'poll') {
    disconnect = startPolling()
    return
  }
  disconnect = connectEvents(get().me, {
    change: (p) => {
      const before = applyChange(p, true)
      notifyAssignments(p, before)
    },
    presence: (presence) => set({ presence }),
    status: (online) => set({ online }),
    resync: () => api.state().then(load).catch(() => {}),
  })
}

/** Hosted mode: ask for a cheap version number every few seconds, refetch the snapshot when it moves. */
function startPolling() {
  let timer: number | undefined
  let stopped = false
  const tick = async () => {
    clearTimeout(timer)
    if (stopped) return
    if (document.visibilityState === 'visible') {
      try {
        const r = await api.poll(get().me)
        set({ presence: r.presence, online: true })
        // never overwrite optimistic edits that haven't reached the server yet
        if (r.version !== knownVersion && pending.size === 0) load(await api.state(), true)
      } catch {
        set({ online: false })
      }
    }
    if (!stopped) timer = window.setTimeout(tick, 4000)
  }
  const onVisible = () => document.visibilityState === 'visible' && tick()
  document.addEventListener('visibilitychange', onVisible)
  tick()
  return () => {
    stopped = true
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisible)
  }
}

function notifyFromActivity(entries: Activity[]) {
  const me = get().me
  if (!me) return
  for (const a of entries) {
    if (!a.taskId || !a.actorId || a.actorId === me) continue
    const toMe = (a.kind === 'created' && a.meta?.assigneeId === me) || (a.kind === 'assigned' && a.meta?.to === me)
    if (!toMe) continue
    const who = get().members[a.actorId]?.name ?? 'Хтось'
    toast(`${who}: «${a.title ?? ''}» — тепер ваше завдання`, {
      label: 'Відкрити',
      run: () => window.dispatchEvent(new CustomEvent('tasker:open', { detail: a.taskId })),
    })
  }
}

/** Someone else gave me a task → a quiet toast with a way to open it. */
function notifyAssignments(p: ChangePayload, before: State) {
  const me = get().me
  if (!me) return
  for (const [col, raw] of p.put) {
    if (col !== 'tasks') continue
    const t = raw as unknown as Task
    const prev = before.tasks[t.id]
    if (t.assigneeId !== me || prev?.assigneeId === me || t.deletedAt) continue
    const actor = p.activity.find((a) => a.taskId === t.id)?.actorId
    if (!actor || actor === me) continue
    const who = get().members[actor]?.name ?? 'Хтось'
    toast(`${who}: «${t.title}» — тепер ваше завдання`, {
      label: 'Відкрити',
      run: () => window.dispatchEvent(new CustomEvent('tasker:open', { detail: t.id })),
    })
  }
}

async function commit(ops: Op[], optimistic: () => void, ids: string[]) {
  ids.forEach((id) => bump(id, 1))
  optimistic()
  try {
    const res = await api.batch(ops)
    ids.forEach((id) => bump(id, -1))
    applyChange(res, true)
    return res
  } catch (e) {
    ids.forEach((id) => bump(id, -1))
    toast((e as Error).message || 'Не вдалося зберегти', undefined, 'error')
    api.state().then(load).catch(() => {})
    throw e
  }
}

function localPut<C extends Collection>(col: C, items: CollectionMap[C][]) {
  const s = get()
  const table = { ...(s[col] as Table<CollectionMap[C]>) }
  for (const it of items) table[it.id] = it
  set({ [col]: table } as Partial<State>)
}

function localDel(col: Collection, id: string) {
  const table = { ...(get()[col] as Table<unknown>) }
  delete table[id]
  set({ [col]: table } as Partial<State>)
}

// ---------- toasts ----------

let toastSeq = 0
export function toast(text: string, action?: Toast['action'], tone?: Toast['tone']) {
  const id = ++toastSeq
  set({ toasts: [...get().toasts.slice(-2), { id, text, action, tone }] })
  setTimeout(() => dismissToast(id), action ? 6000 : 3200)
  return id
}
export const dismissToast = (id: number) => set({ toasts: get().toasts.filter((t) => t.id !== id) })

let lastUndo: (() => void) | null = null
function undoable(text: string, run: () => void) {
  lastUndo = run
  toast(text, {
    label: 'Повернути',
    run: () => {
      lastUndo = null
      run()
    },
  })
}
export function undoLast() {
  const run = lastUndo
  lastUndo = null
  run?.()
  return Boolean(run)
}

// ---------- session ----------

export function signIn(id: string | null) {
  if (id) localStorage.setItem(ME_KEY, id)
  else localStorage.removeItem(ME_KEY)
  set({ me: id })
  setActor(id)
  connect()
}

// ---------- members ----------

export const activeMembers = (members: Table<Member>) =>
  Object.values(members)
    .filter((m) => !m.archived)
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)

export function addMembers(names: string[]) {
  const base = Object.keys(get().members).length
  const now = Date.now()
  const items: Member[] = names.map((name, i) => ({
    id: uid(),
    name: name.trim(),
    avatarId: null,
    archived: false,
    order: base + i,
    createdAt: now,
    updatedAt: now,
  }))
  commit(
    items.map((m) => ({ type: 'create', col: 'members', data: { ...m } })),
    () => localPut('members', items),
    items.map((m) => m.id),
  )
  return items
}

export function updateMember(id: string, patch: Partial<Member>) {
  const cur = get().members[id]
  if (!cur) return
  commit([{ type: 'update', col: 'members', id, data: patch }], () => localPut('members', [{ ...cur, ...patch, updatedAt: Date.now() }]), [id])
}

// ---------- projects ----------

export function addProject(name: string, description = '') {
  const now = Date.now()
  const p: Project = {
    id: uid(),
    name: name.trim(),
    description,
    ownerId: get().me,
    archived: false,
    order: now,
    createdAt: now,
    updatedAt: now,
  }
  commit([{ type: 'create', col: 'projects', data: { ...p } }], () => localPut('projects', [p]), [p.id])
  return p
}

export function updateProject(id: string, patch: Partial<Project>) {
  const cur = get().projects[id]
  if (!cur) return
  commit([{ type: 'update', col: 'projects', id, data: patch }], () => localPut('projects', [{ ...cur, ...patch, updatedAt: Date.now() }]), [id])
}

export function deleteProject(id: string) {
  const tasks = Object.values(get().tasks).filter((t) => t.projectId === id)
  commit(
    [{ type: 'delete', col: 'projects', id }],
    () => {
      localDel('projects', id)
      localPut(
        'tasks',
        tasks.map((t) => ({ ...t, projectId: null })),
      )
    },
    [id, ...tasks.map((t) => t.id)],
  )
}

// ---------- tasks ----------

export function newTask(partial: Partial<Task>): Task {
  const now = Date.now()
  const me = get().me
  return {
    id: uid(),
    title: '',
    notes: '',
    status: 'open',
    priority: 0,
    projectId: null,
    assigneeId: me,
    createdBy: me,
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
    order: now,
    deletedAt: null,
    ...partial,
    createdAt: now,
    updatedAt: now,
  }
}

export function addTask(partial: Partial<Task>) {
  const t = newTask(partial)
  const { createdAt: _c, updatedAt: _u, ...data } = t
  commit([{ type: 'create', col: 'tasks', data }], () => localPut('tasks', [t]), [t.id])
  return t
}

export function updateTask(id: string, patch: Partial<Task>) {
  const cur = get().tasks[id]
  if (!cur) return
  const next = { ...cur, ...patch, updatedAt: Date.now() }
  commit([{ type: 'update', col: 'tasks', id, data: patch }], () => localPut('tasks', [next]), [id])
}

export function updateTasks(changes: { id: string; patch: Partial<Task> }[]) {
  const s = get()
  const items = changes.filter((c) => s.tasks[c.id]).map((c) => ({ ...s.tasks[c.id], ...c.patch, updatedAt: Date.now() }))
  if (!items.length) return
  commit(
    changes.map((c) => ({ type: 'update', col: 'tasks', id: c.id, data: c.patch })),
    () => localPut('tasks', items),
    changes.map((c) => c.id),
  )
}

/** Next occurrence for a repeating task, shifted from its own anchor date. */
function nextOccurrence(t: Task): Partial<Task> | null {
  if (t.repeat === 'none') return null
  const anchor = t.date ?? t.due ?? todayIso()
  let next: string
  if (t.repeat === 'daily') next = addDays(anchor, 1)
  else if (t.repeat === 'weekdays') {
    next = addDays(anchor, 1)
    while (weekday(next) > 4) next = addDays(next, 1)
  } else if (t.repeat === 'weekly') next = addDays(anchor, 7)
  else next = addMonths(anchor, 1)
  const delta = diffDays(next, anchor)
  const shift = (s: string | null) => (s ? addDays(s, delta) : null)
  return {
    date: t.date ? shift(t.date) : t.scope === 'none' && !t.due ? next : null,
    scope: t.scope === 'none' && !t.due ? 'day' : t.scope,
    due: shift(t.due),
  }
}

export function setStatus(id: string, status: Status) {
  const t = get().tasks[id]
  if (!t || t.status === status) return
  const me = get().me
  const patch: Partial<Task> =
    status === 'open' ? { status, completedAt: null, completedBy: null } : { status, completedAt: Date.now(), completedBy: me }
  const prev = { status: t.status, completedAt: t.completedAt, completedBy: t.completedBy }
  updateTask(id, patch)

  let spawned: Task | null = null
  if (status === 'done' && t.status === 'open') {
    const next = nextOccurrence(t)
    const exists =
      next &&
      Object.values(get().tasks).some(
        (x) => x.id !== t.id && !x.deletedAt && x.status === 'open' && x.title === t.title && x.repeat === t.repeat && x.date === next.date && x.due === next.due,
      )
    if (next && !exists) {
      spawned = addTask({
        ...t,
        ...next,
        id: uid(),
        status: 'open',
        completedAt: null,
        completedBy: null,
        checklist: t.checklist.map((c) => ({ ...c, done: false })),
        steps: t.steps ? { ...t.steps, done: 0 } : null,
        createdBy: t.createdBy,
        order: Date.now(),
      })
    }
  }
  const label = status === 'done' ? 'Готово' : status === 'cancelled' ? 'Завдання скасовано' : 'Завдання знову відкрито'
  undoable(spawned ? `${label} · наступний повтор створено` : label, () => {
    updateTask(id, prev)
    if (spawned) removeTask(spawned.id, true)
  })
}

export function removeTask(id: string, silent = false) {
  updateTask(id, { deletedAt: Date.now() })
  if (!silent) undoable('Завдання видалено', () => updateTask(id, { deletedAt: null }))
}

export function duplicateTask(id: string) {
  const t = get().tasks[id]
  if (!t) return null
  return addTask({
    ...t,
    id: uid(),
    title: `${t.title} (копія)`,
    status: 'open',
    completedAt: null,
    completedBy: null,
    createdBy: get().me,
    order: t.order + 0.001,
    checklist: t.checklist.map((c) => ({ ...c, id: uid() })),
  })
}

// ---------- comments ----------

export function addComment(taskId: string, text: string) {
  const now = Date.now()
  const c: Comment = { id: uid(), taskId, authorId: get().me, text, createdAt: now, updatedAt: now }
  commit([{ type: 'create', col: 'comments', data: { id: c.id, taskId, text, authorId: c.authorId } }], () => localPut('comments', [c]), [c.id])
  return c
}

export function deleteComment(id: string) {
  const files = Object.values(get().attachments).filter((a) => a.ownerType === 'comment' && a.ownerId === id)
  commit(
    [{ type: 'delete', col: 'comments', id }, ...files.map((f) => ({ type: 'delete', col: 'attachments', id: f.id }) as Op)],
    () => {
      localDel('comments', id)
      files.forEach((f) => localDel('attachments', f.id))
    },
    [id],
  )
}

// ---------- files ----------

async function makeThumb(file: File) {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return null
  try {
    const bmp = await createImageBitmap(file)
    const max = 480
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const canvas = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k))
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 })
    const out = { blob, width: bmp.width, height: bmp.height }
    bmp.close()
    return out
  } catch {
    return null
  }
}

export async function uploadFiles(files: Iterable<File>, ownerType: OwnerType, ownerId: string) {
  const out: Attachment[] = []
  for (const file of files) {
    const key = uid()
    set({ uploads: { ...get().uploads, [key]: { name: file.name, ownerId, progress: 0 } } })
    try {
      const thumb = await makeThumb(file)
      if (mode.files === 'blob') {
        const att = await uploadToBlob(key, file, thumb, ownerType, ownerId, (progress) =>
          set({ uploads: { ...get().uploads, [key]: { name: file.name, ownerId, progress } } }),
        )
        localPut('attachments', [att])
        out.push(att)
        continue
      }
      const form = new FormData()
      form.set('id', key)
      form.set('ownerType', ownerType)
      form.set('ownerId', ownerId)
      form.set('file', file, file.name || 'image.png')
      if (thumb) {
        form.set('thumb', thumb.blob, 'thumb.webp')
        form.set('width', String(thumb.width))
        form.set('height', String(thumb.height))
      }
      const att = await api.upload(form, (progress) => set({ uploads: { ...get().uploads, [key]: { name: file.name, ownerId, progress } } }))
      localPut('attachments', [att])
      out.push(att)
    } catch (e) {
      toast(`${file.name}: ${(e as Error).message}`, undefined, 'error')
    } finally {
      const { [key]: _, ...rest } = get().uploads
      set({ uploads: rest })
    }
  }
  return out
}

async function uploadToBlob(
  id: string,
  file: File,
  thumb: Awaited<ReturnType<typeof makeThumb>>,
  ownerType: OwnerType,
  ownerId: string,
  onProgress: (share: number) => void,
) {
  const { upload } = await import('@vercel/blob/client')
  const safe = (file.name || 'image.png').replace(/[^\p{L}\p{N}._-]+/gu, '-')
  const main = await upload(`${ownerType}/${id}/${safe}`, file, {
    access: 'public',
    handleUploadUrl: '/api/blob',
    contentType: file.type || undefined,
    multipart: file.size > 8 * 1024 * 1024,
    onUploadProgress: (e) => onProgress(e.percentage / 100),
  })
  const small = thumb ? await upload(`${ownerType}/${id}/thumb.webp`, thumb.blob, { access: 'public', handleUploadUrl: '/api/blob', contentType: 'image/webp' }) : null
  return api.attach({
    id,
    ownerType,
    ownerId,
    name: file.name || 'image.png',
    size: file.size,
    mime: file.type || 'application/octet-stream',
    url: main.url,
    downloadUrl: main.downloadUrl,
    thumbUrl: small?.url ?? null,
    width: thumb?.width ?? null,
    height: thumb?.height ?? null,
  })
}

export function removeAttachment(id: string) {
  commit([{ type: 'delete', col: 'attachments', id }], () => localDel('attachments', id), [id])
}
