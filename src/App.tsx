import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, CalendarRange, Menu as MenuIcon, Plus, Search, Sun, X } from 'lucide-react'
import { boot, dismissToast, undoLast, useStore } from './lib/store'
import { go, openTask, useLocation, type Route } from './lib/router'
import { useHotkeys, isTyping } from './lib/hooks'
import { monthStart, todayIso, weekStart } from './lib/dates'
import type { Task } from './lib/types'
import { Sidebar, UserMenu, useTodayCount } from './components/Sidebar'
import { TaskDrawer } from './components/TaskDrawer'
import { Palette } from './components/Palette'
import { DialogHost } from './components/Dialog'
import { Avatar, Kbd } from './components/ui'
import { TasksView } from './views/TasksView'
import { Onboarding, Picker } from './views/Welcome'

import { CalendarView } from './views/CalendarView'
import { StatsView } from './views/StatsView'
import { ProjectsView, ProjectView } from './views/ProjectsView'
import { MemberView, TeamView } from './views/TeamView'

export function App() {
  const ready = useStore((s) => s.ready)
  const error = useStore((s) => s.error)
  const me = useStore((s) => s.me)
  const hasMembers = useStore((s) => Object.values(s.members).some((m) => !m.archived))

  useEffect(() => {
    boot()
  }, [])

  if (!ready) return <div className="boot" aria-busy />
  if (error)
    return (
      <div className="welcome">
        <div className="welcome-inner">
          <div className="eyebrow">
            <span>Немає звʼязку із сервером</span>
          </div>
          <h1 className="display">Сервер не відповідає</h1>
          <p className="welcome-lead">Перевірте, що запущено `npm run dev` або `npm start`. Помилка: {error}</p>
          <button type="button" className="btn" onClick={() => location.reload()}>
            Повторити
          </button>
        </div>
      </div>
    )
  if (!hasMembers) return <Onboarding />
  if (!me) return <Picker />
  return <Shell />
}

function contextDefaults(route: Route, me: string | null): Partial<Task> {
  const today = todayIso()
  switch (route.name) {
    case 'tasks':
      if (route.period === 'day') return { scope: 'day', date: route.date }
      if (route.period === 'week') return route.date === weekStart(today) ? { scope: 'day', date: today } : { scope: 'week', date: route.date }
      if (route.period === 'month') return route.date === monthStart(today) ? { scope: 'day', date: today } : { scope: 'month', date: route.date }
      return {}
    case 'project':
      return { projectId: route.id, assigneeId: me }
    case 'member':
      return { assigneeId: route.id }
    default:
      return { scope: 'day', date: today }
  }
}

