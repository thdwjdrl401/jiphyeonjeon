import type { CurriculumLiveSessionStatus } from '@/features/lesson/types'

const ENTRY_WINDOW_MS = 10 * 60 * 1000

interface LiveEntryTiming {
  status: CurriculumLiveSessionStatus
  scheduledAt: string | null
}

export function isLiveEntryOpen(live: LiveEntryTiming, now = Date.now()) {
  if (live.status === 'OPEN' || live.status === 'STARTING' || live.status === 'LIVE') return true
  if (live.status !== 'SCHEDULED' || !live.scheduledAt) return false

  const scheduledAt = new Date(live.scheduledAt).getTime()
  return Number.isFinite(scheduledAt) && now >= scheduledAt - ENTRY_WINDOW_MS
}
