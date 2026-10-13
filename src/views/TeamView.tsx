import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { addMembers, signIn, updateMember, uploadFiles, useStore } from '../lib/store'
import { go } from '../lib/router'
import { applyFilters, buildSections, emptyFilters, type Filters, type GroupBy } from '../lib/filters'
import { useLiveTasks, useMembers, usePersisted, usePersistedValue, useProjects } from '../lib/hooks'
import { addDays, isOverdue, plural, todayIso, weekStart } from '../lib/dates'
import { TaskSections } from '../components/TaskList'
import { FilterBar } from '../components/FilterBar'
import { ask } from '../components/Dialog'
import { AutoText, Avatar, Segmented } from '../components/ui'
import type { Task } from '../lib/types'

export function memberStats(tasks: Task[], id: string, today = todayIso()) {
  const ws = weekStart(today)
  let open = 0
  let overdue = 0
  let doneWeek = 0
  let created = 0
  for (const t of tasks) {
    if (t.assigneeId === id && t.status === 'open') open++
    if (t.assigneeId === id && isOverdue(t, today)) overdue++
    if (t.completedBy === id && t.status === 'done' && t.completedAt && new Date(t.completedAt) >= new Date(`${ws}T00:00`)) doneWeek++
    if (t.createdBy === id) created++
  }
  return { open, overdue, doneWeek, created }
}

export function TeamView() {
  const members = useMembers()
  const tasks = useLiveTasks()
  const presence = useStore((s) => s.presence)
  const me = useStore((s) => s.me)
  const [name, setName] = useState('')

  return (
    <div className="page">
      <header className="page-head">
        <div className="eyebrow">
          <span>Команда</span>
        </div>
        <h1 className="display">Команда</h1>
        <p className="head-sub">
          <span>
            {members.length} {plural(members.length, ['людина', 'людини', 'людей'])}
          </span>
          <span>{presence.length} у мережі</span>
        </p>
      </header>
      <div className="team">
        <div className="team-head">
          <span />
          <span>Відкрито</span>
          <span>Прострочено</span>
          <span>Виконано за тиждень</span>
          <span>Поставив(-ла)</span>
        </div>
        {members.map((m) => {
          const s = memberStats(tasks, m.id)
          return (
            <button key={m.id} type="button" className="team-row" onClick={() => go({ name: 'member', id: m.id })}>
              <span className="team-name">
                <Avatar member={m} size={32} online={presence.includes(m.id)} />
                {m.name}
                {m.id === me && <span className="muted"> — ви</span>}
              </span>
              <span className="num">{s.open}</span>
              <span className={`num${s.overdue ? ' is-alert' : ''}`}>{s.overdue}</span>
              <span className="num">{s.doneWeek}</span>
              <span className="num">{s.created}</span>
            </button>
          )
        })}
        <div className="plist-new">
          <Plus size={16} strokeWidth={1.6} />
          <input
            value={name}
            placeholder="Додати учасника — імʼя й Enter"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) {
                addMembers([name])
                setName('')
              }
            }}
          />
        </div>
      </div>
    </div>
  )
}

type Tab = 'assigned' | 'created' | 'done'

