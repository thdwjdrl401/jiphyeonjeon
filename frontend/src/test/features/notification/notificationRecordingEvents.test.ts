import { beforeEach, describe, expect, it } from 'vitest'
import { mockAuthService, resetMockAuth } from '@/features/auth/mockAuthService'
import { getProcessingStatus } from '@/features/live-session/liveSessionService'
import { publishRecordingFailed } from '@/features/notification/mockNotificationEvents'
import { getNotifications } from '@/features/notification/notificationService'
import type { NotificationItem, NotificationType } from '@/features/notification/types'
import { publishReplayReview } from '@/features/replay/replayService'

/**
 * 녹화·다시보기 알림.
 *
 * <p>핵심은 두 가지다. (1) 녹화 처리 완료는 <b>강사</b>의 일이고 다시보기 공개는 <b>학생</b>에게
 * 알린다. (2) 같은 이벤트가 다시 들어와도(Egress webhook 재전송, 폴링 반복) 알림이 늘어나지 않는다.
 */
/** 종료된 라이브 + 다시보기 공개 상태인 강의(목차 생성 규칙상 7번째 강의). */
const PUBLISHED_REPLAY_SESSION = 'ses-cur-spring-live-7'
const PUBLISHED_REPLAY_LESSON = 'cur-spring-live-lesson-7'
/** 종료된 라이브지만 아직 학생에게 공개되지 않은 녹화(READY_FOR_REVIEW). */
const UNPUBLISHED_REPLAY_SESSION = 'ses-cur-spring-live-14'
const UNPUBLISHED_REPLAY_LESSON = 'cur-spring-live-lesson-14'

async function loginAsStudent() {
  return mockAuthService.login({ email: 'student@example.com', password: 'password' })
}

async function loginAsInstructor() {
  return mockAuthService.login({ email: 'teacher@liveclass.ai', password: 'password' })
}

async function notificationsOf(type: NotificationType, lessonId: string): Promise<NotificationItem[]> {
  const { items } = await getNotifications({ size: 50 })
  return items.filter((item) => item.type === type && item.targets.lessonId === lessonId)
}

/** mock은 두 번째 조회에서 녹화를 READY로 넘긴다 — 그 전이가 알림의 방아쇠다. */
async function pollUntilReady(sessionId: string, times = 2) {
  for (let attempt = 0; attempt < times; attempt += 1) {
    await getProcessingStatus(sessionId)
  }
}

describe('녹화·다시보기 알림', () => {
  beforeEach(() => {
    resetMockAuth()
  })

  it('녹화 처리가 끝나면 강사에게 확인이 필요한 알림이 생긴다', async () => {
    await loginAsInstructor()
    await pollUntilReady(PUBLISHED_REPLAY_SESSION)

    const [ready] = await notificationsOf('RECORDING_READY', PUBLISHED_REPLAY_LESSON)

    expect(ready).toBeDefined()
    expect(ready.readStatus).toBe('UNREAD')
    expect(ready.actionStatus).toBe('ACTION_REQUIRED')
    expect(ready.targets.liveSessionId).toBe(PUBLISHED_REPLAY_SESSION)
  })

  it('같은 녹화 완료가 다시 들어와도 알림이 중복되지 않는다', async () => {
    await loginAsInstructor()
    // 폴링이 계속 돌아 READY 상태를 여러 번 본다 = 서버 webhook 재전송과 같은 상황.
    await pollUntilReady(PUBLISHED_REPLAY_SESSION, 5)

    expect(await notificationsOf('RECORDING_READY', PUBLISHED_REPLAY_LESSON)).toHaveLength(1)

    await loginAsStudent()
    expect(await notificationsOf('VOD_PUBLISHED', PUBLISHED_REPLAY_LESSON)).toHaveLength(1)
  })

  it('다시보기가 공개된 녹화만 학생 알림을 만든다', async () => {
    await loginAsInstructor()
    await pollUntilReady(UNPUBLISHED_REPLAY_SESSION)

    // 강사에게는 검수할 녹화가 준비됐다고 알린다.
    expect(await notificationsOf('RECORDING_READY', UNPUBLISHED_REPLAY_LESSON)).toHaveLength(1)

    await loginAsStudent()
    // 아직 공개되지 않았으므로 학생에게는 아무 것도 가지 않는다.
    expect(await notificationsOf('VOD_PUBLISHED', UNPUBLISHED_REPLAY_LESSON)).toHaveLength(0)
  })

  it('강사가 다시보기를 게시하면 학생 알림이 생기고 녹화 알림이 처리 완료된다', async () => {
    await loginAsInstructor()
    await pollUntilReady(UNPUBLISHED_REPLAY_SESSION)
    await publishReplayReview(UNPUBLISHED_REPLAY_LESSON)

    const [ready] = await notificationsOf('RECORDING_READY', UNPUBLISHED_REPLAY_LESSON)
    expect(ready.actionStatus).toBe('COMPLETED')
    expect(ready.completedAt).not.toBeNull()

    await loginAsStudent()
    const [vod] = await notificationsOf('VOD_PUBLISHED', UNPUBLISHED_REPLAY_LESSON)
    expect(vod).toBeDefined()
    expect(vod.title).toBe('다시보기 강의가 공개되었습니다.')
    expect(vod.actionStatus).toBe('INFO')
  })

  it('녹화 처리가 실패하면 강사에게 오류 등급의 확인 필요 알림이 생긴다', async () => {
    /*
      mock 처리 흐름은 항상 성공으로 끝나므로(화면 검증용) 실패는 이벤트를 직접 발행해 확인한다.
      실제 서버에서는 Egress webhook의 실패 분기가 이 자리에 온다.
    */
    publishRecordingFailed(UNPUBLISHED_REPLAY_SESSION)

    await loginAsInstructor()
    const [failed] = await notificationsOf('RECORDING_FAILED', UNPUBLISHED_REPLAY_LESSON)

    expect(failed).toBeDefined()
    expect(failed.severity).toBe('ERROR')
    expect(failed.actionStatus).toBe('ACTION_REQUIRED')
    // 내부 오류 코드·스택을 사용자 문구에 노출하지 않는다.
    expect(failed.message).not.toMatch(/[A-Z_]{6,}/)
  })
})
