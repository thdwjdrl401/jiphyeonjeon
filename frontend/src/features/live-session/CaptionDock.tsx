import { Fragment } from 'react'
import type { CaptionView } from './liveSessionService.interface'

interface CaptionDockProps {
  captions: CaptionView[]
  currentSessionMs: number
  label: string
  onSeek: (sessionMs: number) => void
  onSelectTerm: (termId: string) => void
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

export default function CaptionDock({ captions, currentSessionMs, label, onSeek, onSelectTerm }: CaptionDockProps) {
  return (
    <section className="caption-dock" aria-label={label}>
      <header>
        <strong><i />{label}</strong>
        <span>시간을 누르면 영상과 자막이 함께 이동합니다.</span>
      </header>
      <div className="caption-dock__sentences">
        {captions.map((caption) => {
          const isCurrent = currentSessionMs >= caption.startMs && currentSessionMs <= caption.endMs
          return (
            <article className={isCurrent ? 'is-current' : ''} key={caption.segmentId}>
              <button type="button" onClick={() => onSeek(caption.startMs)}>{caption.at}</button>
              <p>{renderCaptionText(caption, onSelectTerm)}</p>
            </article>
          )
        })}
      </div>
    </section>
  )
}
