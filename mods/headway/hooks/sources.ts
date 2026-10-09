// Reads Claude's own plan tools into Headway events. Inputs and results are
// parsed defensively: a tool's schema can change between builds, and a
// shape Headway does not recognise is ignored, never an error.

import type { HeadwayStepStatus } from '../types'
import type { HeadwayEvent, Item } from './model'
import { cleanText, parseOutline } from './outline'

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const clean = cleanText(value)
  return clean === '' ? null : clean
}

function id(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

export function statusOf(value: unknown): HeadwayStepStatus {
  if (value === 'completed') return 'done'
  if (value === 'in_progress') return 'active'
  return 'pending'
}

function todoItems(list: unknown): Item[] | null {
  if (!Array.isArray(list)) return null
  return list.flatMap(entry => {
    const todo = record(entry)
    const title = text(todo?.content)
    return title === null ? [] : [{ title, status: statusOf(todo?.status) }]
  })
}

function taskItems(list: unknown): Item[] | null {
  if (!Array.isArray(list)) return null
  const seen = new Set<string>()
  return list.flatMap(entry => {
    const task = record(entry)
    const key = id(task?.id)
    const title = text(task?.subject)
    if (key === null || title === null || seen.has(key)) return []
    seen.add(key)
    return [{ key: `task:${key}`, title, status: statusOf(task?.status) }]
  })
}

/**
 * The event one finished, successful call of a watched tool means, or null.
 * TodoWrite, TaskCreate, TaskList and ExitPlanMode count only from the main
 * loop (a subagent keeps lists of its own); TaskUpdate counts from any loop,
 * since tasks are shared and Headway only applies it to a task it knows.
 */
export function eventFromTool(tool: string, input: unknown, result: unknown, isMain: boolean): HeadwayEvent | null {
  const args = record(input)
  const out = record(result)
  switch (tool) {
    case 'TodoWrite': {
      if (!isMain) return null
      const items = todoItems(args?.todos) ?? todoItems(out?.newTodos)
      return items === null ? null : { kind: 'todos', items }
    }
    case 'TaskCreate': {
      if (!isMain) return null
      const task = record(out?.task)
      const key = id(task?.id)
      const title = text(args?.subject) ?? text(task?.subject)
      return key === null || title === null ? null : { kind: 'task-create', id: key, title }
    }
    case 'TaskUpdate': {
      if (out?.success === false) return null
      const key = id(args?.taskId)
      const title = text(args?.subject)
      const raw = args?.status
      const status = raw === 'deleted' ? 'deleted' : raw === undefined ? undefined : statusOf(raw)
      if (key === null || (title === null && status === undefined)) return null
      return { kind: 'task-update', id: key, isMain, ...(title === null ? {} : { title }), ...(status === undefined ? {} : { status }) }
    }
    case 'TaskList': {
      if (!isMain) return null
      const items = taskItems(out?.tasks)
      return items === null ? null : { kind: 'task-list', items }
    }
    case 'ExitPlanMode': {
      if (!isMain || out?.awaitingLeaderApproval === true || typeof out?.plan !== 'string') return null
      const outline = parseOutline(out.plan)
      return outline === null ? null : { kind: 'outline', outline }
    }
    default:
      return null
  }
}
