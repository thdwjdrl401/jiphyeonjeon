import type { UserRole } from '@/features/auth/types'
import type { NotificationActionStatus, NotificationSeverity, NotificationType } from './types'

/**
 * 알림 종류를 사람이 훑을 수 있는 분류로 접는다. 종류는 12개지만 목록에서 구별해야 하는 축은
 * 그보다 적다 — 배지에 `ENROLLMENT_REQUESTED` 같은 코드를 그대로 보여 주지 않는다.
 */
export const NOTIFICATION_CATEGORY_LABEL: Record<NotificationType, string> = {
  ENROLLMENT_REQUESTED: '수강 신청',
  ENROLLMENT_APPROVED: '수강 승인',
  ENROLLMENT_REJECTED: '수강 신청',
  LIVE_SCHEDULED: '라이브 일정',
  LIVE_STARTING_SOON: '라이브 임박',
  LIVE_SCHEDULE_CHANGED: '일정 변경',
  LIVE_CANCELED: '일정 취소',
  LESSON_PUBLISHED: '새 강의',
  MATERIAL_PUBLISHED: '학습 자료',
  RECORDING_READY: '녹화',
  RECORDING_FAILED: '녹화 오류',
  VOD_PUBLISHED: '다시보기',
}

/**
 * 태그 필터 하나. `types`가 여러 개인 이유는 <b>라벨이 같은 종류를 한 칩으로 묶기</b> 때문이다 —
 * `수강 신청`은 신청(`ENROLLMENT_REQUESTED`)과 거절(`ENROLLMENT_REJECTED`) 둘을 덮는다. 목록 배지가
 * 그 둘을 같은 말로 부르는데 칩을 둘로 쪼개면 어느 칩이 어느 배지인지 알 수 없다.
 */
export interface NotificationCategoryFilter {
  label: string
  types: NotificationType[]
  /** 지금 불러온 목록에서 이 칩에 해당하는 알림 수. 0이면 화면이 칩을 흐리게 낸다. */
  count: number
}

/**
 * 이 종류를 <b>받는 역할</b>. 서버의 팬아웃·접근 규칙에서 옮겨 온 표다 —
 * `NotificationFanoutWorker.INSTRUCTOR_TYPES`(녹화 둘은 강사에게만),
 * `NotificationAccessRule`(수강 판정은 학생), 그리고 mock의 발행 함수(수강 신청은 커리큘럼 소유 강사).
 *
 * <p>이 표가 있어야 역할마다 칩 구성이 달라진다. 강사에게 `학습 자료`·`다시보기` 칩을 보여 주면
 * 받을 일이 없는 종류를 계속 확인하게 되고, 학생에게 `녹화 오류` 칩은 아무 뜻이 없다.
 *
 * <p><b>라이브 임박은 양쪽이 받는다.</b> 학생은 수업을 놓치지 않기 위해, 강사는 방송 준비 시간을
 * 확보하기 위해서다(리드타임 설정도 두 역할에 모두 열려 있다).
 */
const NOTIFICATION_AUDIENCE: Record<NotificationType, readonly UserRole[]> = {
  ENROLLMENT_REQUESTED: ['INSTRUCTOR'],
  ENROLLMENT_APPROVED: ['STUDENT'],
  ENROLLMENT_REJECTED: ['STUDENT'],
  LIVE_SCHEDULED: ['STUDENT'],
  LIVE_STARTING_SOON: ['STUDENT', 'INSTRUCTOR'],
  LIVE_SCHEDULE_CHANGED: ['STUDENT'],
  LIVE_CANCELED: ['STUDENT'],
  LESSON_PUBLISHED: ['STUDENT'],
  MATERIAL_PUBLISHED: ['STUDENT'],
  RECORDING_READY: ['INSTRUCTOR'],
  RECORDING_FAILED: ['INSTRUCTOR'],
  VOD_PUBLISHED: ['STUDENT'],
}

