import type { NotificationScheduleChange, NotificationType } from './types'

/**
 * 알림 제목·본문 문구. <b>서버가 소유하는 값</b>이므로 화면 코드가 아니라 mock 구현체 쪽에 둔다 —
 * 실제 서버가 `title`·`message`를 내려주면 이 파일만 쓰이지 않게 되고 화면은 그대로다.
 *
 * <p>제목은 "무슨 일이 일어났는가", 본문은 "누구의 무엇인가"로 나눈다. 드롭다운이 좁아 본문을
 * 한 줄로 줄여야 할 때 제목만 남겨도 뜻이 통해야 한다.
 */
const titles: Record<NotificationType, string> = {
  ENROLLMENT_REQUESTED: '새로운 수강 신청이 있습니다.',
  ENROLLMENT_APPROVED: '수강 신청이 승인되었습니다.',
  ENROLLMENT_REJECTED: '수강 신청이 승인되지 않았습니다.',
  LIVE_SCHEDULED: '라이브 강의가 예정되어 있습니다.',
  LIVE_STARTING_SOON: '곧 라이브 강의가 시작됩니다.',
  LIVE_SCHEDULE_CHANGED: '라이브 일정이 변경되었습니다.',
  LIVE_CANCELED: '라이브 강의가 취소되었습니다.',
  LESSON_PUBLISHED: '새로운 강의가 공개되었습니다.',
  MATERIAL_PUBLISHED: '새로운 학습 자료가 등록되었습니다.',
  RECORDING_READY: '라이브 강의 녹화가 완료되었습니다.',
  RECORDING_FAILED: '라이브 강의 녹화 확인이 필요합니다.',
  VOD_PUBLISHED: '다시보기 강의가 공개되었습니다.',
}

export function notificationTitle(type: NotificationType) {
  return titles[type]
}

const dateTimeFormatter = new Intl.DateTimeFormat('ko-KR', {
  month: 'long',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

const timeFormatter = new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit' })

export function formatScheduleDateTime(isoDate: string) {
  return dateTimeFormatter.format(new Date(isoDate))
}

export function formatScheduleTime(isoDate: string) {
  return timeFormatter.format(new Date(isoDate))
}

interface MessageInput {
  studentName?: string
  curriculumTitle?: string
  lessonTitle?: string
  scheduledAt?: string | null
  scheduleChange?: NotificationScheduleChange | null
}

/**
 * 알림 본문. 사용자에게 <b>내부 오류 메시지나 스택을 노출하지 않는다</b> — 녹화 실패는
 * "확인이 필요하다"까지만 알리고, 실패 코드는 강사가 볼 녹화 처리 화면에서 다룬다.
 */
export function notificationMessage(type: NotificationType, input: MessageInput): string {
  const curriculum = input.curriculumTitle ? `‘${input.curriculumTitle}’` : '해당 커리큘럼'
  const lesson = input.lessonTitle ? `‘${input.lessonTitle}’` : '해당 강의'

  switch (type) {
    case 'ENROLLMENT_REQUESTED':
      return `${input.studentName ?? '수강생'} 님이 ${curriculum} 수강을 신청했습니다.`
    case 'ENROLLMENT_APPROVED':
      return `${curriculum}을 수강할 수 있습니다.`
    case 'ENROLLMENT_REJECTED':
      return `${curriculum} 수강 신청 결과를 확인해주세요.`
    case 'LIVE_SCHEDULED':
      return input.scheduledAt
        ? `${formatScheduleDateTime(input.scheduledAt)} · ${input.lessonTitle ?? '라이브 강의'}`
        : `${lesson}의 라이브 일정이 등록되었습니다.`
    case 'LIVE_STARTING_SOON':
      return input.scheduledAt
        ? `${formatScheduleTime(input.scheduledAt)} · ${input.lessonTitle ?? '라이브 강의'}`
        : `${lesson}이 곧 시작됩니다.`
    case 'LIVE_SCHEDULE_CHANGED':
      return input.scheduleChange
        ? `${lesson} · ${formatScheduleDateTime(input.scheduleChange.previousStartsAt)} → ${formatScheduleDateTime(input.scheduleChange.nextStartsAt)}`
        : `${lesson}의 라이브 일정이 변경되었습니다.`
    case 'LIVE_CANCELED':
      return `${lesson}의 라이브 일정이 취소되었습니다.`
    case 'LESSON_PUBLISHED':
      return `${lesson} 강의를 확인해보세요.`
    case 'MATERIAL_PUBLISHED':
      return `${lesson} 강의 자료를 확인해보세요.`
    case 'RECORDING_READY':
      return `${lesson} 녹화본을 확인하고 다시보기 공개 상태를 점검해주세요.`
    case 'RECORDING_FAILED':
      return `${lesson}의 녹화 처리 중 문제가 발생했습니다. 처리 현황을 확인해주세요.`
    case 'VOD_PUBLISHED':
      return `${lesson} 강의를 다시 시청할 수 있습니다.`
  }
}