export function MemberView({ id }: { id: string }) {
  const member = useStore((s) => s.members[id])
  const me = useStore((s) => s.me)
  const online = useStore((s) => s.presence.includes(id))
  const tasks = useLiveTasks()
  const members = useMembers()
  const projects = useProjects()
  const [tab, setTab] = usePersistedValue<Tab>('member.tab', 'assigned')
  const [filters, setFilters] = usePersisted<Filters>('filters.member', emptyFilters())
  const [groupBy, setGroupBy] = usePersistedValue<GroupBy>('group.member', 'date')
  const [name, setName] = useState(member?.name ?? '')
  const photo = useRef<HTMLInputElement>(null)
  const today = todayIso()

  useEffect(() => setName(member?.name ?? ''), [member?.name])

  const sections = useMemo(() => {
    let list: Task[]
    if (tab === 'assigned') list = tasks.filter((t) => t.assigneeId === id && t.status === 'open')
    else if (tab === 'created') list = tasks.filter((t) => t.createdBy === id)
    else list = tasks.filter((t) => t.completedBy === id && t.status === 'done' && (t.completedAt ?? 0) > Date.now() - 30 * 86400000)
    const visible = applyFilters(list, filters, null)
    const g: GroupBy = tab === 'done' && groupBy === 'date' ? 'none' : groupBy
    return buildSections(visible, g, { period: 'all', date: today, members, projects, today }).map((s) => (s.create ? { ...s, create: { assigneeId: id, ...s.create } } : s))
  }, [tab, tasks, id, filters, groupBy, members, projects, today])

  if (!member) return <div className="page"><h1 className="display">Немає учасника</h1></div>
  const s = memberStats(tasks, id, today)
  const lastWeek = tasks.filter((t) => t.completedBy === id && t.status === 'done' && (t.completedAt ?? 0) >= new Date(`${addDays(weekStart(today), -7)}T00:00`).getTime() && (t.completedAt ?? 0) < new Date(`${weekStart(today)}T00:00`).getTime()).length

  return (
    <div className="page">
      <header className="page-head">
        <div className="eyebrow">
          <button type="button" className="link-btn" onClick={() => go({ name: 'team' })}>
            Команда
          </button>
          <span>/ {online ? 'у мережі' : 'не в мережі'}</span>
        </div>
        <div className="member-title">
          <button type="button" className="member-photo" onClick={() => photo.current?.click()} title="Завантажити фото">
            <Avatar member={member} size={64} />
          </button>
          <AutoText
            className="display display-input"
            value={name}
            onChange={(v) => setName(v.replace(/\n/g, ''))}
            onBlur={() => (name.trim() && name !== member.name ? updateMember(id, { name: name.trim() }) : setName(member.name))}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), (e.target as HTMLElement).blur())}
            aria-label="Імʼя"
          />
        </div>
        <input
          ref={photo}
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            const [att] = await uploadFiles([f], 'member', id)
            if (att) updateMember(id, { avatarId: att.id })
          }}
        />
        <p className="head-sub">
          <span>{s.open} відкрито</span>
          {s.overdue > 0 && <span className="is-alert">{s.overdue} прострочено</span>}
          <span>
            {s.doneWeek} виконано цього тижня{lastWeek ? `, ${lastWeek} минулого` : ''}
          </span>
          <span>поставив(-ла) {s.created}</span>
        </p>
      </header>

      <div className="toolbar">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'assigned', label: 'У роботі' },
            { value: 'created', label: 'Поставив(-ла)' },
            { value: 'done', label: 'Виконано за 30 днів' },
          ]}
        />
        {id !== me && (
          <button
            type="button"
            className="link-btn"
            onClick={() => signIn(id)}
            title="Працювати від імені цього учасника на цьому пристрої"
          >
            Увійти як {member.name}
          </button>
        )}
        {id !== me && (
          <button
            type="button"
            className="link-btn is-danger"
            onClick={async () => {
              if (await ask({ title: `Прибрати ${member.name} з команди?`, text: 'Завдання та історія залишаться. Учасник зникне зі списків і з екрана входу.', ok: 'Прибрати' })) {
                updateMember(id, { archived: true })
                go({ name: 'team' })
              }
            }}
          >
            Прибрати з команди
          </button>
        )}
      </div>
      <FilterBar filters={filters} onFilters={setFilters} groupBy={groupBy} onGroupBy={setGroupBy} />
      <TaskSections sections={sections.length ? sections : [{ key: 'empty', label: 'Завдання', tasks: [], create: { assigneeId: id }, keep: true }]} options={{ showAssignee: tab === 'created' }} />
    </div>
  )
}
