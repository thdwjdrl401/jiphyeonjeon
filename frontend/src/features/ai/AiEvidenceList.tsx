import type { AiAnswerSource } from '@/features/live-session/liveSessionService'
import { formatStreamElapsed } from './aiAnswer'

/**
 * AI 답변의 근거 카드 목록(LIVE.md §10.1 `sources`).
 *
 * 근거는 **표시 전용**이다. `CAPTION` 근거의 `startMs`/`endMs`는 STT attempt-local 축이라
 * 영상 위치(세션-ms)와 다른 축이고, 이 값으로 seek을 걸면 엉뚱한 지점으로 간다 —
 * 눌러서 이동하는 기능은 시간 앵커 공유 계약이 선 뒤다(ADR-0043·0045·0047 §9).
 * 그래서 카드는 button이 아니라 li로 두고, 왜 못 가는지를 목록 아래에 한 번만 밝힌다.
 */
export default function AiEvidenceList({ sources }: { sources: AiAnswerSource[] }) {
  if (sources.length === 0) return null
  const hasCaptionSource = sources.some((source) => source.type === 'CAPTION')

  return (
    <>
      <ul className="ai-evidence">
        {sources.map((source) => source.type === 'PPTX'
          ? (
            <li className="evidence-card" key={`pptx-${source.materialId}-${source.page}`}>
              <span>강의 자료</span>
              <strong>{source.page}쪽</strong>
              <p>자료 {source.materialId}</p>
            </li>
          )
          : (
            <li className="evidence-card" key={`caption-${source.sttSessionId}-${source.startMs}-${source.endMs}`}>
              <span>강의 발화</span>
              <strong>{formatStreamElapsed(source.startMs)}–{formatStreamElapsed(source.endMs)}</strong>
              <p>자막 스트림 {source.sttSessionId}</p>
            </li>
          ))}
      </ul>
      {hasCaptionSource && (
        <small className="ai-evidence__note">
          발화 근거의 시각은 STT 스트림 기준이라 영상 위치와 다를 수 있어 이동을 제공하지 않습니다.
        </small>
      )}
    </>
  )
}