/**
 * 그 역할이 받는 <b>모든</b> 종류를 칩으로 만든다. 0건인 칩도 남기고 `count: 0`으로 알린다 —
 * 화면은 그것을 흐리게 그려서, 아직 받은 적 없는 종류까지 "어떤 알림이 오는 화면인가"를 보여 준다.
 *
 * <p>`role`을 주지 않으면 모든 종류를 만든다. 역할을 아직 모르는 순간(로그인 정보 로딩)에 칩이
 * 사라졌다 나타나지 않게 하려는 것이다.
 *
 * <p><b>역할 표에 없어도 실제로 받은 종류는 칩으로 만든다.</b> 표는 서버 규칙을 베껸 것이라 언제든
 * 어긋날 수 있는데, 그때 칩이 없으면 목록에 보이는 알림을 좁힐 방법이 사라진다.
 *
 * <p>0건 칩을 눌러도 막지 않는다. 칩 건수는 <b>지금까지 불러온</b> 목록에서 센 값이라 다음 페이지에
 * 있는 종류는 0으로 보이는데, 막아 버리면 실제로 있는 알림을 고를 수 없다.
 *
 * <p>순서는 `NOTIFICATION_CATEGORY_LABEL`의 선언 순서를 따른다. 들어온 알림 순서로 만들면 새 알림이
 * 올 때마다 칩이 자리를 바꿔, 방금 누르려던 칩이 옮겨 간다.
 */
export function buildCategoryFilters(
  types: readonly NotificationType[],
  role?: UserRole,
): NotificationCategoryFilter[] {
  const counts = new Map<NotificationType, number>()
  for (const type of types) counts.set(type, (counts.get(type) ?? 0) + 1)

  const byLabel = new Map<string, NotificationCategoryFilter>()
  for (const type of Object.keys(NOTIFICATION_CATEGORY_LABEL) as NotificationType[]) {
    const forThisRole = !role || NOTIFICATION_AUDIENCE[type].includes(role)
    if (!forThisRole && !counts.has(type)) continue

    const label = NOTIFICATION_CATEGORY_LABEL[type]
    const existing = byLabel.get(label)
    if (existing) {
      existing.types.push(type)
      existing.count += counts.get(type) ?? 0
    } else {
      byLabel.set(label, { label, types: [type], count: counts.get(type) ?? 0 })
    }
  }
  return [...byLabel.values()]
}

export type NotificationBadgeTone = 'neutral' | 'success' | 'warning' | 'danger'

/**
 * 처리 축의 표시. `INFO`는 배지를 내지 않는다 — 안내성 알림이 대부분이라 전부에 배지를 붙이면
 * 정작 내가 처리해야 할 줄이 묻힌다.
 *
 * <p>`처리 대기 → 처리 완료`로 <b>짝을 맞춘 이름</b>을 쓴다. 한때 `확인 필요 / 처리 완료`였는데 같은
 * 축의 두 값이 서로 다른 낱말("확인"·"처리")을 쓰면 같은 축인지 읽히지 않았다. "대기"는 승인·검수처럼
 * 내 행동을 기다리는 상태를 뜻하고, 그 행동을 하면 "완료"로 넘어간다.
 */
export const ACTION_STATUS_BADGE: Record<
  NotificationActionStatus,
  { label: string; tone: NotificationBadgeTone } | null
> = {
  INFO: null,
  ACTION_REQUIRED: { label: '처리 대기', tone: 'warning' },
  COMPLETED: { label: '처리 완료', tone: 'success' },
  EXPIRED: { label: '만료됨', tone: 'neutral' },
}

/** 처리 대기 알림을 모아 보는 탭·필터의 이름. 배지와 같은 낱말을 쓴다. */
export const ACTION_REQUIRED_LABEL = ACTION_STATUS_BADGE.ACTION_REQUIRED!.label

export function severityBadgeTone(severity: NotificationSeverity): NotificationBadgeTone | null {
  if (severity === 'ERROR') return 'danger'
  if (severity === 'HIGH') return 'warning'
  return null
}

const dayFormatter = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' })

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * 발생 시각 표기. 최근 것은 상대 시간("12분 전")이 알림 목록에서 훑기 쉽고, 오래된 것은
 * "9일 전"보다 날짜가 낫다. 7일을 경계로 바꾼다.
 */
export function formatNotificationTime(createdAt: string, now = Date.now()) {
  const created = new Date(createdAt).getTime()
  if (!Number.isFinite(created)) return ''

  const elapsed = now - created
  // 시계 차이로 미래가 되는 경우(서버·클라 시각 어긋남)를 "방금"으로 흡수한다.
  if (elapsed < MINUTE) return '방금 전'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}분 전`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}시간 전`
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}일 전`
  return dayFormatter.format(created)
}

/** 대상이 사라진 알림을 눌렀을 때의 안내. 기술적인 이유가 아니라 사용자가 할 수 있는 판단을 적는다. */
export const GONE_REASON_MESSAGE = {
  TARGET_DELETED: '삭제되었거나 더 이상 접근할 수 없는 알림입니다.',
  ACCESS_REVOKED: '더 이상 접근할 수 없는 알림입니다. 수강 상태가 변경되었을 수 있습니다.',
  TARGET_EXPIRED: '처리 가능 기간이 지난 알림입니다.',
} as const
