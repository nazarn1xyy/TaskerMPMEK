import { Fragment, useMemo, useRef, useState } from 'react'
import { Paperclip, X } from 'lucide-react'
import { addComment, deleteComment, uploadFiles, useStore } from '../lib/store'
import { timeAgo } from '../lib/dates'
import type { Activity, Member, Project } from '../lib/types'
import { Avatar, AutoText, Kbd } from './ui'
import { InlineFiles } from './Files'
import { whenLabel } from './DatePicker'

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g

export function Linkify({ text }: { text: string }) {
  const parts = text.split(URL_RE)
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <a key={i} href={p} target="_blank" rel="noreferrer">
            {p.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}
          </a>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  )
}

export function Comments({ taskId }: { taskId: string }) {
  const all = useStore((s) => s.comments)
  const members = useStore((s) => s.members)
  const me = useStore((s) => s.me)
  const list = useMemo(
    () =>
      Object.values(all)
        .filter((c) => c.taskId === taskId)
        .sort((a, b) => a.createdAt - b.createdAt),
    [all, taskId],
  )
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const input = useRef<HTMLInputElement>(null)

  const send = async () => {
    if (!text.trim() && !files.length) return
    const c = addComment(taskId, text.trim())
    const pending = files
    setText('')
    setFiles([])
    if (pending.length) await uploadFiles(pending, 'comment', c.id)
  }

  return (
    <div className="comments">
      {list.map((c) => (
        <div key={c.id} className="comment">
          <Avatar member={c.authorId ? members[c.authorId] : null} size={24} />
          <div className="comment-body">
            <div className="comment-head">
              <span className="comment-author">{(c.authorId && members[c.authorId]?.name) || 'Учасник'}</span>
              <span className="comment-time">{timeAgo(c.createdAt)}</span>
              {c.authorId === me && (
                <button type="button" className="icon-btn comment-del" aria-label="Видалити коментар" onClick={() => deleteComment(c.id)}>
                  <X size={13} strokeWidth={1.6} />
                </button>
              )}
            </div>
            {c.text && (
              <p className="comment-text">
                <Linkify text={c.text} />
              </p>
            )}
            <InlineFiles ownerType="comment" ownerId={c.id} />
          </div>
        </div>
      ))}
      <div className="composer">
        <AutoText
          value={text}
          onChange={setText}
          placeholder="Коментар…"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
          }}
          onPaste={(e) => {
            const pasted = Array.from(e.clipboardData.files)
            if (pasted.length) {
              e.preventDefault()
              e.stopPropagation()
              setFiles((f) => [...f, ...pasted])
            }
          }}
        />
        {files.length > 0 && (
          <div className="composer-files">
            {files.map((f, i) => (
              <span key={i} className="composer-file">
                {f.name || 'зображення'}
                <button type="button" className="icon-btn" aria-label="Прибрати" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="composer-bar">
          <button type="button" className="icon-btn" aria-label="Прикріпити файл" onClick={() => input.current?.click()}>
            <Paperclip size={15} strokeWidth={1.6} />
          </button>
          <span className="hint">
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd> надіслати
          </span>
          <button type="button" className="btn btn-sm" disabled={!text.trim() && !files.length} onClick={send}>
            Надіслати
          </button>
        </div>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? [])
            setFiles((f) => [...f, ...picked])
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}

export function describeActivity(a: Activity, members: Record<string, Member>, projects: Record<string, Project>, withTitle = false) {
  const m = a.meta ?? {}
  const name = (id: unknown) => (typeof id === 'string' && members[id]?.name) || 'нікого'
  const t = withTitle && a.title ? ` «${a.title}»` : ''
  switch (a.kind) {
    case 'created':
      return `створив(-ла) завдання${t}`
    case 'completed':
      return `виконав(-ла)${t || ' завдання'}`
    case 'cancelled':
      return `скасував(-ла)${t || ' завдання'}`
    case 'reopened':
      return `повернув(-ла) в роботу${t}`
    case 'assigned':
      return m.to ? `призначив(-ла)${t} на ${name(m.to)}` : `зняв(-ла) виконавця${t}`
    case 'moved':
      return m.to ? `переніс(-ла)${t} у проєкт «${projects[m.to as string]?.name ?? '—'}»` : `прибрав(-ла)${t} з проєкту`
    case 'renamed':
      return `перейменував(-ла) «${m.from}»${withTitle ? ` на «${a.title}»` : ''}`
    case 'rescheduled': {
      const when = whenLabel({ scope: (m.scope as 'day') ?? 'none', date: (m.date as string) ?? null })
      return `змінив(-ла) термін${t}: ${when.toLowerCase()}${m.due ? `, дедлайн ${m.due}` : ''}`
    }
    case 'deleted':
      return `видалив(-ла)${t || ' завдання'}`
    case 'restored':
      return `відновив(-ла)${t}`
    case 'commented':
      return `прокоментував(-ла)${t}: ${String(m.text ?? '')}`
    case 'attached':
      return `прикріпив(-ла) файл ${String(m.name ?? '')}${t ? ` до${t}` : ''}`
    case 'project':
      return `створив(-ла) проєкт «${a.title}»`
    case 'member':
      return `додав(-ла) учасника ${String(m.name ?? '')}`
  }
}

export function History({ taskId }: { taskId: string }) {
  const activity = useStore((s) => s.activity)
  const members = useStore((s) => s.members)
  const projects = useStore((s) => s.projects)
  const list = useMemo(() => activity.filter((a) => a.taskId === taskId && a.kind !== 'commented'), [activity, taskId])
  if (!list.length) return <p className="hint">Змін поки немає</p>
  return (
    <ol className="history">
      {list.map((a) => (
        <li key={a.id}>
          <span className="history-who">{(a.actorId && members[a.actorId]?.name) || 'Хтось'}</span> {describeActivity(a, members, projects)}
          <span className="history-time">{timeAgo(a.at)}</span>
        </li>
      ))}
    </ol>
  )
}
