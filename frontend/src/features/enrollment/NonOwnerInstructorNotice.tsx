import type { CourseDetailResponse } from '@/features/curriculum/types'

interface NonOwnerInstructorNoticeProps {
  detail: CourseDetailResponse
  onEnroll: () => void
  isEnrolling: boolean
}

export default function NonOwnerInstructorNotice({ detail, onEnroll, isEnrolling }: NonOwnerInstructorNoticeProps) {
  const canEnroll = detail.viewerContext.allowedActions.includes('ENROLL')

  return (
    <div className="relation-panel non-owner-instructor-notice">
      <h2>다른 강사가 운영하는 커리큘럼이에요</h2>
      {canEnroll ? (
        <>
          <p>강사 계정으로도 이 커리큘럼을 수강할 수 있어요.</p>
          <button className="button button--primary" type="button" onClick={onEnroll} disabled={isEnrolling}>
            {isEnrolling ? '신청 중' : '수강 신청'}
          </button>
        </>
      ) : (
        <p>이 커리큘럼은 강사 계정으로 수강할 수 없어요.</p>
      )}
    </div>
  )
}
