interface InstructorManagementCardProps {
  isInstructor: boolean
  onManage: () => void
}

const CARD_COPY = {
  owner: {
    title: '담당 강사 관리',
    description: '이 커리큘럼을 관리하고 강의를 편성할 수 있어요.',
  },
  nonOwner: {
    title: '다른 강사가 운영하는 커리큘럼이에요',
    description: '이 커리큘럼은 강사 계정으로 수강할 수 없어요.',
  },
} as const

/**
 * 커리큘럼 상세에서 "내가 관리할 수 있는 커리큘럼인가"를 알리는 유일한 카드.
 * 관리 기능이 늘어나도 진입점은 이 카드 하나만 고치면 되도록 액션 영역을 따로 둔다.
 */
export default function InstructorManagementCard({ isInstructor, onManage }: InstructorManagementCardProps) {
  const copy = isInstructor ? CARD_COPY.owner : CARD_COPY.nonOwner

  return (
    <section className="instructor-management-card">
      <div className="instructor-management-card__body">
        <h2>{copy.title}</h2>
        <p>{copy.description}</p>
      </div>
      {isInstructor && (
        <div className="instructor-management-card__actions">
          <button className="button button--primary" type="button" onClick={onManage}>
            관리하기
          </button>
        </div>
      )}
    </section>
  )
}