function Shell() {
  const { route, task } = useLocation()
  const me = useStore((s) => s.me)
  const [palette, setPalette] = useState<null | 'search' | 'create'>(null)
  const [help, setHelp] = useState(false)
  const [nav, setNav] = useState(false)
  const today = todayIso()

  const meMember = useStore((s) => (s.me ? s.members[s.me] : undefined))
  const defaults = useMemo(() => ({ assigneeId: me, ...contextDefaults(route, me) }), [route, me])

  // a new section starts at the top, like any other app
  const { path } = useLocation()
  useEffect(() => {
    document.getElementById('main')?.scrollTo({ top: 0 })
    setNav(false)
  }, [path])

  // iOS-style large title: the bar shows the section name only once the big headline scrolls away
  const [titleVisible, setTitleVisible] = useState(false)
  useEffect(() => {
    setTitleVisible(false)
    const main = document.getElementById('main')
    const head = main?.querySelector('.page-head .display, .page-head .hero')
    if (!main || !head) return setTitleVisible(true)
    const io = new IntersectionObserver(([e]) => setTitleVisible(!e.isIntersecting), { root: main, threshold: 0 })
    io.observe(head)
    return () => io.disconnect()
  }, [path])

  // close the slide-out menu with the system back gesture / Escape
  useEffect(() => {
    if (!nav) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setNav(false)
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [nav])

  useHotkeys({
    'mod+k': (e) => (e.preventDefault(), setPalette((p) => (p ? null : 'search'))),
    'mod+л': (e) => (e.preventDefault(), setPalette((p) => (p ? null : 'search'))),
    n: (e) => (e.preventDefault(), setPalette('create')),
    'т': (e) => (e.preventDefault(), setPalette('create')),
    '1': () => go({ name: 'tasks', period: 'day', date: today }),
    '2': () => go({ name: 'tasks', period: 'week', date: weekStart(today) }),
    '3': () => go({ name: 'tasks', period: 'month', date: monthStart(today) }),
    '4': () => go({ name: 'tasks', period: 'all', date: today }),
    '5': () => go({ name: 'calendar', mode: 'month', date: monthStart(today) }),
    '6': () => go({ name: 'stats' }),
    '?': () => setHelp((v) => !v),
    'mod+z': (e) => {
      if (isTyping(e.target)) return
      if (undoLast()) e.preventDefault()
    },
    'mod+я': (e) => {
      if (isTyping(e.target)) return
      if (undoLast()) e.preventDefault()
    },
  })

  useEffect(() => {
    const open = (e: Event) => openTask((e as CustomEvent<string>).detail)
    window.addEventListener('tasker:open', open)
    return () => window.removeEventListener('tasker:open', open)
  }, [])


  return (
    <div className={`app${task ? ' has-drawer' : ''}${nav ? ' nav-open' : ''}`}>
      <header className="topbar">
        <UserMenu className="topbar-me" label={<Avatar member={meMember} size={30} />} />
        <span className={`topbar-title${titleVisible ? ' is-visible' : ''}`}>{sectionTitle(route, today)}</span>
        <button type="button" className="icon-btn topbar-btn" aria-label="Пошук" onClick={() => setPalette('search')}>
          <Search size={20} strokeWidth={1.6} />
        </button>
      </header>
      <div className="side-shade" onClick={() => setNav(false)} />
      <Sidebar route={route} onPalette={() => setPalette('search')} onNew={() => setPalette('create')} onNavigate={() => setNav(false)} />
      <main className="main" id="main">
        <View route={route} />
      </main>
      <TabBar route={route} today={today} onNew={() => setPalette('create')} onMore={() => setNav(true)} moreActive={nav} />
      {task && <TaskDrawer id={task} />}
      {palette && <Palette mode={palette} defaults={defaults} onClose={() => setPalette(null)} />}
      {help && <Shortcuts onClose={() => setHelp(false)} />}
      <Toasts />
      <DialogHost />
    </div>
  )
}

function View({ route }: { route: Route }) {
  switch (route.name) {
    case 'tasks':
      return <TasksView key={`${route.period}`} period={route.period} date={route.date} />
    case 'calendar':
      return <CalendarView mode={route.mode} date={route.date} />
    case 'projects':
      return <ProjectsView />
    case 'project':
      return <ProjectView key={route.id} id={route.id} />
    case 'team':
      return <TeamView />
    case 'member':
      return <MemberView key={route.id} id={route.id} />
    case 'stats':
      return <StatsView />
  }
}

function Toasts() {
  const toasts = useStore((s) => s.toasts)
  return createPortal(
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.tone === 'error' ? ' is-error' : ''}`}>
          <span>{t.text}</span>
          {t.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                t.action!.run()
                dismissToast(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" className="toast-close" aria-label="Сховати" onClick={() => dismissToast(t.id)}>
            <X size={13} strokeWidth={1.8} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  )
}

const SHORTCUTS: [string[], string][] = [
  [['N'], 'нове завдання'],
  [['⌘', 'K'], 'пошук і команди'],
  [['/'], 'пошук у списку'],
  [['1'], 'сьогодні'],
  [['2'], 'тиждень'],
  [['3'], 'місяць'],
  [['4'], 'усі завдання'],
  [['5'], 'календар'],
  [['6'], 'статистика'],
  [['←', '→'], 'гортати дні, тижні, місяці'],
  [['T'], 'повернутися до сьогодні'],
  [['↑', '↓'], 'по завданнях у списку'],
  [['↵'], 'відкрити завдання'],
  [['X'], 'виконано / не виконано'],
  [['⌫'], 'видалити завдання'],
  [['⌘', 'Z'], 'скасувати останню дію'],
  [['⌘', 'V'], 'вставити скриншот у відкрите завдання'],
  [['esc'], 'закрити'],
]

function Shortcuts({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  return createPortal(
    <div className="dialog-wrap" onMouseDown={onClose}>
      <div className="dialog dialog-wide" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="dialog-title">Клавіші</h2>
        <dl className="shortcuts">
          {SHORTCUTS.map(([keys, label]) => (
            <div key={label}>
              <dt>
                {keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>,
    document.body,
  )
}

function sectionTitle(route: Route, today: string) {
  switch (route.name) {
    case 'tasks':
      if (route.period === 'day') return route.date === today ? 'Сьогодні' : 'День'
      return route.period === 'week' ? 'Тиждень' : route.period === 'month' ? 'Місяць' : 'Усі завдання'
    case 'calendar':
      return 'Календар'
    case 'projects':
    case 'project':
      return 'Проєкти'
    case 'team':
    case 'member':
      return 'Команда'
    case 'stats':
      return 'Статистика'
  }
}

/** Phone navigation: the four places people go most, plus a big «+» in thumb reach. */
function TabBar({ route, today, onNew, onMore, moreActive }: { route: Route; today: string; onNew: () => void; onMore: () => void; moreActive: boolean }) {
  const { count, overdue } = useTodayCount()
  const isToday = route.name === 'tasks' && route.period === 'day' && route.date === today
  const isWeek = route.name === 'tasks' && route.period === 'week'
  const isCal = route.name === 'calendar'
  const isMore = moreActive || (!isToday && !isWeek && !isCal)
  return (
    <nav className="tabbar" aria-label="Розділи">
      <button type="button" className="tab" aria-current={isToday ? 'page' : undefined} onClick={() => go({ name: 'tasks', period: 'day', date: today })}>
        <span className="tab-icon">
          <Sun size={21} strokeWidth={1.6} />
          {count > 0 && <i className={`tab-badge${overdue ? ' is-alert' : ''}`}>{count}</i>}
        </span>
        Сьогодні
      </button>
      <button type="button" className="tab" aria-current={isWeek ? 'page' : undefined} onClick={() => go({ name: 'tasks', period: 'week', date: weekStart(today) })}>
        <CalendarRange size={21} strokeWidth={1.6} />
        Тиждень
      </button>
      <button type="button" className="tab tab-new" aria-label="Нове завдання" onClick={onNew}>
        <Plus size={24} strokeWidth={1.8} />
      </button>
      <button type="button" className="tab" aria-current={isCal ? 'page' : undefined} onClick={() => go({ name: 'calendar', mode: 'month', date: monthStart(today) })}>
        <CalendarDays size={21} strokeWidth={1.6} />
        Календар
      </button>
      <button type="button" className="tab" aria-current={isMore ? 'page' : undefined} onClick={onMore}>
        <MenuIcon size={21} strokeWidth={1.6} />
        Ще
      </button>
    </nav>
  )
}
