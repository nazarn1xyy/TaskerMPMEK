export type Status = 'open' | 'done' | 'cancelled'
export type Scope = 'none' | 'day' | 'week' | 'month'
export type Repeat = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly'
export type Priority = 0 | 1 | 2 | 3

export interface Member {
  id: string
  name: string
  avatarId: string | null
  archived: boolean
  order: number
  createdAt: number
  updatedAt: number
}

export interface Project {
  id: string
  name: string
  description: string
  ownerId: string | null
  archived: boolean
  order: number
  createdAt: number
  updatedAt: number
}

export interface CheckItem {
  id: string
  text: string
  done: boolean
  level: 0 | 1
}

export interface Steps {
  done: number
  total: number
}

export interface Task {
  id: string
  title: string
  notes: string
  status: Status
  priority: Priority
  projectId: string | null
  assigneeId: string | null
  createdBy: string | null
  completedAt: number | null
  completedBy: string | null
  /** Planning horizon: a specific day, a whole week, a whole month, or no date at all. */
  scope: Scope
  /** Anchor for the scope: the day, the Monday of the week, or the 1st of the month. */
  date: string | null
  /** Hard deadline, independent from the horizon. */
  due: string | null
  dueTime: string | null
  repeat: Repeat
  tags: string[]
  checklist: CheckItem[]
  steps: Steps | null
  order: number
  deletedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface Comment {
  id: string
  taskId: string
  authorId: string | null
  text: string
  createdAt: number
  updatedAt: number
}

export type OwnerType = 'task' | 'project' | 'comment' | 'member'

export interface Attachment {
  id: string
  ownerType: OwnerType
  ownerId: string
  name: string
  size: number
  mime: string
  thumb: boolean
  width: number | null
  height: number | null
  createdBy: string | null
  createdAt: number
  /** Set when the file lives in Vercel Blob instead of the local uploads folder. */
  url?: string
  downloadUrl?: string
  thumbUrl?: string | null
}

export type ActivityKind =
  | 'created'
  | 'completed'
  | 'cancelled'
  | 'reopened'
  | 'assigned'
  | 'moved'
  | 'renamed'
  | 'rescheduled'
  | 'deleted'
  | 'restored'
  | 'commented'
  | 'attached'
  | 'project'
  | 'member'

export interface Activity {
  id: string
  at: number
  actorId: string | null
  kind: ActivityKind
  taskId?: string
  projectId?: string | null
  title?: string
  meta?: Record<string, unknown>
}

export type Collection = 'members' | 'projects' | 'tasks' | 'comments' | 'attachments'

export interface CollectionMap {
  members: Member
  projects: Project
  tasks: Task
  comments: Comment
  attachments: Attachment
}
