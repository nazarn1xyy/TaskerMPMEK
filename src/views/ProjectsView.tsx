import { useEffect, useMemo, useState } from 'react'
import { MoreHorizontal, Plus } from 'lucide-react'
import { addProject, deleteProject, updateProject, useStore } from '../lib/store'
import { go } from '../lib/router'
import { applyFilters, buildSections, emptyFilters, type Filters, type GroupBy } from '../lib/filters'
import { useLiveTasks, useMembers, usePersisted, usePersistedValue, useProjects } from '../lib/hooks'
import { isOverdue, plural, timeAgo, todayIso } from '../lib/dates'
import { TaskSections } from '../components/TaskList'
import { FilterBar, WhoTabs } from '../components/FilterBar'
import { Files } from '../components/Files'
import { AutoText, Menu, PopButton } from '../components/ui'
import { ask } from '../components/Dialog'

export function ProjectsView() {
  const projects = useProjects()
  const tasks = useLiveTasks()
  const members = useStore((s) => s.members)
  const [name, setName] = useState('')
  const today = todayIso()

  const stats = useMemo(() => {
    const map = new Map<string, { open: number; done: number; total: number; overdue: number; last: number }>()
    for (const t of tasks) {
      if (!t.projectId) continue
      const s = map.get(t.projectId) ?? { open: 0, done: 0, total: 0, overdue: 0, last: 0 }
      if (t.status !== 'cancelled') s.total++
      if (t.status === 'open') s.open++
      if (t.status === 'done') s.done++
      if (isOverdue(t, today)) s.overdue++
      s.last = Math.max(s.last, t.updatedAt)
      map.set(t.projectId, s)
    }
    return map
  }, [tasks, today])

  const create = () => {
    if (!name.trim()) return
    const p = addProject(name)
    setName('')
    go({ name: 'project', id: p.id })
  }

  return (
    <div className="page">
      <header className="page-head">
        <div className="eyebrow">
          <span>Проєкти</span>
        </div>
        <h1 className="display">Проєкти</h1>
        <p className="head-sub">
          <span>
            {projects.length} {plural(projects.length, ['проєкт', 'проєкти', 'проєктів'])}
          </span>
          <span>завдання можна вести й без проєкту</span>
        </p>
      </header>

      <div className="plist">
        {projects.map((p) => {
          const s = stats.get(p.id) ?? { open: 0, done: 0, total: 0, overdue: 0, last: p.updatedAt }
          const share = s.total ? s.done / s.total : 0
          return (
            <button key={p.id} type="button" className="plist-row" onClick={() => go({ name: 'project', id: p.id })}>
              <span className="plist-name">{p.name}</span>
              <span className="plist-owner">{(p.ownerId && members[p.ownerId]?.name) || '—'}</span>
              <span className="plist-nums">
                {s.open} відкрито{s.overdue > 0 && <em> · {s.overdue} прострочено</em>}
              </span>
              <span className="plist-progress">
                <span className="bar">
                  <i style={{ width: `${share * 100}%` }} />
                </span>
                <span className="plist-share">
                  {s.done}/{s.total}
                </span>
              </span>
              <span className="plist-time">{timeAgo(Math.max(s.last, p.updatedAt))}</span>
            </button>
          )
        })}
        <div className="plist-new">
          <Plus size={16} strokeWidth={1.6} />
          <input value={name} placeholder="Новий проєкт — назва й Enter" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
        </div>
      </div>
    </div>
  )
}

