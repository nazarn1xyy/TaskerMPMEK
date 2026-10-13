import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { activeMembers, useStore } from './store'
import type { Project, Task } from './types'

export function useMembers() {
  const members = useStore((s) => s.members)
  return useMemo(() => activeMembers(members), [members])
}

export function useProjects() {
  const projects = useStore((s) => s.projects)
  return useMemo(
    () =>
      Object.values(projects)
        .filter((p) => !p.archived)
        .sort((a, b) => a.order - b.order),
    [projects],
  )
}

export function useLiveTasks() {
  const tasks = useStore((s) => s.tasks)
  return useMemo(() => Object.values(tasks).filter((t) => !t.deletedAt), [tasks])
}

export function useAttachmentsOf(ownerType: string, ownerId: string) {
  const attachments = useStore((s) => s.attachments)
  return useMemo(
    () =>
      Object.values(attachments)
        .filter((a) => a.ownerType === ownerType && a.ownerId === ownerId)
        .sort((a, b) => a.createdAt - b.createdAt),
    [attachments, ownerType, ownerId],
  )
}

/** Counts of attachments and comments per task — computed once per change and shared by every row. */
let counterCache: { a: unknown; c: unknown; value: { files: Map<string, number>; notes: Map<string, number> } } | null = null
export function useTaskCounters() {
  const attachments = useStore((s) => s.attachments)
  const comments = useStore((s) => s.comments)
  if (!counterCache || counterCache.a !== attachments || counterCache.c !== comments) {
    const files = new Map<string, number>()
    const notes = new Map<string, number>()
    for (const a of Object.values(attachments)) if (a.ownerType === 'task') files.set(a.ownerId, (files.get(a.ownerId) ?? 0) + 1)
    for (const c of Object.values(comments)) notes.set(c.taskId, (notes.get(c.taskId) ?? 0) + 1)
    counterCache = { a: attachments, c: comments, value: { files, notes } }
  }
  return counterCache.value
}

export function usePersisted<T>(key: string, initial: T) {
  const full = `tasker.${key}`
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(full)
      return raw ? { ...initial, ...JSON.parse(raw) } : initial
    } catch {
      return initial
    }
  })
  // keep `initial` objects mergeable but let primitives through untouched
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
        localStorage.setItem(full, JSON.stringify(v))
        return v
      })
    },
    [full],
  )
  return [value, set] as const
}

export function usePersistedValue<T extends string | number | boolean | null>(key: string, initial: T) {
  const full = `tasker.${key}`
  const [value, setValue] = useState<T>(() => {
    const raw = localStorage.getItem(full)
    return raw === null ? initial : (JSON.parse(raw) as T)
  })
  const set = useCallback(
    (v: T) => {
      localStorage.setItem(full, JSON.stringify(v))
      setValue(v)
    },
    [full],
  )
  return [value, set] as const
}

const typing = (el: EventTarget | null) => {
  const n = el as HTMLElement | null
  return Boolean(n && (n.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(n.tagName)))
}

/** Single-key shortcuts that never fire while the user is typing. */
export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>, enabled = true) {
  const ref = useRef(map)
  ref.current = map
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const key = `${mod ? 'mod+' : ''}${e.shiftKey && e.key.length > 1 ? 'shift+' : ''}${e.key.toLowerCase()}`
      const fn = ref.current[key]
      if (!fn) return
      if (!mod && (typing(e.target) || e.altKey)) return
      fn(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}

export const isTyping = typing

export function projectName(projects: Record<string, Project>, t: Task) {
  return t.projectId ? (projects[t.projectId]?.name ?? null) : null
}

export function useNow(intervalMs = 60000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
