import type { CurriculumLiveSessionStatus, CurriculumReplayStatus } from '@/features/lesson/types'

/**
 * 알림 종류. 문자열을 화면에서 즉석으로 만들지 않고 이 union만 쓴다 — 새 종류가 생기면
 * 제목·문구·아이콘·이동 규칙을 정의한 Record들이 빠진 키를 타입 검사에서 잡아 준다.
 *
 * <p><b>왜 녹화 관련이 두 개(RECORDING_READY·RECORDING_FAILED)뿐인가</b>: 현재 서버는 Egress
 * COMPLETE 하나로 `VideoAssetStatus.READY`와 `ReplayStatus.PUBLISHED`를 <b>같은 트랜잭션에서</b>
 * 저장한다(`RecordingService.markReady`). 즉 "녹화 완료"와 "강사 검수 가능"이 같은 순간이고
 * `READY_FOR_REVIEW`로 가는 코드 경로가 없다. 그래서 "녹화 완료"와 "녹화 강의 준비 완료"를 두 개로
 * 나누지 않고 하나로 합쳤다(요구사항 §9-1의 "동일하면 통합" 규칙).
 */
export type NotificationType =
  | 'ENROLLMENT_REQUESTED'
  | 'ENROLLMENT_APPROVED'
  | 'ENROLLMENT_REJECTED'
  | 'LIVE_SCHEDULED'
  | 'LIVE_STARTING_SOON'
  | 'LIVE_SCHEDULE_CHANGED'
  | 'LIVE_CANCELED'
  | 'LESSON_PUBLISHED'
  | 'MATERIAL_PUBLISHED'
  | 'RECORDING_READY'
  | 'RECORDING_FAILED'
  | 'VOD_PUBLISHED'

/** 읽음 축. 사용자가 알림을 봤는가만 담는다. */
export type NotificationReadStatus = 'UNREAD' | 'READ'

/**
 * 업무 처리 축. 읽음과 <b>합치지 않는다</b> — 강사가 수강 신청 알림을 읽어도 승인·거절을 하지
 * 않았으면 그 일은 남아 있고, 하나로 뭉개면 "처리 대기" 목록을 만들 수 없다.
 */
export type NotificationActionStatus = 'INFO' | 'ACTION_REQUIRED' | 'COMPLETED' | 'EXPIRED'

/** 중요도. 녹화 실패처럼 사용자가 놓치면 안 되는 알림을 목록에서 구분한다. */
export type NotificationSeverity = 'NORMAL' | 'HIGH' | 'ERROR'

/**
 * 알림이 가리키는 리소스들. <b>프론트 라우트 URL을 문자열로 담지 않는다</b> — 경로가 바뀌면
 * 저장된 알림이 전부 깨진다. 이동 목적지는 `type` + 이 ID들 + 조회 시점의 리소스 상태로
 * `notificationRouting`이 계산한다.
 */
export interface NotificationTargets {
  curriculumId?: string
  /** 강의 상세 경로가 섹션을 요구한다(`/…/curriculums/:id/sections/:sectionId/lessons/:lessonId`). */
  sectionId?: string
  lessonId?: string
  liveSessionId?: string
  enrollmentId?: string
  recordingId?: string
  materialId?: string
  /** 이 알림을 유발한 사람(수강 신청한 학생, 자료를 올린 강사 등). */
  actorId?: string
  /** 강사 화면에서 강조할 대상 수강생. `actorId`와 같을 수 있지만 의미가 다르다. */
  studentId?: string
}

/** 일정 변경 알림의 변경 전·후. 변경 알림은 "언제에서 언제로"가 없으면 쓸모가 없다. */
export interface NotificationScheduleChange {
  previousStartsAt: string
  nextStartsAt: string
}

export interface NotificationItem {
  notificationId: string
  recipientId: string
  type: NotificationType
  readStatus: NotificationReadStatus
  actionStatus: NotificationActionStatus
  severity: NotificationSeverity
  title: string
  message: string
  targets: NotificationTargets
  /**
   * 같은 묶음으로 접을 수 있는 알림의 키(`{type}:{curriculumId}` 등). 지금은 개별로 표시하지만,
   * 나중에 "수강 신청 3건"처럼 묶으려면 저장 시점에 이 값이 있어야 한다 — 뒤늦게 붙이면
   * 이미 쌓인 알림은 묶을 수 없다.
   */
  groupKey: string
  createdAt: string
  readAt: string | null
  completedAt: string | null
  scheduleChange: NotificationScheduleChange | null
}

/**
 * 무엇을 볼지 — <b>업무 처리 축</b>의 필터.
 *
 * <p>읽음 여부와 <b>같은 축에 두지 않는다</b>. 둘을 하나의 enum(`ALL|UNREAD|ACTION_REQUIRED`)으로
 * 묶으면 "처리 대기 중 아직 안 읽은 것"을 물어볼 수 없다 — 서로 다른 질문이기 때문이다.
 * 그래서 이 축과 `readState`를 나눠 받고, 둘은 AND로 조합된다.
 */
