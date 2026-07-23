import {
  getDemoInstructorCurriculums,
  getDemoStudentLearningSummary,
  getDemoTodayInstructorLiveSession,
  getDemoTodayLiveSession,
} from '@/features/demo/demoData'
import type { CurriculumLifecycleStatus } from './types'
import type { MyCurriculumsService } from './myCurriculumsService.interface'

export const mockMyCurriculumsService = {
  async getInstructorCurriculums(query, userId) {
    let items = getDemoInstructorCurriculums(userId).map((item) => ({
      curriculumId: item.curriculumId,
      title: item.title,
      summary: item.summary,
      thumbnailUrl: item.thumbnailUrl,
      lifecycleStatus: item.lifecycleStatus as CurriculumLifecycleStatus,
      sectionCount: 0,
      lessonCount: item.lessonCount,
      publishedLessonCount: item.publishedLessonCount,
      nextLiveSession: item.nextSession === '일정 미정' ? null : {
        sessionId: `mock-session-${item.curriculumId}`,
        lessonId: '',
        lessonTitle: null,
        scheduledAt: item.nextSession,
        liveSessionStatus: 'SCHEDULED',
      },
    }))
    const search = query.q?.trim().toLocaleLowerCase('ko')
    if (search) items = items.filter((item) => item.title.toLocaleLowerCase('ko').includes(search))
    if (query.status) items = items.filter((item) => item.lifecycleStatus === query.status)
    if (query.sort === 'TITLE_ASC') items.sort((a, b) => a.title.localeCompare(b.title, 'ko'))
    const page = query.page ?? 0
    const size = query.size ?? 20
    const start = page * size
    return {
      items: items.slice(start, start + size),
      page,
      size,
      totalElements: items.length,
      totalPages: Math.ceil(items.length / size),
      hasNext: start + size < items.length,
    }
  },
  async getStudentDashboardSummary(userId) {
    return {
      ...getDemoStudentLearningSummary(userId),
      todayLiveSession: getDemoTodayLiveSession(userId),
    }
  },
  async getInstructorDashboardSummary(userId) {
    const curriculums = getDemoInstructorCurriculums(userId)
    return {
      totalCurriculumCount: curriculums.length,
      publishedCurriculumCount: curriculums.filter((item) => item.lifecycleStatus === 'PUBLISHED').length,
      upcomingLiveCount: curriculums.filter((item) => item.nextSession !== '일정 미정').length,
      totalEnrolleeCount: curriculums.reduce((sum, item) => sum + item.enrolleeCount, 0),
      todayLiveSession: getDemoTodayInstructorLiveSession(userId),
    }
  },
} satisfies MyCurriculumsService
