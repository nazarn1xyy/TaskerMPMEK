import { memo, useMemo, type ReactNode } from 'react'
import { ChevronsUpDown, Moon, Plus, Sun, LogOut } from 'lucide-react'
import { signIn, updateTask, useStore } from '../lib/store'
import { go, type Route } from '../lib/router'
import { useTaskDrop } from '../lib/dnd'
import { useLiveTasks, useMembers, useProjects } from '../lib/hooks'
import { isOverdue, monthStart, todayIso, weekStart } from '../lib/dates'
import { dayOf } from '../lib/filters'
import { Avatar, Kbd, Menu, PopButton } from './ui'

export function toggleTheme() {
  const root = document.documentElement
  const dark = root.dataset.theme !== 'dark'
  root.dataset.theme = dark ? 'dark' : 'light'
  localStorage.setItem('tasker.theme', dark ? 'dark' : 'light')
  // keep the phone status bar / browser chrome in step with the app
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => (m.content = dark ? '#121212' : '#f3f3f1'))
}

function NavItem({ active, onClick, children, count, alert, hotkey }: { active: boolean; onClick: () => void; children: ReactNode; count?: number; alert?: boolean; hotkey?: string }) {
  return (
    <button type="button" className={`nav-item${active ? ' is-active' : ''}`} onClick={onClick} title={hotkey ? `Клавіша ${hotkey}` : undefined}>
      <span className="nav-label">{children}</span>
      {count ? <span className={`nav-count${alert ? ' is-alert' : ''}`}>{count}</span> : null}
    </button>
  )
}

const DropItem = memo(function DropItem({ onDrop, children }: { onDrop: (id: string) => void; children: ReactNode }) {
  const { over, props } = useTaskDrop(onDrop)
  return (
    <div className={`drop-item${over ? ' is-over' : ''}`} {...props}>
      {children}
    </div>
  )
})

/** Who am I + theme + sign out. Used in the sidebar and in the phone top bar. */
export function UserMenu({ className, label }: { className: string; label: ReactNode }) {
  const me = useStore((s) => s.me)
  const members = useMembers()
  return (
    <PopButton className={className} label={label} title="Учасник і тема">
      {(close) => (
        <Menu
          onDone={close}
          items={[
            { key: 'h', label: 'Працювати як', header: true },
            ...members.map((m) => ({ key: m.id, label: m.name, icon: <Avatar member={m} size={18} />, checked: m.id === me, onSelect: () => signIn(m.id) })),
            { key: 'd', label: '', divider: true },
            {
              key: 'theme',
              label: document.documentElement.dataset.theme === 'dark' ? 'Світла тема' : 'Темна тема',
              icon: document.documentElement.dataset.theme === 'dark' ? <Sun size={15} strokeWidth={1.6} /> : <Moon size={15} strokeWidth={1.6} />,
              onSelect: toggleTheme,
            },
            { key: 'out', label: 'До вибору учасника', icon: <LogOut size={15} strokeWidth={1.6} />, onSelect: () => signIn(null) },
          ]}
        />
      )}
    </PopButton>
  )
}

/** Open tasks for me today, overdue included — the badge on «Сьогодні». */
export function useTodayCount() {
  const me = useStore((s) => s.me)
  const tasks = useLiveTasks()
  const today = todayIso()
  return useMemo(() => {
    let count = 0
    let overdue = 0
    for (const t of tasks) {
      if (t.status !== 'open' || t.assigneeId !== me) continue
      if (isOverdue(t, today)) overdue++
      else if (dayOf(t) === today || t.due === today) count++
    }
    return { count: count + overdue, overdue }
  }, [tasks, me, today])
}

