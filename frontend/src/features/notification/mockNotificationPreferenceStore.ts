import type { SavePreferenceInput } from './notificationService.interface'
import type { NotificationPreference } from './types'

const DEFAULT_LEAD_MINUTES = 10

interface MockNotificationPreferenceRecord extends SavePreferenceInput {
  userId: string
}

const preferences = new Map<string, MockNotificationPreferenceRecord>()

function preferenceKey(userId: string, curriculumId: string, lessonId?: string) {
  return `${userId}:${curriculumId}:${lessonId ?? 'curriculum'}`
}

export function getMockNotificationPreference(
  userId: string,
  curriculumId: string,
  lessonId?: string,
): NotificationPreference {
  if (lessonId) {
    const lesson = preferences.get(preferenceKey(userId, curriculumId, lessonId))
    if (lesson) return { enabled: lesson.enabled, leadMinutes: lesson.leadMinutes, source: 'LESSON' }
  }

  const curriculum = preferences.get(preferenceKey(userId, curriculumId))
  if (curriculum) {
    return {
      enabled: curriculum.enabled,
      leadMinutes: curriculum.leadMinutes,
      source: 'CURRICULUM',
    }
  }

  return { enabled: true, leadMinutes: DEFAULT_LEAD_MINUTES, source: 'DEFAULT' }
}

export function saveMockNotificationPreference(userId: string, input: SavePreferenceInput) {
  preferences.set(preferenceKey(userId, input.curriculumId, input.lessonId), { userId, ...input })
}

export function clearMockNotificationPreferences() {
  preferences.clear()
}
