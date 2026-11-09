import { useEffect, useMemo, useState } from 'react'
import { api, type GEvent } from './api'
import { useStore } from './store'

export const useGcalConnected = () =>
  useStore((s) => {
    const c = s.me ? s.gcal.connected[s.me] : undefined
    return Boolean(c && !c.broken)
  })

/** My Google Calendar meetings for a date range, refreshed every minute and when the tab comes back. */
export function useGoogleEvents(from: string, to: string) {
  const connected = useGcalConnected()
  const version = useStore((s) => s.version)
  const [events, setEvents] = useState<GEvent[]>([])
  useEffect(() => {
    if (!connected) {
      setEvents([])
      return
    }
    let alive = true
    const load = () =>
      api
        .gcalEvents(from, to)
        .then((r) => alive && setEvents(r.events))
        .catch(() => {})
    load()
    const id = window.setInterval(load, 60_000)
    const onVisible = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [from, to, connected, version])

  return useMemo(() => {
    const byDay = new Map<string, GEvent[]>()
    for (const ev of events) {
      const list = byDay.get(ev.day)
      if (list) list.push(ev)
      else byDay.set(ev.day, [ev])
    }
    for (const list of byDay.values()) list.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''))
    return byDay
  }, [events])
}

export const connectGoogle = (memberId: string) => {
  location.href = `/api/gcal/connect?member=${encodeURIComponent(memberId)}`
}