export function Sidebar({ route, onPalette, onNew, onNavigate }: { route: Route; onPalette: () => void; onNew: () => void; onNavigate?: () => void }) {
  const me = useStore((s) => s.me)
  const meMember = useStore((s) => (s.me ? s.members[s.me] : undefined))
  const presence = useStore((s) => s.presence)
  const online = useStore((s) => s.online)
  const members = useMembers()
  const projects = useProjects()
  const tasks = useLiveTasks()
  const today = todayIso()

  const counts = useMemo(() => {
    let todayCount = 0
    let overdue = 0
    const perMember = new Map<string, number>()
    const perProject = new Map<string, number>()
    for (const t of tasks) {
      if (t.status !== 'open') continue
      if (t.assigneeId) perMember.set(t.assigneeId, (perMember.get(t.assigneeId) ?? 0) + 1)
      if (t.projectId) perProject.set(t.projectId, (perProject.get(t.projectId) ?? 0) + 1)
      if (t.assigneeId !== me) continue
      if (isOverdue(t, today)) overdue++
      else if (dayOf(t) === today || t.due === today) todayCount++
    }
    return { today: todayCount + overdue, overdue, perMember, perProject }
  }, [tasks, me, today])

  const nav = (r: Route) => {
    go(r)
    onNavigate?.()
  }
  const is = (name: Route['name'], period?: string) => route.name === name && (!period || (route.name === 'tasks' && route.period === period))
  const isToday = route.name === 'tasks' && route.period === 'day' && route.date === today

  return (
    <aside className="side">
      <UserMenu
        className="side-me"
        label={
          <>
            <Avatar member={meMember} size={26} />
            <span className="side-me-name">{meMember?.name}</span>
            <ChevronsUpDown size={14} strokeWidth={1.6} className="muted" />
          </>
        }
      />

      <nav className="side-nav" aria-label="Розділи">
        <NavItem active={isToday} onClick={() => nav({ name: 'tasks', period: 'day', date: today })} count={counts.today} alert={counts.overdue > 0} hotkey="1">
          Сьогодні
        </NavItem>
        <NavItem active={is('tasks', 'week')} onClick={() => nav({ name: 'tasks', period: 'week', date: weekStart(today) })} hotkey="2">
          Тиждень
        </NavItem>
        <NavItem active={is('tasks', 'month')} onClick={() => nav({ name: 'tasks', period: 'month', date: monthStart(today) })} hotkey="3">
          Місяць
        </NavItem>
        <NavItem active={is('tasks', 'all') || (is('tasks', 'day') && !isToday)} onClick={() => nav({ name: 'tasks', period: 'all', date: today })} hotkey="4">
          Усі завдання
        </NavItem>
        <NavItem active={is('calendar')} onClick={() => nav({ name: 'calendar', mode: 'month', date: monthStart(today) })} hotkey="5">
          Календар
        </NavItem>
        <NavItem active={is('stats')} onClick={() => nav({ name: 'stats' })} hotkey="6">
          Статистика
        </NavItem>
      </nav>

      <div className="side-group">
        <button type="button" className={`side-h${is('team') ? ' is-active' : ''}`} onClick={() => nav({ name: 'team' })}>
          Команда
        </button>
        {members.map((m) => (
          <DropItem key={m.id} onDrop={(id) => updateTask(id, { assigneeId: m.id })}>
            <button type="button" className={`nav-item nav-person${route.name === 'member' && route.id === m.id ? ' is-active' : ''}`} onClick={() => nav({ name: 'member', id: m.id })}>
              <Avatar member={m} size={20} online={presence.includes(m.id)} />
              <span className="nav-label">{m.name}</span>
              <span className="nav-count">{counts.perMember.get(m.id) || ''}</span>
            </button>
          </DropItem>
        ))}
        <button type="button" className="nav-item nav-add" onClick={() => nav({ name: 'team' })}>
          <Plus size={14} strokeWidth={1.6} />
          <span className="nav-label">Учасник</span>
        </button>
      </div>

      <div className="side-group side-projects">
        <button type="button" className={`side-h${is('projects') ? ' is-active' : ''}`} onClick={() => nav({ name: 'projects' })}>
          Проєкти
        </button>
        {projects.map((p) => (
          <DropItem key={p.id} onDrop={(id) => updateTask(id, { projectId: p.id })}>
            <button type="button" className={`nav-item${route.name === 'project' && route.id === p.id ? ' is-active' : ''}`} onClick={() => nav({ name: 'project', id: p.id })}>
              <span className="nav-label">{p.name}</span>
              <span className="nav-count">{counts.perProject.get(p.id) || ''}</span>
            </button>
          </DropItem>
        ))}
        <button type="button" className="nav-item nav-add" onClick={() => nav({ name: 'projects' })}>
          <Plus size={14} strokeWidth={1.6} />
          <span className="nav-label">Проєкт</span>
        </button>
      </div>

      <div className="side-foot">
        <button type="button" className="side-action" onClick={onNew}>
          <span>Нове завдання</span>
          <Kbd>N</Kbd>
        </button>
        <button type="button" className="side-action" onClick={onPalette}>
          <span>Пошук і команди</span>
          <Kbd>⌘K</Kbd>
        </button>
        <div className={`sync${online ? '' : ' is-off'}`} title={online ? 'Зміни одразу бачить уся команда' : 'Немає звʼязку із сервером — перепідключаємося'}>
          <i />
          {online ? `${presence.length} у мережі` : 'Немає звʼязку'}
        </div>
      </div>
    </aside>
  )
}
