import { useEffect, useMemo, useState } from 'react'
import { Archive, ArchiveRestore, MoreHorizontal, Plus } from 'lucide-react'
import { addProject, deleteProject, toast, updateProject, updateTasks, useStore } from '../lib/store'
import { go } from '../lib/router'
import { applyFilters, buildSections, emptyFilters, type Filters, type GroupBy } from '../lib/filters'
import { useLiveTasks, useMembers, usePersisted, usePersistedValue, useProjects } from '../lib/hooks'
import { isOverdue, plural, timeAgo, todayIso, isActive } from '../lib/dates'
import { TaskSections } from '../components/TaskList'
import { FilterBar, WhoTabs } from '../components/FilterBar'
import { Files } from '../components/Files'
import { AutoText, Menu, PopButton, Segmented } from '../components/ui'
import { Board } from '../components/Board'
import { Linkify } from '../components/Comments'
import type { Project, ProjectHealth, ProjectSection } from '../lib/types'
import { ask } from '../components/Dialog'

export function ProjectsView() {
  const projects = useProjects()
  const allProjects = useStore((s) => s.projects)
  const archived = useMemo(() => Object.values(allProjects).filter((p) => p.archived).sort((a, b) => b.updatedAt - a.updatedAt), [allProjects])
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
      if (isActive(t)) s.open++
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
        {projects.map((p) => (
          <ProjectRow key={p.id} p={p} s={stats.get(p.id)} owner={(p.ownerId && members[p.ownerId]?.name) || '—'} />
        ))}
        <div className="plist-new">
          <Plus size={16} strokeWidth={1.6} />
          <input value={name} placeholder="Новий проєкт — назва й Enter" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
        </div>
      </div>

      {archived.length > 0 && (
        <details className="plist-archive">
          <summary>
            Архів · {archived.length}
          </summary>
          <div className="plist">
            {archived.map((p) => (
              <ProjectRow key={p.id} p={p} s={stats.get(p.id)} owner={(p.ownerId && members[p.ownerId]?.name) || '—'} />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

type ProjectStats = { open: number; done: number; total: number; overdue: number; last: number }

function ProjectRow({ p, s: stats, owner }: { p: Project; s?: ProjectStats; owner: string }) {
  const s = stats ?? { open: 0, done: 0, total: 0, overdue: 0, last: p.updatedAt }
  const share = s.total ? s.done / s.total : 0
  return (
    <button type="button" className="plist-row" onClick={() => go({ name: 'project', id: p.id })}>
      <span className="plist-name">
        {p.name}
        {p.health && <HealthMark health={p.health} />}
      </span>
      <span className="plist-owner">{owner}</span>
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
}

export const HEALTH: Record<ProjectHealth, { label: string; tone: string }> = {
  on: { label: 'За планом', tone: 'on' },
  risk: { label: 'Під загрозою', tone: 'risk' },
  late: { label: 'Відстає', tone: 'late' },
}

export function HealthMark({ health }: { health?: ProjectHealth | null }) {
  if (!health) return null
  return (
    <span className={`health is-${HEALTH[health].tone}`}>
      <i />
      {HEALTH[health].label}
    </span>
  )
}

type ProjectTab = 'list' | 'board' | 'notes'

export function ProjectView({ id }: { id: string }) {
  const project = useStore((s) => s.projects[id])
  const members = useStore((s) => s.members)
  const me = useStore((s) => s.me)
  const tasks = useLiveTasks()
  const active = useMembers()
  const projects = useProjects()
  const [tab, setTab] = usePersistedValue<ProjectTab>('project.tab', 'list')
  const [who, setWho] = usePersistedValue<string>('pwho', 'all')
  const [filters, setFilters] = usePersisted<Filters>('filters.project', emptyFilters())
  const sectionsList = project?.sections ?? []
  const [groupPref, setGroupBy] = usePersistedValue<GroupBy | 'auto'>('group.project2', 'auto')
  const groupBy: GroupBy = groupPref === 'auto' ? (sectionsList.length ? 'section' : 'date') : groupPref === 'section' && !sectionsList.length ? 'date' : groupPref
  const [name, setName] = useState(project?.name ?? '')
  const [desc, setDesc] = useState(project?.description ?? '')
  const [notes, setNotes] = useState(project?.notes ?? '')
  const [healthNote, setHealthNote] = useState(project?.healthNote ?? '')
  const today = todayIso()

  useEffect(() => {
    setName(project?.name ?? '')
    setDesc(project?.description ?? '')
  }, [project?.name, project?.description])
  useEffect(() => setNotes(project?.notes ?? ''), [project?.notes])
  useEffect(() => setHealthNote(project?.healthNote ?? ''), [project?.healthNote])

  const own = useMemo(() => tasks.filter((t) => t.projectId === id), [tasks, id])
  const whoId = who === 'me' ? me : who === 'all' ? null : who
  const visible = useMemo(() => applyFilters(own, filters, whoId), [own, filters, whoId])
  const sections = useMemo(
    () =>
      buildSections(visible, groupBy, { period: 'all', date: today, members: active, projects, today, sections: sectionsList }).map((s) =>
        s.create ? { ...s, create: { assigneeId: whoId ?? me, ...s.create, projectId: id } } : s,
      ),
    [visible, groupBy, active, projects, today, me, id, whoId, sectionsList],
  )

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
  const open = own.filter((t) => isActive(t)).length
  const inProgress = own.filter((t) => t.status === 'progress').length
  const hasAny = sections.some((s) => s.tasks.length)

  const addSection = (title: string) => updateProject(id, { sections: [...sectionsList, { id: crypto.randomUUID().slice(0, 8), name: title.trim() }] })
  const renameSection = (sid: string, title: string) => updateProject(id, { sections: sectionsList.map((x) => (x.id === sid ? { ...x, name: title } : x)) })
  const removeSection = async (sid: string) => {
    const sec = sectionsList.find((x) => x.id === sid)
    const inside = own.filter((t) => t.sectionId === sid)
    if (!(await ask({ title: `Видалити розділ «${sec?.name}»?`, text: inside.length ? `${inside.length} ${plural(inside.length, ['завдання', 'завдання', 'завдань'])} залишаться в проєкті без розділу.` : undefined }))) return
    updateProject(id, { sections: sectionsList.filter((x) => x.id !== sid) })
    if (inside.length) updateTasks(inside.map((t) => ({ id: t.id, patch: { sectionId: null } })))
  }

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
                  { key: 'h-owner', label: 'Хто веде', header: true },
                  ...active.map((m) => ({ key: m.id, label: m.name, checked: project.ownerId === m.id, onSelect: () => updateProject(id, { ownerId: m.id }) })),
                  { key: 'div', label: '', divider: true },
                  project.archived
                    ? { key: 'unarch', label: 'Повернути з архіву', icon: <ArchiveRestore size={15} strokeWidth={1.6} />, onSelect: () => updateProject(id, { archived: false }) }
                    : {
                        key: 'arch',
                        label: 'В архів',
                        icon: <Archive size={15} strokeWidth={1.6} />,
                        onSelect: () => {
                          updateProject(id, { archived: true })
                          toast(`«${project.name}» в архіві`, { label: 'Повернути', run: () => updateProject(id, { archived: false }) })
                        },
                      },
                  {
                    key: 'del',
                    label: 'Видалити проєкт',
                    danger: true,
                    onSelect: async () => {
                      if (await ask({ title: `Видалити проєкт «${project.name}»?`, text: 'Краще відправити в архів — історія й статистика збережуться. Якщо видалити, завдання стануть завданнями без проєкту.' })) {
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
        {project.archived && (
          <p className="archived-note">
            Проєкт в архіві — його немає в списках, але все збережено.{' '}
            <button type="button" className="link-btn" onClick={() => updateProject(id, { archived: false })}>
              Повернути
            </button>
          </p>
        )}
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
          {inProgress > 0 && <span>{inProgress} в роботі</span>}
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

        <div className="project-health">
          <PopButton className="health-btn" label={project.health ? <HealthMark health={project.health} /> : <span className="muted">Статус проєкту</span>} title="Як іде проєкт">
            {(close) => (
              <Menu
                onDone={close}
                items={[
                  ...(Object.keys(HEALTH) as ProjectHealth[]).map((h) => ({ key: h, label: <HealthMark health={h} />, checked: project.health === h, onSelect: () => updateProject(id, { health: h }) })),
                  { key: 'none', label: 'Без статусу', checked: !project.health, onSelect: () => updateProject(id, { health: null, healthNote: '' }) },
                ]}
              />
            )}
          </PopButton>
          {project.health && (
            <input
              className="health-note"
              value={healthNote}
              placeholder={project.health === 'on' ? 'Коротко: що зроблено' : 'Що заважає і що робимо'}
              onChange={(e) => setHealthNote(e.target.value)}
              onBlur={() => healthNote !== (project.healthNote ?? '') && updateProject(id, { healthNote })}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLElement).blur()}
            />
          )}
        </div>
        <AutoText className="project-desc" value={desc} placeholder="Мета проєкту одним-двома реченнями…" onChange={setDesc} onBlur={() => desc !== project.description && updateProject(id, { description: desc })} />
      </header>

      <div className="toolbar">
        <Segmented<ProjectTab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'list', label: 'Список' },
            { value: 'board', label: 'Дошка' },
            { value: 'notes', label: 'Нотатки' },
          ]}
        />
        {tab !== 'notes' && <WhoTabs value={who} onChange={setWho} />}
      </div>

      {tab === 'notes' ? (
        <div className="project-notes">
          <AutoText
            className="notes-text"
            value={notes}
            placeholder={'Домовленості, контакти, посилання, рішення.\nУсе, що команда має знати про проєкт.'}
            onChange={setNotes}
            onBlur={() => notes !== (project.notes ?? '') && updateProject(id, { notes })}
          />
          {notes && project.notes === notes && /https?:\/\//.test(notes) && (
            <p className="notes-links">
              <Linkify text={notes.split('\n').filter((l) => /https?:\/\//.test(l)).join('  ·  ')} />
            </p>
          )}
          <h4 className="drawer-h">Файли проєкту</h4>
          <Files ownerType="project" ownerId={id} label="Файли проєкту" />
        </div>
      ) : (
        <>
          <FilterBar
            filters={filters}
            onFilters={setFilters}
            groupBy={tab === 'list' ? groupBy : undefined}
            onGroupBy={tab === 'list' ? setGroupBy : undefined}
            groupOptions={['section', 'date', 'person', 'status', 'none']}
          />
          <SectionsEditor sections={sectionsList} onAdd={addSection} onRename={renameSection} onRemove={removeSection} />
          {tab === 'board' ? (
            <Board tasks={visible} defaults={{ assigneeId: whoId ?? me, projectId: id }} sections={sectionsList} />
          ) : (
            <TaskSections
              sections={hasAny || groupBy === 'section' ? sections : [{ key: 'empty', label: 'Завдання', tasks: [], create: { assigneeId: whoId ?? me, projectId: id }, keep: true }]}
              options={{ showAssignee: whoId === null, showProject: false }}
            />
          )}
        </>
      )}
    </div>
  )
}

/** A line of section names under the toolbar: tap to rename / delete, «+ Розділ» to add. */
function SectionsEditor({ sections, onAdd, onRename, onRemove }: { sections: ProjectSection[]; onAdd: (n: string) => void; onRename: (id: string, n: string) => void; onRemove: (id: string) => void }) {
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  return (
    <div className="sections-editor">
      <span className="section-label">Розділи</span>
      {sections.map((x) => (
        <PopButton key={x.id} className="quick-chip" label={x.name}>
          {(close) => <SectionMenu section={x} onRename={(n) => (onRename(x.id, n), close())} onRemove={() => (close(), onRemove(x.id))} />}
        </PopButton>
      ))}
      {adding ? (
        <input
          className="section-input"
          autoFocus
          value={text}
          placeholder="Назва розділу"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim()) {
              onAdd(text)
              setText('')
            }
            if (e.key === 'Escape') setAdding(false)
          }}
          onBlur={() => {
            if (text.trim()) onAdd(text)
            setText('')
            setAdding(false)
          }}
        />
      ) : (
        <button type="button" className="quick-chip is-add" onClick={() => setAdding(true)}>
          <Plus size={14} strokeWidth={1.6} /> Розділ
        </button>
      )}
    </div>
  )
}

function SectionMenu({ section, onRename, onRemove }: { section: ProjectSection; onRename: (n: string) => void; onRemove: () => void }) {
  const [name, setName] = useState(section.name)
  return (
    <div className="section-menu">
      <div className="menu-input">
        <input value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && onRename(name.trim())} />
      </div>
      <Menu
        items={[
          { key: 'save', label: 'Зберегти назву', onSelect: () => name.trim() && onRename(name.trim()) },
          { key: 'del', label: 'Видалити розділ', danger: true, onSelect: onRemove },
        ]}
      />
    </div>
  )
}
