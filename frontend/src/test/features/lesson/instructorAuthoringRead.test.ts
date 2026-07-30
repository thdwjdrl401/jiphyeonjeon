import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/shared/api/client'

vi.mock('@/shared/config/runtime', () => ({ isMockApiEnabled: false, isTestMode: false }))

import { httpLessonService } from '@/features/lesson/httpLessonService'

/**
 * 강사 저작(수정 폼·사이드바) 읽기는 공개 카탈로그({@code /curriculums/{id}}, PUBLISHED-only)가 아니라
 * 강사 엔드포인트로 가야 한다 — 안 그러면 DRAFT 커리큘럼에서 404가 나거나 방금 만든 세션이 빠진다.
 */
describe('강사 저작 읽기 경로', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('강사 레슨 조회는 강사 엔드포인트로 읽고 liveSession을 그대로 반영한다(공개 카탈로그 미호출)', async () => {
    const get = vi.spyOn(apiClient, 'get').mockImplementation((async (url: string) => {
      if (url === '/instructor/lessons/les-1') {
        return {
          data: {
            lessonId: 'les-1', sectionId: 'sec-1', title: '1강', description: '설명', status: 'PUBLISHED',
            materials: [],
            liveSession: { sessionId: 'ses-1', status: 'SCHEDULED', scheduledAt: '2026-08-01T10:00:00+09:00' },
          },
        }
      }
      if (url === '/instructor/curriculums/cur-1') return { data: { curriculumId: 'cur-1', title: '커리큘럼' } }
      if (url === '/instructor/curriculums/cur-1/sections') {
        return { data: [{ sectionId: 'sec-1', title: '1주차', orderIndex: 0 }] }
      }
      throw new Error(`예상치 못한 호출: ${url}`)
    }) as never)

    const lesson = await httpLessonService.getLesson({
      lessonId: 'les-1', role: 'INSTRUCTOR', curriculumId: 'cur-1', sectionId: 'sec-1',
    })

    expect(lesson.liveSession).toEqual({
      sessionId: 'ses-1', status: 'SCHEDULED', scheduledAt: '2026-08-01T10:00:00+09:00',
    })
    expect(lesson.sectionTitle).toBe('1주차')
    // 공개 카탈로그(PUBLISHED-only)는 절대 부르지 않는다 — DRAFT에서 404가 나던 원인.
    expect(get).not.toHaveBeenCalledWith('/curriculums/cur-1')
  })

  it('강사 사이드바 내비게이션은 강사 엔드포인트로 섹션·강의를 읽는다', async () => {
    const get = vi.spyOn(apiClient, 'get').mockImplementation((async (url: string) => {
      if (url === '/instructor/curriculums/cur-1') return { data: { curriculumId: 'cur-1', title: '커리큘럼' } }
      if (url === '/instructor/curriculums/cur-1/sections') {
        return { data: [{ sectionId: 'sec-1', title: '1주차', orderIndex: 0 }] }
      }
      if (url === '/instructor/sections/sec-1/lessons') {
        return { data: [{ lessonId: 'les-1', sectionId: 'sec-1', title: '1강', description: '', status: 'PUBLISHED' }] }
      }
      throw new Error(`예상치 못한 호출: ${url}`)
    }) as never)

    const nav = await httpLessonService.getCurriculumLessonNavigation('cur-1', 'INSTRUCTOR')

    expect(nav.title).toBe('커리큘럼')
    expect(nav.sections).toHaveLength(1)
    expect(nav.sections[0].lessons[0]).toMatchObject({ lessonId: 'les-1', title: '1강', order: 1 })
    expect(get).not.toHaveBeenCalledWith('/curriculums/cur-1')
  })

  it('학생 내비게이션은 여전히 공개 카탈로그를 읽는다', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        curriculumId: 'cur-1', title: '커리큘럼',
        outline: [{ sectionId: 'sec-1', title: '1주차', lessons: [{ lessonId: 'les-1', title: '1강', status: 'PUBLISHED' }] }],
      },
    } as never)

    await httpLessonService.getCurriculumLessonNavigation('cur-1', 'STUDENT')
    expect(get).toHaveBeenCalledWith('/curriculums/cur-1')
  })
})
