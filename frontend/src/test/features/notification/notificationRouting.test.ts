import { describe, expect, it } from 'vitest'
import { resolveNotificationRoute } from '@/features/notification/notificationRouting'
import type { NotificationTargetState } from '@/features/notification/types'

const NOW = new Date('2026-08-03T18:00:00+09:00').getTime()

function state(overrides: Partial<NotificationTargetState> = {}): NotificationTargetState {
  return {
    curriculumId: 'cur-1',
    sectionId: 'sec-1',
    lessonId: 'les-1',
    liveSessionId: 'ses-1',
    enrollmentId: 'enr-1',
    studentId: 'usr-student-01',
    liveSessionStatus: null,
    scheduledAt: null,
    replayStatus: null,
    ...overrides,
  }
}

describe('알림 클릭 목적지', () => {
  it('수강 신청 알림은 수강생 탭·승인 대기 필터·강조 대상까지 담는다', () => {
    const path = resolveNotificationRoute('ENROLLMENT_REQUESTED', state(), 'INSTRUCTOR', NOW)

    expect(path).toBe(
      '/instructor/curriculums/cur-1/manage?tab=enrollees&enrollmentStatus=PENDING&highlightEnrollment=enr-1',
    )
  })

  it('학생은 수강 신청 알림의 목적지를 갖지 않는다', () => {
    // 강사용 관리 화면으로 학생을 보내면 403이 된다 — 그럴듯한 화면으로 대충 보내지 않는다.
    expect(resolveNotificationRoute('ENROLLMENT_REQUESTED', state(), 'STUDENT', NOW)).toBeNull()
  })

  it('수강 승인·거절 알림은 커리큘럼 상세로 간다', () => {
    expect(resolveNotificationRoute('ENROLLMENT_APPROVED', state(), 'STUDENT', NOW))
      .toBe('/curriculums/cur-1')
    expect(resolveNotificationRoute('ENROLLMENT_REJECTED', state(), 'STUDENT', NOW))
      .toBe('/curriculums/cur-1')
  })

  it('새 강의 알림은 역할별 강의 상세로 간다', () => {
    expect(resolveNotificationRoute('LESSON_PUBLISHED', state(), 'STUDENT', NOW))
      .toBe('/student/curriculums/cur-1/sections/sec-1/lessons/les-1')
    expect(resolveNotificationRoute('LESSON_PUBLISHED', state(), 'INSTRUCTOR', NOW))
      .toBe('/instructor/curriculums/cur-1/sections/sec-1/lessons/les-1')
  })

  it('자료 알림은 강의 상세의 자료 영역을 가리킨다', () => {
    expect(resolveNotificationRoute('MATERIAL_PUBLISHED', state(), 'STUDENT', NOW))
      .toBe('/student/curriculums/cur-1/sections/sec-1/lessons/les-1#lesson-materials')
  })

  it('라이브 입장 시간이 아니면 일정 안내 화면으로 간다', () => {
    const scheduled = state({
      liveSessionStatus: 'SCHEDULED',
      scheduledAt: '2026-08-03T19:00:00+09:00',
    })
    // 입장은 시작 10분 전에 열린다(isLiveEntryOpen). 지금은 60분 전이다.
    expect(resolveNotificationRoute('LIVE_STARTING_SOON', scheduled, 'STUDENT', NOW))
      .toBe('/student/curriculums/cur-1/lessons/les-1/live-upcoming')
    expect(resolveNotificationRoute('LIVE_STARTING_SOON', scheduled, 'INSTRUCTOR', NOW))
      .toBe('/instructor/curriculums/cur-1/sections/sec-1/lessons/les-1')
  })

  it('입장이 열렸으면 역할별 입장 준비 화면으로 간다', () => {
    const open = state({ liveSessionStatus: 'OPEN', scheduledAt: '2026-08-03T19:00:00+09:00' })

    expect(resolveNotificationRoute('LIVE_STARTING_SOON', open, 'STUDENT', NOW))
      .toBe('/student/live-sessions/ses-1/prejoin')
    expect(resolveNotificationRoute('LIVE_STARTING_SOON', open, 'INSTRUCTOR', NOW))
      .toBe('/instructor/live-sessions/ses-1/preflight')
  })

  it('진행 중인 라이브도 학생은 입장 전 점검을 거친다', () => {
    const live = state({ liveSessionStatus: 'LIVE' })

    /*
      강의실로 바로 보내면 RequireStudentPrejoinRoute가 점검 화면으로 되돌린다 — 결과가 같아도
      한 번 튕기는 이동은 알림이 깨진 것처럼 보인다.
    */
    expect(resolveNotificationRoute('LIVE_SCHEDULE_CHANGED', live, 'STUDENT', NOW))
      .toBe('/student/live-sessions/ses-1/prejoin')
  })

  it('일정 취소 알림은 입장 화면이 아니라 강의 상세로 간다', () => {
    expect(resolveNotificationRoute('LIVE_CANCELED', state({ liveSessionStatus: 'CANCELLED' }), 'STUDENT', NOW))
      .toBe('/student/curriculums/cur-1/sections/sec-1/lessons/les-1')
  })

  it('녹화 완료 알림은 재생할 자산이 있으면 검수 화면, 없으면 처리 현황으로 간다', () => {
    expect(resolveNotificationRoute('RECORDING_READY', state({ replayStatus: 'READY_FOR_REVIEW' }), 'INSTRUCTOR', NOW))
      .toBe('/instructor/lessons/les-1/replay')
    expect(resolveNotificationRoute('RECORDING_READY', state({ replayStatus: 'NOT_READY' }), 'INSTRUCTOR', NOW))
      .toBe('/instructor/live-sessions/ses-1/processing')
  })

  it('녹화 실패 알림은 처리 현황으로 간다', () => {
    expect(resolveNotificationRoute('RECORDING_FAILED', state(), 'INSTRUCTOR', NOW))
      .toBe('/instructor/live-sessions/ses-1/processing')
  })

  it('다시보기 공개 알림은 역할별 다시보기 화면으로 간다', () => {
    expect(resolveNotificationRoute('VOD_PUBLISHED', state(), 'STUDENT', NOW))
      .toBe('/student/lessons/les-1/replay')
    expect(resolveNotificationRoute('VOD_PUBLISHED', state(), 'INSTRUCTOR', NOW))
      .toBe('/instructor/lessons/les-1/replay')
  })

  it('필요한 리소스 id가 없으면 목적지를 만들지 않는다', () => {
    const empty = state({ curriculumId: null, sectionId: null, lessonId: null, liveSessionId: null })

    expect(resolveNotificationRoute('LESSON_PUBLISHED', empty, 'STUDENT', NOW)).toBeNull()
    expect(resolveNotificationRoute('ENROLLMENT_APPROVED', empty, 'STUDENT', NOW)).toBeNull()
    expect(resolveNotificationRoute('RECORDING_FAILED', empty, 'INSTRUCTOR', NOW)).toBeNull()
  })
})
