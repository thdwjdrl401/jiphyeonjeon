import { Fragment, useEffect, useRef } from 'react'
import { captionSeekMs } from './captionAdapter'
import type { CaptionView } from './liveSessionService.interface'

/** 이만큼 안쪽까지는 "바닥에 붙어 있다"로 본다. 자막 한 줄(약 28px)보다 작아야 한다. */
const BOTTOM_SLACK_PX = 24

interface CaptionDockProps {
  captions: CaptionView[]
  currentSessionMs: number
  label: string
  onSeek: (sessionMs: number) => void
  onSelectTerm: (termId: string) => void
  /** false면 시각을 표시만 하고 HLS seek 요청을 만들지 않는다. */
  canSeek?: boolean
  /** 헤더 힌트를 대체하는 안내(예: 라이브 자막 연결 상태). 없으면 기본 힌트를 보인다. */
  note?: string
  /** 강사가 경계를 끌어 정한 높이(px). 없으면 CSS 기본값을 쓴다. */
  heightPx?: number
}

function renderCaptionText(caption: CaptionView, onSelectTerm: (termId: string) => void) {
  const references = [...caption.termReferences]
    .filter(({ startIndex, endIndex }) => startIndex >= 0 && endIndex > startIndex && endIndex <= caption.text.length)
    .sort((left, right) => left.startIndex - right.startIndex)

  if (references.length === 0) return caption.text

  let cursor = 0
  return (
    <>
      {references.map((reference) => {
        const prefix = caption.text.slice(cursor, reference.startIndex)
        const term = caption.text.slice(reference.startIndex, reference.endIndex)
        cursor = reference.endIndex
        return (
          <Fragment key={`${caption.segmentId}-${reference.termId}-${reference.startIndex}`}>
            {prefix}
            <button className="caption-term" type="button" onClick={() => onSelectTerm(reference.termId)}>{term}</button>
          </Fragment>
        )
      })}
      {caption.text.slice(cursor)}
    </>
  )
}

export default function CaptionDock({
  captions,
  currentSessionMs,
  label,
  onSeek,
  onSelectTerm,
  canSeek = true,
  note,
  heightPx,
}: CaptionDockProps) {
  const sentencesRef = useRef<HTMLDivElement>(null)
  /*
   * 새 자막이 들어오면 최신(하단)으로 따라간다 — 단, <b>이미 바닥에 붙어 있을 때만</b>.
   *
   * 조건 없이 따라가면 위로 올려 지난 자막을 읽는 동안 다음 자막이 도착할 때마다 아래로 끌려
   * 내려가, 사실상 되돌아볼 수 없다. 지금 재생 위치는 `is-current` 하이라이트가 알려주므로
   * 스크롤까지 강제로 붙잡아 둘 이유가 없다.
   *
   * 바닥 판정에 여유를 두는 것은 소수점 높이·확대 배율에서 scrollTop이 정확히 맞아떨어지지 않기
   * 때문이다. 한 줄 높이보다 작게 잡아야 "한 줄 올려둔 상태"를 바닥으로 오해하지 않는다.
   */
  const stickToBottom = useRef(true)
  const handleScroll = () => {
    const el = sentencesRef.current
    if (!el) return
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK_PX
  }
  useEffect(() => {
    const el = sentencesRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [captions])
  const currentIndex = captions.reduce(
    (latest, caption, index) => (caption.startMs <= currentSessionMs ? index : latest),
    -1,
  )
  return (
    <section className="caption-dock" aria-label={label}>
      <header>
        <strong><i />{label}</strong>
        <span>{note ?? '시간을 누르면 영상과 자막이 함께 이동합니다.'}</span>
      </header>
      <div
        className="caption-dock__sentences"
        aria-live="polite"
        ref={sentencesRef}
        style={heightPx ? { height: `${heightPx}px` } : undefined}
        onScroll={handleScroll}
      >
        {captions.length === 0 && (
          // 빈 상태에도 자리를 지킨다. 첫 자막이 도착하며 독이 높아지면 아래 요소가 통째로 밀린다.
          <p className="caption-dock__empty">{note ?? '자막이 도착하면 여기에 표시됩니다.'}</p>
        )}
        {captions.map((caption, index) => {
          // 현재 cue = 재생 위치에 도달한 가장 최근 자막(startMs ≤ positionMs 중 마지막). endMs=startMs라
          // 구간 매칭으로는 거의 안 잡히므로 위치 이하의 마지막 라인을 현재로 본다. 위치 미구동(강사,
          // positionMs=0)이면 currentIndex=-1이라 아무 것도 강조되지 않는다.
          const isCurrent = index === currentIndex
          const className = [isCurrent ? 'is-current' : '', caption.pending ? 'is-pending' : '']
            .filter(Boolean)
            .join(' ')
          return (
            <article className={className} key={caption.segmentId} aria-busy={caption.pending || undefined}>
              {/* 라벨은 자막 시각 그대로 보이되, 이동은 STT 지연을 보정한 지점으로 간다(문장 시작에 닿게). */}
              {canSeek
                ? <button type="button" onClick={() => onSeek(captionSeekMs(caption))}>{caption.at}</button>
                : <time>{caption.at}</time>}
              <p>{renderCaptionText(caption, onSelectTerm)}</p>
            </article>
          )
        })}
      </div>
    </section>
  )
}
