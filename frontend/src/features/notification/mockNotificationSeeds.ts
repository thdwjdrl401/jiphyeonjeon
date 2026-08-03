import { MOCK_INSTRUCTOR_ID, MOCK_STUDENT_ID } from '@/features/demo/mockDatabase'
import { notificationMessage, notificationTitle } from './mockNotificationCopy'
import {
  completeRecordingReview,
  publishEnrollmentDecided,
  publishEnrollmentRequested,
  publishLessonPublished,
  publishLiveScheduleChanged,
  publishLiveStartingSoon,
  publishMaterialPublished,
  publishRecordingFailed,
  publishRecordingReady,
  publishVodPublished,
} from './mockNotificationEvents'
import {
  appendMockNotification,
  clearMockNotifications,
  markMockNotificationRead,
} from './mockNotificationStore'

/**
 * 로그인 직후에도 알림 센터가 비어 있지 않게 하는 초기 데이터.
 *
 * <p><b>이벤트 발행 함수를 그대로 쓴다</b> — 문구·수신자·중복 키를 seed가 따로 만들면 실제 사건으로
 * 생기는 알림과 모양이 갈린다. seed는 "그 사건이 과거에 일어났다"를 시각만 바꿔 재생하는 것이다.
 *
 * <p>그래서 seed는 mock 커리큘럼·수강 상태에서 파생된다. `cur-spring-live`의 담당 강사는
 * `MOCK_INSTRUCTOR_ID`이고 `MOCK_STUDENT_ID`는 세 커리큘럼에 ACTIVE로 수강 중이다 — 수신자 판정을
 * seed가 우회하지 않으므로, 수강 상태를 바꾸면 알림도 같이 바뀐다.
 */
function seedInstructorNotifications() {
  // 처리 대기 중인 수강 신청(usr-student-02 → cur-spring-live). 읽지 않음 + 처리 대기.
  publishEnrollmentRequested('enr-spring-pending-02', '2026-07-21T09:31:00+09:00')

  /*
    이미 판정이 끝난 신청. "읽음이지만 처리 완료"가 목록에서 어떻게 보이는지 남겨 둔다 —
    읽음과 처리 축이 붙어 있으면 이 조합이 화면에 나타날 수 없다.
  */
  const decided = publishEnrollmentRequested('enr-spring-revoked-03', '2026-06-20T09:31:00+09:00')
  publishEnrollmentDecided('enr-spring-revoked-03', 'APPROVED', '2026-06-21T11:00:00+09:00')
  if (decided) markMockNotificationRead(decided.notificationId, '2026-06-21T10:58:00+09:00')

  // 녹화 처리 완료(아직 검수 안 함) / 녹화 처리 실패. 둘 다 강사가 할 일이 남은 알림이다.
  publishRecordingReady('ses-cur-spring-live-2', '2026-07-29T21:41:00+09:00')
  publishRecordingFailed('ses-cur-spring-live-8', '2026-07-30T21:52:00+09:00')

  /*
    이미 검수를 마친 녹화. 처리 완료 이력이 목록에 남는 모습을 보여 준다.
    (cur-spring-live 1강은 다시보기가 공개된 상태다 — buildLessonAvailability 참고.)
  */
  publishRecordingReady('ses-cur-spring-live-1', '2026-07-25T08:40:00+09:00')
  completeRecordingReview('les-orientation', '2026-07-25T09:10:00+09:00')

  // 오늘 진행할 라이브. 실제 서버에서는 예약 작업이 만든다(mock에는 스케줄러가 없다).
  publishLiveStartingSoon(MOCK_INSTRUCTOR_ID, 'les-security', '2026-08-01T08:00:00+09:00')
}

