import { instructorPaths, publicPaths, studentPaths } from '@/app/router/paths'
import type { UserRole } from '@/features/auth/types'
import { LESSON_MATERIALS_ANCHOR } from '@/features/lesson/lessonRouting'
import { isLiveEntryOpen } from '@/features/live-session/liveEntry'
import type { NotificationTargetState, NotificationType } from './types'

/**
 * 알림 클릭 목적지 계산.
 *
 * <p><b>알림 데이터에 프론트 경로를 담지 않는다.</b> 알림은 "무슨 일이 일어났는가(type)"와
 * "무엇에 대해서인가(리소스 id)"만 저장하고, 어느 화면으로 갈지는 <b>누르는 순간</b> 이 함수가
 * 정한다. 그래서 라우트를 바꿔도 이미 쌓인 알림이 깨지지 않고, 역할과 라이브 진행 상태에 따라
 * 같은 알림이 다른 화면으로 갈 수 있다.
 *
 * <p>목적지를 정할 수 없으면 `null`을 돌려준다 — 그럴듯한 화면으로 대충 보내지 않는다. 호출자는
 * 이동하지 않고 안내를 띄운다.
 */
export function resolveNotificationRoute(
  type: NotificationType,
  state: NotificationTargetState,
  role: UserRole,
  now = Date.now(),
): string | null {
  const isInstructor = role === 'INSTRUCTOR'

  switch (type) {
    case 'ENROLLMENT_REQUESTED':
      // 커리큘럼 관리 → 수강생 탭 → 승인 대기 필터 → 해당 신청자 강조까지 한 링크에 담는다.
      if (!isInstructor || !state.curriculumId) return null
      return instructorPaths.curriculumManage(state.curriculumId, {
        tab: 'enrollees',
        enrollmentStatus: 'PENDING',
        highlightEnrollmentId: state.enrollmentId ?? undefined,
      })

    case 'ENROLLMENT_APPROVED':
    case 'ENROLLMENT_REJECTED':
      /*
        커리큘럼 상세로 보낸다. 승인이면 목차와 "이어 학습하기"가 그 화면에 있고, 거절이면
        신청 결과와 재신청 여부를 같은 화면에서 확인한다 — 승인/거절을 다른 화면으로 보내면
        결과를 확인하는 자리가 두 곳으로 갈린다.
      */
      return state.curriculumId ? publicPaths.curriculum(state.curriculumId) : null

    case 'LESSON_PUBLISHED':
      return lessonDetailPath(state, role)

    case 'MATERIAL_PUBLISHED': {
      // 강의 상세의 자료 영역까지 데려간다(자료 전용 화면·탭이 따로 없다).
      const path = lessonDetailPath(state, role)
      return path ? `${path}#${LESSON_MATERIALS_ANCHOR}` : null
    }

    case 'LIVE_SCHEDULED':
    case 'LIVE_STARTING_SOON':
    case 'LIVE_SCHEDULE_CHANGED':
      return liveEntryPath(state, role, now)

    case 'LIVE_CANCELED':
      // 세션은 사라졌으니 입장 화면이 아니라 강의 상세(일정 정보)로 보낸다.
      return lessonDetailPath(state, role)

    case 'RECORDING_READY':
      if (!isInstructor) return null
      /*
        녹화본이 재생 가능한 상태면 검수(다시보기 관리) 화면으로, 아직 자산이 없으면 처리 현황으로
        보낸다 — 없는 영상의 검수 화면을 열면 빈 플레이어만 남는다.
      */
      if (state.lessonId && state.replayStatus && state.replayStatus !== 'NOT_READY') {
        return instructorPaths.replay(state.lessonId)
      }
      return state.liveSessionId ? instructorPaths.processing(state.liveSessionId) : null

    case 'RECORDING_FAILED':
      // 실패는 재생할 것이 없다. 무엇이 어디까지 진행됐는지 보이는 처리 현황으로 보낸다.
      if (!isInstructor) return null
      return state.liveSessionId ? instructorPaths.processing(state.liveSessionId) : null

    case 'VOD_PUBLISHED':
      if (!state.lessonId) return null
      return isInstructor ? instructorPaths.replay(state.lessonId) : studentPaths.replay(state.lessonId)
  }
}

function lessonDetailPath(state: NotificationTargetState, role: UserRole) {
  if (!state.curriculumId || !state.sectionId || !state.lessonId) return null
  return role === 'INSTRUCTOR'
    ? instructorPaths.lesson(state.curriculumId, state.sectionId, state.lessonId)
    : studentPaths.lesson(state.curriculumId, state.sectionId, state.lessonId)
}

/**
 * 라이브 알림의 목적지. 입장 가능 시간인지에 따라 갈린다(요구사항 §6).
 *
 * <p>학생을 강의실로 바로 보내지 않는다 — 강의실은 입장 전 점검을 통과했다는 표시를 요구하므로
 * (`RequireStudentPrejoinRoute`) 직접 들어가면 점검 화면으로 되돌려진다. 알림은 점검 화면까지만
 * 데려가고, 강의실 진입은 그 화면이 맡는다.
 */
function liveEntryPath(state: NotificationTargetState, role: UserRole, now: number) {
  const entryOpen = state.liveSessionStatus
    ? isLiveEntryOpen({ status: state.liveSessionStatus, scheduledAt: state.scheduledAt }, now)
    : false

  if (entryOpen && state.liveSessionId) {
    return role === 'INSTRUCTOR'
      ? instructorPaths.preflight(state.liveSessionId)
      : studentPaths.prejoin(state.liveSessionId)
  }

  if (role === 'STUDENT' && state.curriculumId && state.lessonId) {
    // 입장 전에는 일정과 준비물을 안내하는 화면이 따로 있다.
    return studentPaths.liveUpcoming(state.curriculumId, state.lessonId)
  }

  return lessonDetailPath(state, role)
}