export type NotificationScope = 'ALL' | 'ACTION_REQUIRED'

/**
 * 어떻게 볼지 — <b>읽음 축</b>의 필터. 생략하면 읽음 여부를 가리지 않는다.
 *
 * <p>불린(`unreadOnly`)이 아니라 enum인 이유: 화면이 `읽지 않음`·`읽음`을 <b>나란한 탭</b>으로 나눠서
 * "읽은 것만" 보는 상태가 따로 있다. 불린으로는 그 상태를 표현할 수 없다(false는 "안 가림"이지
 * "읽은 것만"이 아니다).
 */
export type NotificationReadFilter = 'UNREAD' | 'READ'

export interface NotificationListQuery {
  scope?: NotificationScope
  /** `scope`와 AND로 조합된다(처리 대기 + 읽지 않음). */
  readState?: NotificationReadFilter
  page?: number
  size?: number
}

/**
 * 목록 응답. 개수 두 개를 목록과 <b>같은 응답</b>에 담는다 — 배지와 목록이 서로 다른 요청으로
 * 갈리면 "모두 읽음" 직후 배지만 남거나 목록만 비는 어긋남이 보인다.
 */
export interface NotificationListResponse {
  items: NotificationItem[]
  page: number
  size: number
  totalElements: number
  totalPages: number
  hasNext: boolean
  unreadCount: number
  actionRequiredCount: number
}

/** 헤더 배지 전용 요약. 목록 없이 개수만 폴링한다. */
export interface NotificationSummary {
  unreadCount: number
  actionRequiredCount: number
}

/**
 * 실시간 알림 신호. <b>내용이 아니라 "왔다"는 사실만</b> 온다 — 이걸 받으면 목록과 개수를 다시
 * 읽는다. 알림 한 건의 모양이 REST 응답과 WS 페이로드 두 곳에 생기면 한쪽만 고치는 어긋남이
 * 자라기 때문이다.
 */
export interface NotificationSignal {
  notificationType: NotificationType
  occurredAt: string
}

/**
 * 브라우저가 만든 푸시 구독. `p256dh`·`auth`는 <b>이 브라우저만</b> 페이로드를 열 수 있게 하는
 * 키다 — 푸시 서비스는 내용을 보지 못한다(RFC 8291).
 */
export interface PushSubscriptionInput {
  endpoint: string
  p256dh: string
  auth: string
}

/**
 * 곧 시작 알림의 리드타임 설정.
 *
 * <p>`source`가 값 자체만큼 중요하다 — 값만 주면 사용자는 <b>자기가 어디를 고쳤는지</b> 알 수 없다.
 * 강의 화면에서 30분이 보일 때 그게 이 강의만의 설정인지 커리큘럼 설정이 내려온 것인지 구별해야
 * "이 강의만 다르게" 같은 안내를 할 수 있다.
 */
export interface NotificationPreference {
  enabled: boolean
  leadMinutes: number
  source: 'LESSON' | 'CURRICULUM' | 'DEFAULT'
}

/** 고를 수 있는 리드타임. 자유 입력이 아닌 이유는 서버가 이 값에 맞춰 발화를 미리 예약해 두기 때문이다. */
export interface NotificationLeadTimes {
  choices: number[]
  defaultMinutes: number
}

/** 알림이 가리키는 대상이 사라졌거나 더 이상 열람할 수 없는 이유. */
export type NotificationGoneReason =
  /** 커리큘럼·강의·녹화본이 삭제됐다. */
  | 'TARGET_DELETED'
  /** 수강 취소·제적·강사 변경으로 열람 권한이 사라졌다. */
  | 'ACCESS_REVOKED'
  /** 처리 가능 기간이 지났다(취소된 라이브 등). */
  | 'TARGET_EXPIRED'

/**
 * 클릭 시점의 대상 상태. 알림을 만들 때가 아니라 <b>누를 때</b> 서버가 다시 판정한다 —
 * 생성 당시엔 권한이 있었어도 그 뒤 수강 취소·커리큘럼 삭제로 달라질 수 있다(요구사항 §10).
 */
export interface NotificationTargetState {
  curriculumId: string | null
  sectionId: string | null
  lessonId: string | null
  liveSessionId: string | null
  enrollmentId: string | null
  studentId: string | null
  /** 입장 게이트 판정에 쓴다. `scheduledAt`과 함께 `isLiveEntryOpen`이 소비한다. */
  liveSessionStatus: CurriculumLiveSessionStatus | null
  scheduledAt: string | null
  replayStatus: CurriculumReplayStatus | null
}

export type NotificationTargetResolution =
  | { status: 'AVAILABLE'; state: NotificationTargetState }
  | { status: 'GONE'; reasonCode: NotificationGoneReason }
