import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/shared/api/client'
import { httpLessonService } from '@/features/lesson/httpLessonService'

/**
 * 다시보기(ReplayLessonPage)는 curriculumId를 모른 채 getLesson을 부른다(lessonId만 안다).
 * /lessons/{id}(수강생 상세, LESSON-DETAIL-01) 응답이 curriculumId를 이미 주므로, 어댑터는
 * request.curriculumId가 없어도 응답 값을 써야 한다. 이걸 request에만 기대면 "강의 상세" 링크가
 * /curriculums//sections/.../lessons/... 처럼 빈 세그먼트로 깨져 라우터가 404로 떨어진다
 * (로컬은 mock 서비스가 항상 curriculumId를 채워 주므로 이 버그가 가려진다).
 */
describe('httpLessonService.getLesson — 커리큘럼 문맥 복원', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('요청에 curriculumId가 없어도 레슨 응답의 curriculumId로 강의 상세 경로를 만들 수 있다', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation((url: string) => {
      if (url === '/lessons/lsn_1') {
        return Promise.resolve({
          data: {
            lessonId: 'lsn_1',
            sectionId: 'sec_1',
            curriculumId: 'cur_1',
            curriculumTitle: '자바 기초',
            sectionTitle: '1주차',
            title: '변수와 타입',
            description: '',
            status: 'PUBLISHED',
            deliveryType: 'LIVE',
            materials: [],
          },
        } as never)
      }
      if (url === '/curriculums/cur_1') {
        return Promise.resolve({
          data: { curriculumId: 'cur_1', title: '자바 기초', outline: [] },
        } as never)
      }
      throw new Error(`unexpected GET ${url}`)
    })

    const result = await httpLessonService.getLesson({ lessonId: 'lsn_1', role: 'STUDENT' })

    expect(result.curriculumId).toBe('cur_1')
    expect(result.sectionTitle).toBe('1주차')
  })
})
