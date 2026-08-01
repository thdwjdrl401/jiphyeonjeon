import { Fragment, useEffect, useRef } from 'react'
import { captionSeekMs } from './captionAdapter'
import type { CaptionView } from './liveSessionService.interface'

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
}: CaptionDockProps) {
  const sentencesRef = useRef<HTMLDivElement>(null)
  // 새 자막(델타 누적)이 들어오면 최신(하단)으로 따라간다 — 라이브 자막이 시야 밖으로 밀려나지 않게.
  useEffect(() => {
    const el = sentencesRef.current
    if (el) el.scrollTop = el.scrollHeight
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
      <div className="caption-dock__sentences" aria-live="polite" ref={sentencesRef}>
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
