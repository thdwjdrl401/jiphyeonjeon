import { peekMockUser } from '@/features/auth/mockAuthService'
import { getMockEnrollment } from '@/features/enrollment/mockEnrollmentStore'
import {
  getMockProgress,
  mockCurriculumEntities,
  resolveMockRelationship,
  type MockCurriculumEntity,
} from '@/features/demo/mockDatabase'
import type {
  CurriculumCardSummary,
  CurriculumListQuery,
  CurriculumListResponse,
} from './types'

function withViewerContext(curriculum: MockCurriculumEntity): CurriculumCardSummary {
  const user = peekMockUser()
  const relationship = resolveMockRelationship(user, curriculum)
  const enrollment = user ? getMockEnrollment(user.userId, curriculum.curriculumId) : null
  const summary = {
    curriculumId: curriculum.curriculumId,
    title: curriculum.title,
    summary: curriculum.summary,
    thumbnailUrl: curriculum.thumbnailUrl,
    instructor: {
      instructorId: curriculum.instructor.instructorId,
      displayName: curriculum.instructor.displayName,
    },
    lifecycleStatus: curriculum.lifecycleStatus,
    period: curriculum.period,
    sectionCount: curriculum.sectionCount,
    lessonCount: curriculum.lessonCount,
  }

  if (relationship === 'GUEST') {
    return { ...summary, viewerContext: { relationship, allowedActions: ['VIEW_DETAIL'] } }
  }
  if (relationship === 'OWNER_INSTRUCTOR') {
    return {
      ...summary,
      viewerContext: { relationship, allowedActions: ['VIEW_DETAIL', 'MANAGE_CURRICULUM'] },
    }
  }
  if (relationship === 'NON_OWNER_INSTRUCTOR') {
    return { ...summary, viewerContext: { relationship, allowedActions: ['VIEW_DETAIL'] } }
  }
  if (relationship === 'ENROLLED' && enrollment) {
    return {
      ...summary,
      viewerContext: {
        relationship,
        allowedActions: ['VIEW_DETAIL', 'CONTINUE_LEARNING'],
        progress: getMockProgress(curriculum, enrollment),
      },
    }
  }
  if (relationship === 'PENDING_ENROLLMENT') {
    return { ...summary, viewerContext: { relationship, allowedActions: ['VIEW_DETAIL'] } }
  }
  return {
    ...summary,
    viewerContext: { relationship: 'UNENROLLED_STUDENT', allowedActions: ['VIEW_DETAIL', 'ENROLL'] },
  }
}

export async function getMockCurriculums(query: CurriculumListQuery): Promise<CurriculumListResponse> {
  if (import.meta.env.MODE !== 'test') {
    await new Promise((resolve) => window.setTimeout(resolve, 420))
  }

  const search = query.q?.trim().toLocaleLowerCase('ko')
  let filtered = mockCurriculumEntities.filter((curriculum) => {
    if (!curriculum.catalogVisible) return false
    if (query.featured && !curriculum.featured) return false
    if (query.lifecycleStatus && curriculum.lifecycleStatus !== query.lifecycleStatus) return false
    if (!search) return true
    return [curriculum.title, curriculum.summary, curriculum.instructor.displayName]
      .join(' ')
      .toLocaleLowerCase('ko')
      .includes(search)
  })

  if (query.sort === 'TITLE_ASC') {
    filtered = [...filtered].sort((a, b) => a.title.localeCompare(b.title, 'ko'))
  }

  const page = query.page ?? 0
  const size = query.size ?? 9
  const start = page * size
  const items = filtered.slice(start, start + size).map(withViewerContext)
  const totalPages = Math.ceil(filtered.length / size)

  return {
    items,
    page,
    size,
    totalElements: filtered.length,
    totalPages,
    hasNext: page + 1 < totalPages,
  }
}