function seedStudentNotifications() {
  // 수강 승인 결과(이미 읽음).
  const approved = publishEnrollmentDecided('enr-react-active', 'APPROVED', '2026-07-06T10:00:00+09:00')
  if (approved) markMockNotificationRead(approved.notificationId, '2026-07-06T10:20:00+09:00')

  // 새 강의·자료 공개.
  publishLessonPublished('les-service-layer', '2026-07-27T15:00:00+09:00')
  publishLessonPublished('cur-data-story-lesson-3', '2026-07-28T09:00:00+09:00')
  publishMaterialPublished('les-security', 'mat-les-security-01', '2026-07-28T11:00:00+09:00')

  // 다시보기 공개. 실제로 학생에게 공개된 강의(replayStatus=PUBLISHED)만 고른다.
  publishVodPublished('les-orientation', '2026-07-25T09:20:00+09:00')
  const readVod = publishVodPublished('cur-data-story-lesson-1', '2026-07-24T20:00:00+09:00')
  readVod
    .filter((record) => record.recipientId === MOCK_STUDENT_ID)
    .forEach((record) => markMockNotificationRead(record.notificationId, '2026-07-24T21:00:00+09:00'))
  publishVodPublished('cur-react-system-lesson-1', '2026-07-26T18:00:00+09:00')
  /*
    읽지 않은 알림이 한 페이지(8건)를 넘게 둔다 — 기본 탭이 `읽지 않음`이라, 여기서 한 페이지를
    채우지 못하면 `더 보기`가 데모에서 한 번도 나타나지 않아 페이지네이션을 눈으로 볼 수 없다.
  */
  publishVodPublished('cur-react-system-lesson-7', '2026-07-26T09:00:00+09:00')
  publishMaterialPublished('cur-data-story-lesson-3', 'mat-data-story-03', '2026-07-27T09:00:00+09:00')

  // 일정 변경(변경 전·후를 함께 보여 준다) + 오늘 시작하는 라이브.
  publishLiveScheduleChanged(
    'les-security',
    { previousStartsAt: '2026-08-01T19:00:00+09:00', nextStartsAt: '2026-08-03T19:00:00+09:00' },
    '2026-07-30T10:00:00+09:00',
  )
  publishLiveStartingSoon(MOCK_STUDENT_ID, 'les-session', '2026-08-01T08:05:00+09:00')

  /*
    대상이 사라진 알림. 알림은 남았지만 강의가 삭제된 상태를 재현한다 — 눌렀을 때 엉뚱한 화면으로
    가거나 오류가 나지 않고 "더 이상 접근할 수 없다"고 안내되는지 화면에서 바로 확인할 수 있어야
    한다. 이 조합은 이벤트 발행으로 만들 수 없다(발행 시점에는 대상이 살아 있으므로).
  */
  appendMockNotification({
    recipientId: MOCK_STUDENT_ID,
    type: 'MATERIAL_PUBLISHED',
    title: notificationTitle('MATERIAL_PUBLISHED'),
    message: notificationMessage('MATERIAL_PUBLISHED', { lessonTitle: '삭제된 보충 강의' }),
    targets: {
      curriculumId: 'cur-spring-live',
      sectionId: 'sec-foundation',
      lessonId: 'les-removed-demo',
      materialId: 'mat-removed-demo',
    },
    dedupeResource: 'les-removed-demo:mat-removed-demo',
    createdAt: '2026-07-23T13:00:00+09:00',
  })
}

/**
 * 다른 강사의 커리큘럼에서 일어난 수강 신청(`cur-sql`은 usr-instructor-06 소유).
 *
 * <p>같은 저장소에 들어 있어도 데모 강사의 알림 목록에는 <b>나타나지 않아야</b> 한다. seed가
 * 수신자 판정을 우회하지 않는다는 사실을 화면에서 바로 확인할 수 있는 자리다.
 */
function seedOtherInstructorNotifications() {
  publishEnrollmentRequested('enr-sql-pending', '2026-07-18T09:01:00+09:00')
}

export function resetMockNotificationStore() {
  clearMockNotifications()
  seedInstructorNotifications()
  seedStudentNotifications()
  seedOtherInstructorNotifications()
}

resetMockNotificationStore()