export function ProjectView({ id }: { id: string }) {
  const project = useStore((s) => s.projects[id])
  const members = useStore((s) => s.members)
  const me = useStore((s) => s.me)
  const tasks = useLiveTasks()
  const active = useMembers()
  const projects = useProjects()
  const [who, setWho] = usePersistedValue<string>('pwho', 'all')
  const [filters, setFilters] = usePersisted<Filters>('filters.project', emptyFilters())
  const [groupBy, setGroupBy] = usePersistedValue<GroupBy>('group.project', 'date')
  const [name, setName] = useState(project?.name ?? '')
  const [desc, setDesc] = useState(project?.description ?? '')
  const today = todayIso()

  useEffect(() => {
    setName(project?.name ?? '')
    setDesc(project?.description ?? '')
  }, [project?.name, project?.description])

  const own = useMemo(() => tasks.filter((t) => t.projectId === id), [tasks, id])
  const whoId = who === 'me' ? me : who === 'all' ? null : who
  const sections = useMemo(() => {
    const visible = applyFilters(own, filters, whoId)
    return buildSections(visible, groupBy === 'project' ? 'date' : groupBy, { period: 'all', date: today, members: active, projects, today }).map((s) =>
      s.create ? { ...s, create: { assigneeId: whoId ?? me, ...s.create, projectId: id } } : s,
    )
  }, [own, filters, whoId, groupBy, active, projects, today, me, id])

  if (!project) {
    return (
      <div className="page">
        <h1 className="display">Немає проєкту</h1>
        <p className="head-sub">Його видалили або посилання неправильне.</p>
      </div>
    )
  }

  const done = own.filter((t) => t.status === 'done').length
  const total = own.filter((t) => t.status !== 'cancelled').length
  const open = own.filter((t) => t.status === 'open').length
  const hasAny = sections.some((s) => s.tasks.length)

  return (
    <div className="page">
      <header className="page-head">
        <div className="eyebrow">
          <button type="button" className="link-btn" onClick={() => go({ name: 'projects' })}>
            Проєкти
          </button>
          <span>/ веде {(project.ownerId && members[project.ownerId]?.name) || '—'}</span>
          <PopButton className="icon-btn" label={<MoreHorizontal size={18} strokeWidth={1.6} />} placement="bottom-end" title="Дії">
            {(close) => (
              <Menu
                onDone={close}
                items={[
                  ...active.map((m) => ({ key: m.id, label: `Веде: ${m.name}`, checked: project.ownerId === m.id, onSelect: () => updateProject(id, { ownerId: m.id }) })),
                  { key: 'div', label: '', divider: true },
                  {
                    key: 'del',
                    label: 'Видалити проєкт',
                    danger: true,
                    onSelect: async () => {
                      if (await ask({ title: `Видалити проєкт «${project.name}»?`, text: 'Завдання проєкту залишаться — вони стануть завданнями без проєкту.' })) {
                        deleteProject(id)
                        go({ name: 'projects' })
                      }
                    },
                  },
                ]}
              />
            )}
          </PopButton>
        </div>
        <AutoText
          className="display display-input"
          value={name}
          onChange={(v) => setName(v.replace(/\n/g, ''))}
          onBlur={() => (name.trim() && name !== project.name ? updateProject(id, { name: name.trim() }) : setName(project.name))}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), (e.target as HTMLElement).blur())}
          aria-label="Назва проєкту"
        />
        <p className="head-sub">
          <span>
            {open} {plural(open, ['відкрите', 'відкриті', 'відкритих'])}
          </span>
          <span>
            {done} з {total} виконано
          </span>
          {total > 0 && (
            <span className="head-bar">
              <span className="bar">
                <i style={{ width: `${(done / total) * 100}%` }} />
              </span>
            </span>
          )}
        </p>
        <AutoText className="project-desc" value={desc} placeholder="Мета проєкту, посилання, домовленості…" onChange={setDesc} onBlur={() => desc !== project.description && updateProject(id, { description: desc })} />
      </header>

      <details className="project-files">
        <summary>Файли проєкту</summary>
        <Files ownerType="project" ownerId={id} label="Файли проєкту" />
      </details>

      <div className="toolbar">
        <WhoTabs value={who} onChange={setWho} />
      </div>
      <FilterBar filters={filters} onFilters={setFilters} groupBy={groupBy} onGroupBy={setGroupBy} groupOptions={['date', 'person', 'status', 'none']} />
      <TaskSections
        sections={hasAny ? sections : [{ key: 'empty', label: 'Завдання', tasks: [], create: { assigneeId: whoId ?? me, projectId: id }, keep: true }]}
        options={{ showAssignee: whoId === null, showProject: false }}
      />
    </div>
  )
}
