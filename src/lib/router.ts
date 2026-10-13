import { useSyncExternalStore } from 'react'
import { monthStart, todayIso, weekStart } from './dates'

export type Period = 'day' | 'week' | 'month' | 'all'

export type Route =
  | { name: 'tasks'; period: Period; date: string }
  | { name: 'calendar'; mode: 'month' | 'week'; date: string }
  | { name: 'projects' }
  | { name: 'project'; id: string }
  | { name: 'team' }
  | { name: 'member'; id: string }
  | { name: 'stats' }

export interface Location {
  route: Route
  task: string | null
  path: string
}

const isDate = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s))

export function parseHash(hash: string): Location {
  const raw = hash.replace(/^#/, '') || '/today'
  const [path, query = ''] = raw.split('?')
  const task = new URLSearchParams(query).get('task')
  const [, a, b, c] = path.split('/')
  const today = todayIso()
  let route: Route
  switch (a) {
    case 'day':
      route = { name: 'tasks', period: 'day', date: isDate(b) ? b : today }
      break
    case 'week':
      route = { name: 'tasks', period: 'week', date: weekStart(isDate(b) ? b : today) }
      break
    case 'month':
      route = { name: 'tasks', period: 'month', date: monthStart(isDate(b) ? b : today) }
      break
    case 'all':
      route = { name: 'tasks', period: 'all', date: today }
      break
    case 'calendar': {
      const mode = b === 'week' ? 'week' : 'month'
      const d = isDate(c) ? c : today
      route = { name: 'calendar', mode, date: mode === 'week' ? weekStart(d) : monthStart(d) }
      break
    }
    case 'projects':
      route = { name: 'projects' }
      break
    case 'project':
      route = b ? { name: 'project', id: b } : { name: 'projects' }
      break
    case 'team':
      route = { name: 'team' }
      break
    case 'member':
      route = b ? { name: 'member', id: b } : { name: 'team' }
      break
    case 'stats':
      route = { name: 'stats' }
      break
    default:
      route = { name: 'tasks', period: 'day', date: today }
  }
  return { route, task, path }
}

export function routePath(r: Route): string {
  switch (r.name) {
    case 'tasks':
      if (r.period === 'all') return '/all'
      if (r.period === 'day' && r.date === todayIso()) return '/today'
      return `/${r.period}/${r.date}`
    case 'calendar':
      return `/calendar/${r.mode}/${r.date}`
    case 'project':
      return `/project/${r.id}`
    case 'member':
      return `/member/${r.id}`
    default:
      return `/${r.name}`
  }
}

let cached: Location | null = null
let cachedHash = ''
const snapshot = () => {
  if (!cached || cachedHash !== location.hash) {
    cachedHash = location.hash
    cached = parseHash(location.hash)
  }
  return cached
}
const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

export const useLocation = () => useSyncExternalStore(subscribe, snapshot)

export function go(route: Route | string, keepTask = false) {
  const path = typeof route === 'string' ? route : routePath(route)
  const task = keepTask ? snapshot().task : null
  location.hash = task ? `${path}?task=${task}` : path
}

export function openTask(id: string | null) {
  const { path } = snapshot()
  const next = id ? `#${path}?task=${id}` : `#${path}`
  if (location.hash !== next) location.hash = next
}

export const currentTask = () => snapshot().task
