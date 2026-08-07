import { InlineNotice, Panel, StatusBadge } from '@/shared/ui/WorkspaceUi'
import type { CurriculumPublishReadiness } from './publishPreconditions'

export interface CurriculumLifecycleView {
  tone: 'warning' | 'success' | 'neutral'
  label: string
  description: string
}

interface CurriculumPublishPanelProps {
  /** 아직 공개된 적 없는 초안인지. 게시 안내를 띄울지 여기서 갈린다. */
  isNewDraft: boolean
  lifecycleView: CurriculumLifecycleView
  totalLessonCount: number
  /** 게시 선행 조건 판정(ADR-0006). 못 채웠으면 버튼을 잠그고 사유를 그대로 보여 준다. */
  readiness: CurriculumPublishReadiness
  /** 공개 중인지. 커리큘럼 lifecycleStatus만으로 결정된다(ADR-0005). */
  isPubliclyVisible: boolean
  onPublish: () => void
  /** 공개를 내린다(보관). 되돌릴 수 있다 — 서버가 ARCHIVED에서 다시 공개를 받는다. */
  onArchive: () => void
  /** 전환 요청이 날아가 있는 동안 true. 스위치를 잠그고 돌아가는 표시를 띄운다. */
  isChangingVisibility: boolean
  /** 초안(DRAFT)만 삭제할 수 있다 — 공개된 적 있으면 서버가 409로 막는다(ADR-0001). */
  canDelete: boolean
  isDeleting: boolean
  onDelete: () => void
}

/**
 * 게시 카드. 구성 탭 맨 아래에서 "기본 정보 → 구성 → 게시" 흐름을 닫는다.
 *
 * <p>공개 축은 커리큘럼 하나다(ADR-0005) — 강의는 만들어지는 순간 게시 상태이므로 이 버튼을
 * 누르면 커리큘럼과 그 안의 강의가 함께 공개된다. 예전에는 강의 축이 따로 있어 "게시 강의 5/5인데
 * 공개 0" 같은 막다른 상태와 '커리큘럼만 게시' 우회로가 필요했다(ADR-0002).
 */
export default function CurriculumPublishPanel({
  isNewDraft,
  lifecycleView,
  totalLessonCount,
  readiness,
  isPubliclyVisible,
  onPublish,
  onArchive,
  isChangingVisibility,
  canDelete,
  isDeleting,
  onDelete,
}: CurriculumPublishPanelProps) {
  return (
    <Panel title="커리큘럼 게시" description="기본 정보와 구성을 모두 확인한 뒤 마지막으로 공개합니다.">
      {/*
        비활성 사유는 버튼 tooltip에만 두지 않는다 — 터치 기기와 스크린리더에서는 tooltip에 닿기
        어렵다. 카드 안 인접 안내로 같은 문장을 함께 보여 준다.
      */}
      {isNewDraft && (
        <InlineNotice tone={readiness.canPublish ? 'info' : 'warning'}>
          {readiness.canPublish
            ? <>게시하면 이 커리큘럼의 강의 <strong>{totalLessonCount}개</strong>가 모두 수강생에게 공개됩니다.</>
            : readiness.reason}
        </InlineNotice>
      )}
      <div className="lifecycle-actions lifecycle-actions--standalone">
        <div>
          <StatusBadge tone={isPubliclyVisible ? 'success' : lifecycleView.tone}>
            {lifecycleView.label}
          </StatusBadge>
          <p>{`커리큘럼 ${lifecycleView.label} · 강의 ${totalLessonCount}개 — ${lifecycleView.description}`}</p>
        </div>
        <div className="lifecycle-actions__buttons">
          {/*
            공개 여부를 스위치 하나로 다룬다. 켜면 공개(publish), 끄면 내림(archive)이고 둘 다
            되돌릴 수 있다 — 서버가 ARCHIVED에서 다시 공개를 받는다.

            **낙관적으로 그리지 않는다.** 스위치는 서버가 확인해 준 상태(isPubliclyVisible)만
            비추고, 요청이 날아가 있는 동안에는 잠근 채 돌아가는 표시를 띄운다. 누른 순간 켜 놓고
            나중에 되돌리면, 실패했는데 성공한 것처럼 보이는 순간이 생긴다.
          */}
          <button
            className="visibility-switch"
            type="button"
            role="switch"
            aria-checked={isPubliclyVisible}
            aria-busy={isChangingVisibility}
            aria-label="커리큘럼 공개"
            disabled={isChangingVisibility || (!isPubliclyVisible && !readiness.canPublish)}
            title={!isPubliclyVisible && !readiness.canPublish ? readiness.reason ?? undefined : undefined}
            onClick={isPubliclyVisible ? onArchive : onPublish}
          >
            {/*
              라벨은 <b>조작 대상</b>을 가리킨다("공개"). 현재 상태는 옆의 상태 배지와 aria-checked가
              말한다 — 라벨까지 "공개 중"으로 쓰면 같은 글자가 화면에 두 번 나와 어느 쪽이 버튼인지
              흐려진다.
            */}
            <span className="visibility-switch__label">
              {isChangingVisibility
                ? (isPubliclyVisible ? '내리는 중…' : '공개하는 중…')
                : '공개'}
            </span>
            <span className="visibility-switch__track" aria-hidden="true">
              {isChangingVisibility
                ? <span className="visibility-switch__spinner" />
                : <span className="visibility-switch__thumb" />}
            </span>
          </button>
        </div>
      </div>

      {/* 게시와 삭제 모두 커리큘럼 상태를 바꾸는 동작이라 이 카드에 모아 둔다. 되돌릴 수 없는 쪽을 아래에. */}
      {canDelete && (
        <div className="curriculum-danger-zone">
          <div>
            <strong>커리큘럼 삭제</strong>
            <p>섹션과 강의도 함께 사라지며 되돌릴 수 없어요. 공개한 뒤에는 삭제할 수 없습니다.</p>
          </div>
          <button className="button button--ghost button--danger" type="button" disabled={isDeleting} onClick={onDelete}>
            {isDeleting ? '삭제 중' : '커리큘럼 삭제'}
          </button>
        </div>
      )}
    </Panel>
  )
}
