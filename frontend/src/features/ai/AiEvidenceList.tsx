import { useId, useState } from 'react'
import type { AiAnswerSource } from '@/features/live-session/liveSessionService'
import { formatStreamElapsed } from './aiAnswer'

/**
 * 발췌문 한 조각. 길이 제한 없이 전문을 그대로 보여준다.
 * 값이 없으면 <b>아무것도 그리지 않는다</b> — 빈 줄이 카드 높이만 늘린다.
 */
function Excerpt({ text }: { text?: string }) {
  if (!text) return null
  return <p className="evidence-card__excerpt">{text}</p>
}

/**
 * 화면에 내보내지 않을 근거 종류.
 *
 * <p>`CAPTION`을 뺀다 — 자막은 STT 원문이라 오인식이 그대로 근거로 보이고, 답변이 실제로 기댄 것보다
 * 목록을 길게 만든다. 서버·AI는 계속 보내고 **화면만 감춘다**.
 *
 * <p><b>거르는 자리는 여기 하나다.</b> 근거는 라이브 SSE·다시보기 SSE·서버 기록 복원 세 경로로 들어오는데
 * 그 각각에서 걸러 내면 한 곳을 빠뜨렸을 때 어디선가만 다시 보인다. 여기서 거르면 `근거 n` 개수도
 * 저절로 맞는다 — 감춘 것을 세면 펼쳤을 때 개수와 목록이 어긋난다.
 */
const HIDDEN_SOURCE_TYPES: ReadonlySet<AiAnswerSource['type']> = new Set(['CAPTION'])

/**
 * AI 답변의 근거 목록(LIVE.md §10.1 `sources`).
 *
 * **기본은 접혀 있다.** 370px 사이드바에 턴이 쌓이는 구조에서 근거를 항상 펼쳐 두면 카드 한 장이
 * 답변 본문만큼 자리를 먹어, 스크롤이 근거로 채워진다 — 일반 챗 UI의 인용 표시처럼 `근거 n`
 * 한 줄만 두고 필요할 때 펼친다(ADR-0049 §8). 펼침 상태는 이 컴포넌트의 로컬 상태라 **턴별로 독립**이고,
 * 대화가 길어져도 기본값은 전부 접힘이다.
 *
 * 항목의 본문은 서버가 함께 보내 주는 **발췌문**이다. 예전에는 이 자리에 `materialId`를 줄여
 * 붙였는데, UUID는 읽는 사람에게 아무 의미가 없다 — 무엇을 근거로 답했는지 알 수 없으면 근거를
 * 보여 주는 뜻이 없다. 발췌문은 계약상 **선택 필드**라 옛 답변에는 없을 수 있고, 그때는 쪽수·시각만
 * 남긴다(UUID를 되살리지 않는다).
 *
 * 자막 근거의 **이동 가능 여부는 시간축이 정한다**(`timeAxis`).
 * - `PLAYBACK` — 플레이어와 같은 축이다(Replay v2: 업로드 녹화강의·라이브 다시보기 모두). `onSeek`이
 *   있으면 눌러서 그 지점으로 옮길 수 있다.
 * - 미지정 — 라이브(v1)의 STT attempt-local 축이라 누르면 엉뚱한 지점으로 간다. 표시만 하고 왜 못
 *   가는지 목록 아래에 한 번 밝힌다.
 *
 * **지금은 자막 근거를 보여 주지 않는다**(`HIDDEN_SOURCE_TYPES`). 아래 자막 렌더 분기는 그대로 두어
 * 되돌릴 때 한 줄이면 되게 한다.
 */
export default function AiEvidenceList({
  sources,
  onSeek,
}: {
  sources: AiAnswerSource[]
  /** 세션-ms 근거를 눌렀을 때 영상을 옮긴다. 없으면 모든 근거가 표시 전용이다. */
  onSeek?: (sessionMs: number) => void
}) {
  const [isExpanded, setExpanded] = useState(false)
  const panelId = useId()
  const visible = sources.filter((source) => !HIDDEN_SOURCE_TYPES.has(source.type))
  /*
   * 근거 없는 턴에는 토글도 두지 않는다 — 눌러도 빈 목록만 나오는 버튼은 잡음이다.
   * <b>거른 뒤에 판단한다.</b> 자막만 있던 답변은 이제 근거가 하나도 없는 것과 같아, 원본이 비어
   * 있는지가 아니라 보여 줄 것이 남았는지를 봐야 한다.
   */
  if (visible.length === 0) return null
  const hasApproximateCaptionSource = visible.some(
    (source) => source.type === 'CAPTION' && source.timeAxis !== 'PLAYBACK',
  )

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
        근거 {visible.length}
      </button>
      {/* 접혀도 DOM에 남긴다 — aria-controls가 가리키는 대상이 사라지면 참조가 끊긴다.
          `hidden`이라 접근성 트리·시각 양쪽에서 함께 빠진다. */}
      <div className="ai-evidence-panel" hidden={!isExpanded} id={panelId}>
        <ul className="ai-evidence">
          {visible.map((source) => source.type === 'PPTX'
            ? (
              <li className="evidence-card" key={`pptx-${source.materialId}-${source.page}`}>
                <strong>{source.page}쪽</strong>
                <span className="evidence-card__kind">강의 자료</span>
                <Excerpt text={source.excerpt} />
              </li>
            )
            : source.type === 'ANNOTATION'
            ? (
              <li className="evidence-card" key={`annotation-${source.highlightId}`}>
                {/* sessionMs는 다시보기 축(ADR-0043 §6)이라 v2에서만 이동을 준다. */}
                {source.timeAxis === 'PLAYBACK' && onSeek
                  ? (
                    <button className="evidence-card__seek" onClick={() => onSeek(source.sessionMs)} type="button">
                      {formatStreamElapsed(source.sessionMs)}
                    </button>
                  )
                  : <strong>{formatStreamElapsed(source.sessionMs)}</strong>}
                <span className="evidence-card__kind">강사 강조</span>
                <Excerpt text={source.excerpt} />
              </li>
            )
            : (
              <li className="evidence-card" key={`caption-${source.sttSessionId}-${source.startMs}-${source.endMs}`}>
                {/* 플레이어와 같은 축(timeAxis=PLAYBACK)일 때만 이동을 준다. STT 스트림 축은 눌러도
                    엉뚱한 지점으로 가므로 예전처럼 표시만 한다. */}
                {source.timeAxis === 'PLAYBACK' && onSeek
                  ? (
                    <button className="evidence-card__seek" onClick={() => onSeek(source.startMs)} type="button">
                      {formatStreamElapsed(source.startMs)}–{formatStreamElapsed(source.endMs)}
                    </button>
                  )
                  : <strong>{formatStreamElapsed(source.startMs)}–{formatStreamElapsed(source.endMs)}</strong>}
                <span className="evidence-card__kind">강의 발화</span>
                <Excerpt text={source.excerpt} />
              </li>
            ))}
        </ul>
        {hasApproximateCaptionSource && (
          <small className="ai-evidence__note">
            발화 근거의 시각은 STT 스트림 기준이라 영상 위치와 다를 수 있어 이동을 제공하지 않습니다.
          </small>
        )}
      </div>
    </div>
  )
}
