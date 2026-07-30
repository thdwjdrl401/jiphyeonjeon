import { useId, useState } from 'react'
import type { AiAnswerSource } from '@/features/live-session/liveSessionService'
import { formatStreamElapsed, shortenSourceId } from './aiAnswer'

/**
 * AI 답변의 근거 목록(LIVE.md §10.1 `sources`).
 *
 * **기본은 접혀 있다.** 370px 사이드바에 턴이 쌓이는 구조에서 근거를 항상 펼쳐 두면 카드 한 장이
 * 답변 본문만큼 자리를 먹어, 스크롤이 근거로 채워진다 — 일반 챗 UI의 인용 표시처럼 `근거 n`
 * 한 줄만 두고 필요할 때 펼친다(ADR-0049 §8). 펼침 상태는 이 컴포넌트의 로컬 상태라 **턴별로 독립**이고,
 * 대화가 길어져도 기본값은 전부 접힘이다.
 *
 * 근거는 여전히 **표시 전용**이다. `CAPTION` 근거의 `startMs`/`endMs`는 STT attempt-local 축이라
 * 영상 위치(세션-ms)와 다른 축이고, 이 값으로 seek을 걸면 엉뚱한 지점으로 간다 —
 * 눌러서 이동하는 기능은 시간 앵커 공유 계약이 선 뒤다(ADR-0043·0045·0047 §9).
 * 그래서 항목은 button이 아니라 li로 두고, 왜 못 가는지를 **펼친 목록 아래에 한 번만** 밝힌다.
 */
export default function AiEvidenceList({ sources }: { sources: AiAnswerSource[] }) {
  const [isExpanded, setExpanded] = useState(false)
  const panelId = useId()
  // 근거 없는 턴에는 토글도 두지 않는다 — 눌러도 빈 목록만 나오는 버튼은 잡음이다.
  if (sources.length === 0) return null
  const hasCaptionSource = sources.some((source) => source.type === 'CAPTION')

  return (
    <div className="ai-evidence-block">
      <button
        aria-controls={panelId}
        aria-expanded={isExpanded}
        className="ai-evidence-toggle"
        onClick={() => setExpanded((expanded) => !expanded)}
        type="button"
      >
        <i aria-hidden="true" />
        근거 {sources.length}
      </button>
      {/* 접혀도 DOM에 남긴다 — aria-controls가 가리키는 대상이 사라지면 참조가 끊긴다.
          `hidden`이라 접근성 트리·시각 양쪽에서 함께 빠진다. */}
      <div className="ai-evidence-panel" hidden={!isExpanded} id={panelId}>
        <ul className="ai-evidence">
          {sources.map((source) => source.type === 'PPTX'
            ? (
              <li className="evidence-card" key={`pptx-${source.materialId}-${source.page}`}>
                <strong>{source.page}쪽</strong>
                <span className="evidence-card__kind">강의 자료</span>
                {/* 계약에 자료 제목이 없어 UUID뿐이다 — 쪽수를 앞세우고 ID는 줄여 꼬리에 붙인다. */}
                <span className="evidence-card__id" title={source.materialId}>
                  {shortenSourceId(source.materialId)}
                </span>
              </li>
            )
            : (
              <li className="evidence-card" key={`caption-${source.sttSessionId}-${source.startMs}-${source.endMs}`}>
                <strong>{formatStreamElapsed(source.startMs)}–{formatStreamElapsed(source.endMs)}</strong>
                <span className="evidence-card__kind">강의 발화</span>
                <span className="evidence-card__id" title={source.sttSessionId}>
                  {shortenSourceId(source.sttSessionId)}
                </span>
              </li>
            ))}
        </ul>
        {hasCaptionSource && (
          <small className="ai-evidence__note">
            발화 근거의 시각은 STT 스트림 기준이라 영상 위치와 다를 수 있어 이동을 제공하지 않습니다.
          </small>
        )}
      </div>
    </div>
  )
}
