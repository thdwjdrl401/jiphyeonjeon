import { describe, expect, it } from 'vitest'
import { resolveLessonPath } from './lessonRouting'

const base = {
  curriculumId: 'cur_1',
  sectionId: 'sec_1',
  lessonId: 'les_1',
}

describe('resolveLessonPath', () => {
  it('레슨 상세는 sectionId를 포함한 실제 라우트로 이동한다', () => {
    expect(resolveLessonPath({ ...base, destination: 'LESSON_DETAIL' })).toBe(
      '/curriculums/cur_1/sections/sec_1/lessons/les_1',
    )
  })

  it('라이브 상세와 교실은 lessonId가 아니라 sessionId를 사용한다', () => {
    expect(resolveLessonPath({ ...base, destination: 'LIVE_SESSION', sessionId: 'ses_1' })).toBe(
      '/live-sessions/ses_1',
    )
    expect(resolveLessonPath({ ...base, destination: 'LIVE_CLASSROOM', sessionId: 'ses_1' })).toBe(
      '/live-sessions/ses_1/classroom',
    )
  })

  it('다시보기는 lessonId 기반 실제 라우트로 이동한다', () => {
    expect(resolveLessonPath({ ...base, destination: 'VOD' })).toBe('/lessons/les_1/replay')
  })

  it('라이브 목적지인데 sessionId가 없으면 존재하는 레슨 상세 경로로 대체한다', () => {
    expect(resolveLessonPath({ ...base, destination: 'LIVE_SESSION' })).toBe(
      '/curriculums/cur_1/sections/sec_1/lessons/les_1',
    )
  })
})
