import type { Activity, Attachment, Collection, Comment, Member, Project, Task } from './types'

export const clientId = Math.random().toString(36).slice(2, 12)
let actorId: string | null = null
export const setActor = (id: string | null) => {
  actorId = id
}

export interface StatePayload {
  members: Member[]
  projects: Project[]
  tasks: Task[]
  comments: Comment[]
  attachments: Attachment[]
  activity: Activity[]
  presence: string[]
  version: number
  mode: { realtime: 'sse' | 'poll'; files: 'disk' | 'blob' }
}

export type Op =
  | { type: 'create'; col: Collection; data: Record<string, unknown> }
  | { type: 'update'; col: Collection; id: string; data: Record<string, unknown> }
  | { type: 'delete'; col: Collection; id: string }

export interface ChangePayload {
  origin?: string | null
  put: [Collection, Record<string, unknown> & { id: string }][]
  del: [Collection, string][]
  activity: Activity[]
}

function headers(json = true): Record<string, string> {
  const h: Record<string, string> = { 'x-client': clientId }
  if (actorId) h['x-member'] = actorId
  if (json) h['content-type'] = 'application/json'
  return h
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { ...headers(Boolean(init?.body)), ...(init?.headers as object) } })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Помилка ${res.status}`)
  }
  return res.json()
}

export const api = {
  state: () => req<StatePayload>('/api/state'),
  batch: (ops: Op[]) => req<ChangePayload>('/api/batch', { method: 'POST', body: JSON.stringify({ ops }) }),
  poll: (member: string | null) => req<{ version: number; presence: string[] }>(`/api/poll?member=${encodeURIComponent(member ?? '')}`),
  attach: (meta: Partial<Attachment>) => req<Attachment>('/api/attachments', { method: 'POST', body: JSON.stringify(meta) }),

  upload(form: FormData, onProgress?: (share: number) => void) {
    return new Promise<Attachment>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/api/upload')
      for (const [k, v] of Object.entries(headers(false))) xhr.setRequestHeader(k, v)
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total)
      xhr.onload = () => {
        let body: { error?: string } = {}
        try {
          body = JSON.parse(xhr.responseText)
        } catch {
          /* empty */
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body as Attachment)
        else reject(new Error(body.error || `Помилка завантаження (${xhr.status})`))
      }
      xhr.onerror = () => reject(new Error('Немає зʼєднання із сервером'))
      xhr.send(form)
    })
  },
}

export function connectEvents(
  memberId: string | null,
  handlers: {
    change: (p: ChangePayload) => void
    presence: (ids: string[]) => void
    status: (online: boolean) => void
    resync: () => void
  },
) {
  const url = `/api/events?member=${encodeURIComponent(memberId ?? '')}`
  let source: EventSource | null = null
  let dropped = false
  let retry: number | undefined

  const open = () => {
    source = new EventSource(url)
    source.onopen = () => {
      handlers.status(true)
      if (dropped) handlers.resync()
      dropped = false
    }
    source.onerror = () => {
      handlers.status(false)
      dropped = true
      if (source?.readyState === EventSource.CLOSED) {
        source.close()
        retry = window.setTimeout(open, 3000)
      }
    }
    source.addEventListener('change', (e) => {
      const payload = JSON.parse((e as MessageEvent).data) as ChangePayload
      if (payload.origin !== clientId) handlers.change(payload)
    })
    source.addEventListener('presence', (e) => handlers.presence(JSON.parse((e as MessageEvent).data).presence))
  }
  open()

  return () => {
    clearTimeout(retry)
    source?.close()
  }
}

export function fileUrl(a: Pick<Attachment, 'id' | 'url' | 'downloadUrl' | 'thumbUrl'>, opts: { thumb?: boolean; download?: boolean } = {}) {
  if (a.url) return opts.download ? (a.downloadUrl ?? a.url) : opts.thumb && a.thumbUrl ? a.thumbUrl : a.url
  return `/files/${a.id}${opts.thumb ? '_t' : ''}${opts.download ? '?download' : ''}`
}
