import type { LectureNoteView } from './liveSessionService.interface'

/**
 * AI가 자막에서 만든 주제별 강의 노트(CONTRACT §3-4a).
 *
 * <p><b>서버가 준 것만 그린다.</b> 이 자리에는 오래 하드코딩된 예시 텍스트가 들어 있었다 — 실제 강의와
 * 무관한 내용이 그럴듯하게 보여서, 노트 기능이 동작하지 않는다는 사실이 가려졌다.
 *
 * <p>구간 시각(seek)이 없다. AI가 주는 노트에는 자막 진행도(`coveredThroughSequence`)만 있고 세션 상대
 * ms가 없어, 시각을 만들어 붙이면 엉뚱한 지점으로 보내게 된다. 시간 앵커 계약이 서면 그때 붙인다.
 */
interface Props {
  note: LectureNoteView | null
  /** 라이브가 아직 진행 중인가. 끝났으면 "더 만들어지는 중" 안내를 지운다. */
  live: boolean
  panelProps?: Record<string, unknown>
}

export default function LectureNotePanel({ note, live, panelProps }: Props) {
  const topics = note?.topics ?? []

  return (
    <div className="side-panel-content summary-panel" {...panelProps}>
      <header className="learning-panel-heading">
        <div>
          <strong>AI 실시간 강의 노트</strong>
          <small>자막에서 주제를 뽑아 정리합니다.</small>
        </div>
        <span>{topics.length}개 주제</span>
      </header>

      {topics.length === 0
        ? (
          <p className="summary-empty">
            {live
              ? '아직 정리된 노트가 없습니다. 강의가 진행되면 주제별로 채워집니다.'
              : '이 강의에서는 노트가 만들어지지 않았습니다.'}
          </p>
        )
        : (
          <div className="summary-block-list">
            {topics.map((topic, index) => (
              <article key={topic.topicId ?? `${topic.title}-${index}`}>
                <h3>{topic.title}</h3>
                <ul>{topic.keyPoints.map((point) => <li key={point}>{point}</li>)}</ul>
              </article>
            ))}
          </div>
        )}

      {/* 정제본으로 바뀐 뒤에는 더 자라지 않는다 — 계속 기다리게 두면 안 된다. */}
      {live && note?.status === 'CAPTURING' && (
        <div className="summary-generating">
          <i />
          <span><strong>다음 구간을 정리하고 있어요</strong><small>완성되면 새 주제로 추가됩니다.</small></span>
        </div>
      )}
      {note?.status === 'REFINED' && (
        <p className="summary-empty">강의가 끝나 노트를 한 번 더 정리했습니다.</p>
      )}
    </div>
  )
}
