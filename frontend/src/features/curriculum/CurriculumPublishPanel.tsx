import { InlineNotice, Panel, StatusBadge } from '@/shared/ui/WorkspaceUi'

export interface CurriculumLifecycleView {
  tone: 'warning' | 'success' | 'neutral'
  label: string
  description: string
}

interface CurriculumPublishPanelProps {
  /** 아직 공개된 적 없는 초안인지. 게시 버튼의 의미가 여기서 갈린다. */
  isNewDraft: boolean
  lifecycleView: CurriculumLifecycleView
  draftLessonCount: number
  publishedLessonCount: number
  totalLessonCount: number
  /** 커리큘럼 PUBLISHED AND 게시된 강의 1개 이상(ADR-0002). */
  isPubliclyVisible: boolean
  onPublish: (includeLessons: boolean) => void
}

/**
 * 게시 카드. 구성 탭 맨 아래에서 "기본 정보 → 구성 → 게시" 흐름을 닫는다.
 *
 * <p>공개 = 커리큘럼 PUBLISHED AND 강의 PUBLISHED(ADR-0002). 무엇이 공개될지 먼저 알리고,
 * 주 버튼 하나로 그 상태에 도달하게 한다 — 두 번 눌러야 공개되는 흐름은 만들지 않는다.
 */
export default function CurriculumPublishPanel({
  isNewDraft,
  lifecycleView,
  draftLessonCount,
  publishedLessonCount,
  totalLessonCount,
  isPubliclyVisible,
  onPublish,
}: CurriculumPublishPanelProps) {
  return (
    <Panel title="커리큘럼 게시" description="기본 정보와 구성을 모두 확인한 뒤 마지막으로 공개합니다.">
      {isNewDraft && draftLessonCount > 0 && (
        <InlineNotice tone="info">
          게시하면 초안 강의 <strong>{draftLessonCount}개</strong>도 함께 공개됩니다
          {publishedLessonCount > 0 && `(이미 게시된 ${publishedLessonCount}개 포함 총 ${totalLessonCount}개)`}.
          일부만 공개하려면 먼저 위 목록에서 해당 강의를 정리해 주세요.
        </InlineNotice>
      )}
      {!isNewDraft && draftLessonCount > 0 && (
        <InlineNotice tone="warning">
          초안 강의 <strong>{draftLessonCount}개</strong>는 아직 공개 목차에 보이지 않습니다.
          수강생에게 보이려면 함께 게시해 주세요.
        </InlineNotice>
      )}
      <div className="lifecycle-actions lifecycle-actions--standalone">
        <div>
          {/* 공개는 두 축의 AND다(ADR-0002) — PUBLISHED라도 게시된 강의가 0이면 보이는 게 없다. */}
          <StatusBadge tone={isPubliclyVisible ? 'success' : lifecycleView.tone}>
            {lifecycleView.label}
          </StatusBadge>
          <p>{`커리큘럼 ${lifecycleView.label} · 게시된 강의 ${publishedLessonCount}/${totalLessonCount}개 — ${lifecycleView.description}`}</p>
        </div>
        <div className="lifecycle-actions__buttons">
          {/*
            일부 강의를 초안으로 남겨 두고 먼저 공개하는 우회로. 주 동선은 오른쪽 버튼 하나다.
            게시된 강의가 하나도 없으면 목차가 빈 커리큘럼이 공개되므로 이 우회로를 열지 않는다.
          */}
          {isNewDraft && draftLessonCount > 0 && publishedLessonCount > 0 && (
            <button className="button button--ghost" type="button" onClick={() => onPublish(false)}>
              커리큘럼만 게시
            </button>
          )}
          <button
            className="button button--primary"
            type="button"
            disabled={!isNewDraft && draftLessonCount === 0}
            onClick={() => onPublish(true)}
          >
            {isNewDraft
              ? draftLessonCount > 0 ? `강의 ${draftLessonCount}개와 함께 게시` : '커리큘럼 게시'
              : draftLessonCount > 0 ? `초안 강의 ${draftLessonCount}개 게시` : '게시 완료'}
          </button>
        </div>
      </div>
    </Panel>
  )
}
