import { describe, expect, it } from 'vitest'
import { resolveLessonPath } from '@/features/lesson/lessonRouting'

const studentBase = {
  role: 'STUDENT' as const,
  curriculumId: 'cur-1',
  sectionId: 'sec-1',
  lessonId: 'les-1',
}

describe('resolveLessonPath', () => {
  it('학생 강의 상세 경로에 역할과 전체 계층을 포함한다', () => {
    expect(resolveLessonPath({ ...studentBase, destination: 'LESSON_DETAIL' })).toBe(
      '/student/curriculums/cur-1/sections/sec-1/lessons/les-1',
    )
  })

  it('통합된 라이브 상세 목적지는 강의 상세를 사용하고 강의실만 sessionId를 사용한다', () => {
    expect(resolveLessonPath({ ...studentBase, destination: 'LIVE_SESSION', sessionId: 'ses-1' })).toBe(
      '/student/curriculums/cur-1/sections/sec-1/lessons/les-1',
    )
    expect(resolveLessonPath({ ...studentBase, destination: 'LIVE_CLASSROOM', sessionId: 'ses-1' })).toBe(
      '/student/live-sessions/ses-1/classroom',
    )
  })

  it('학생 다시보기는 lessonId 기반 경로로 이동한다', () => {
    expect(resolveLessonPath({ ...studentBase, destination: 'VOD' })).toBe('/student/lessons/les-1/replay')
  })

  it('강사 경로에는 instructor 역할 접두사를 사용한다', () => {
    expect(resolveLessonPath({ ...studentBase, role: 'INSTRUCTOR', destination: 'LESSON_DETAIL' })).toBe(
      '/instructor/curriculums/cur-1/sections/sec-1/lessons/les-1',
    )
    expect(
      resolveLessonPath({ ...studentBase, role: 'INSTRUCTOR', destination: 'LIVE_SESSION', sessionId: 'ses-1' }),
    ).toBe('/instructor/curriculums/cur-1/sections/sec-1/lessons/les-1')
    expect(resolveLessonPath({ ...studentBase, role: 'INSTRUCTOR', destination: 'VOD' })).toBe(
      '/instructor/lessons/les-1/replay',
    )
  })

  it('라이브 목적지에 sessionId가 없으면 역할별 강의 상세 경로로 대체한다', () => {
    expect(resolveLessonPath({ ...studentBase, destination: 'LIVE_SESSION' })).toBe(
      '/student/curriculums/cur-1/sections/sec-1/lessons/les-1',
    )
  })
})
