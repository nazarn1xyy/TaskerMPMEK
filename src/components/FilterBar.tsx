import { useMemo, useRef } from 'react'
import { ListFilter, Rows3, Search, X } from 'lucide-react'
import { emptyFilters, filtersActive, type Filters, type GroupBy } from '../lib/filters'
import { useHotkeys, useLiveTasks, useMembers, useProjects } from '../lib/hooks'
import type { Status } from '../lib/types'
import { useStore } from '../lib/store'
import { Menu, PopButton, type MenuItem } from './ui'
import { PRIORITY_LABEL } from './TaskDrawer'

const STATUS_LABEL: Record<Status, string> = { open: 'Не виконані', done: 'Виконані', cancelled: 'Скасовані' }
const GROUP_LABEL: Record<GroupBy, string> = { date: 'за термінами', project: 'за проєктами', person: 'за людьми', status: 'за статусом', none: 'без груп' }

function toggle<T>(list: T[], v: T) {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
}

export function FilterBar({
  filters,
  onFilters,
  groupBy,
  onGroupBy,
  groupOptions = ['date', 'project', 'person', 'status', 'none'],
}: {
  filters: Filters
  onFilters: (f: Filters) => void
  groupBy?: GroupBy
  onGroupBy?: (g: GroupBy) => void
  groupOptions?: GroupBy[]
}) {
  const members = useMembers()
  const projects = useProjects()
  const tasks = useLiveTasks()
  const search = useRef<HTMLInputElement>(null)
  const tags = useMemo(() => [...new Set(tasks.flatMap((t) => t.tags))].sort(), [tasks])
  useHotkeys({ '/': (e) => (e.preventDefault(), search.current?.focus()) })

  const set = (patch: Partial<Filters>) => onFilters({ ...filters, ...patch })

  const chips: { key: string; label: string; clear: () => void }[] = []
  if (filters.status.length) chips.push({ key: 's', label: filters.status.map((s) => STATUS_LABEL[s].toLowerCase()).join(', '), clear: () => set({ status: [] }) })
  if (filters.projects.length)
    chips.push({ key: 'p', label: filters.projects.map((id) => (id === 'none' ? 'без проєкту' : (projects.find((p) => p.id === id)?.name ?? '—'))).join(', '), clear: () => set({ projects: [] }) })
  if (filters.priority.length) chips.push({ key: 'pr', label: filters.priority.map((p) => (p ? '!'.repeat(p) : 'без пріоритету')).join(', '), clear: () => set({ priority: [] }) })
  if (filters.authors.length) chips.push({ key: 'a', label: `автор: ${filters.authors.map((id) => members.find((m) => m.id === id)?.name ?? '—').join(', ')}`, clear: () => set({ authors: [] }) })
  if (filters.tags.length) chips.push({ key: 't', label: filters.tags.map((t) => `#${t}`).join(' '), clear: () => set({ tags: [] }) })

  const section = (title: string, items: MenuItem[]): MenuItem[] => [{ key: `h-${title}`, label: title, header: true }, ...items]

  return (
    <div className="filterbar">
      <label className="search">
        <Search size={15} strokeWidth={1.6} />
        <input ref={search} value={filters.q} placeholder="Пошук" onChange={(e) => set({ q: e.target.value })} onKeyDown={(e) => e.key === 'Escape' && (set({ q: '' }), e.currentTarget.blur())} />
        {filters.q ? (
          <button type="button" className="icon-btn" aria-label="Очистити" onClick={() => set({ q: '' })}>
            <X size={13} />
          </button>
        ) : (
          <kbd className="kbd">/</kbd>
        )}
      </label>

      <PopButton className={`tool-btn${filtersActive({ ...filters, q: '' }) ? ' is-on' : ''}`} label={<><ListFilter size={15} strokeWidth={1.6} /> <span className="tool-text">Фільтр</span></>} popClass="pop-filter">
        {() => (
          <div className="filter-pop">
            <Menu
              multi
              items={[
                ...section(
                  'Статус',
                  (['open', 'done', 'cancelled'] as Status[]).map((s) => ({ key: s, label: STATUS_LABEL[s], checked: filters.status.includes(s), onSelect: () => set({ status: toggle(filters.status, s) }) })),
                ),
                ...section('Пріоритет', [3, 2, 1, 0].map((p) => ({ key: `p${p}`, label: PRIORITY_LABEL[p], checked: filters.priority.includes(p), onSelect: () => set({ priority: toggle(filters.priority, p) }) }))),
                ...section('Проєкт', [
                  ...projects.map((p) => ({ key: p.id, label: p.name, checked: filters.projects.includes(p.id), onSelect: () => set({ projects: toggle(filters.projects, p.id) }) })),
                  { key: 'none', label: 'Без проєкту', checked: filters.projects.includes('none'), onSelect: () => set({ projects: toggle(filters.projects, 'none') }) },
                ]),
                ...section('Хто створив', members.map((m) => ({ key: `a${m.id}`, label: m.name, checked: filters.authors.includes(m.id), onSelect: () => set({ authors: toggle(filters.authors, m.id) }) }))),
                ...(tags.length ? section('Теги', tags.map((t) => ({ key: `t${t}`, label: `#${t}`, checked: filters.tags.includes(t), onSelect: () => set({ tags: toggle(filters.tags, t) }) }))) : []),
              ]}
            />
            {filtersActive(filters) && (
              <button type="button" className="link-btn filter-reset" onClick={() => onFilters(emptyFilters())}>
                Скинути все
              </button>
            )}
          </div>
        )}
      </PopButton>

      {groupBy && onGroupBy && (
        <PopButton className="tool-btn" label={<><Rows3 size={15} strokeWidth={1.6} className="tool-icon" /> <span className="tool-text">Групи: {GROUP_LABEL[groupBy]}</span></>} title={`Групи: ${GROUP_LABEL[groupBy]}`}>
          {(close) => <Menu onDone={close} items={groupOptions.map((g) => ({ key: g, label: GROUP_LABEL[g], checked: g === groupBy, onSelect: () => onGroupBy(g) }))} />}
        </PopButton>
      )}

      {chips.length > 0 && (
        <div className="chips">
          {chips.map((c) => (
            <button key={c.key} type="button" className="chip" onClick={c.clear} title="Прибрати фільтр">
              {c.label}
              <X size={12} strokeWidth={1.8} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function WhoTabs({ value, onChange, allowAll = true }: { value: string; onChange: (v: string) => void; allowAll?: boolean }) {
  const members = useMembers()
  const me = useStore((s) => s.me)
  return (
    <div className="who" role="tablist" aria-label="Чиї завдання">
      <button type="button" role="tab" aria-selected={value === 'me'} onClick={() => onChange('me')}>
        Мої
      </button>
      {allowAll && (
        <button type="button" role="tab" aria-selected={value === 'all'} onClick={() => onChange('all')}>
          Усі
        </button>
      )}
      <span className="who-sep" aria-hidden />
      {members
        .filter((m) => m.id !== me)
        .map((m) => (
        <button key={m.id} type="button" role="tab" aria-selected={value === m.id} onClick={() => onChange(m.id)}>
          {m.name}
        </button>
      ))}
    </div>
  )
}
