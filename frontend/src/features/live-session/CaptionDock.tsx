import { Fragment, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { captionDisplayLabel, captionSeekMs } from './captionAdapter'
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
  /**
   * 재생 중인 source의 `availableFromMs`(미디어 시각 0이 가리키는 세션 시각).
   *
   * <p>넘기면 라벨을 <b>플레이어와 같은 미디어 축</b>으로 보여 준다. 이동·노출은 세션 축 그대로이고
   * 보이는 숫자만 맞춘다 — 안 맞추면 같은 순간에 자막과 컨트롤바가 다른 시각을 띄운다.
   */
  availableFromMs?: number | null
  /** 헤더 힌트를 대체하는 안내(예: 라이브 자막 연결 상태). 없으면 기본 힌트를 보인다. */
  note?: string
  /** 강사가 경계를 끌어 정한 높이(px). 없으면 CSS 기본값을 쓴다. */
  heightPx?: number
  /**
   * 접었다 펼 수 있게 한다. 넘기면 헤더가 버튼이 되고, 접힌 동안은 <b>헤더만</b> 남는다.
   *
   * <p>넘기지 않으면 예전 그대로 항상 펼쳐진 독이다 — 수강생 화면은 자막을 보러 온 화면이라
   * 접을 이유가 없고, 높이는 경계 손잡이로 조절한다.
   */
  onToggleCollapse?: () => void
  collapsed?: boolean
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
  onToggleCollapse,
  collapsed = false,
  availableFromMs = null,
}: CaptionDockProps) {
  // 헤더 prop `label`과 이름이 겹치지 않게 timeLabel로 둔다.
  const timeLabel = (caption: CaptionView) => captionDisplayLabel(caption, availableFromMs)
  const sentencesRef = useRef<HTMLDivElement>(null)
  /*
   * 새 자막이 들어오면 최신(하단)으로 따라간다 — 단, <b>이미 바닥에 붙어 있을 때만</b>(라이브
   * 채팅창과 같은 패턴, LearningSidebar의 DiscussionPanel 참고). 조건 없이 따라가면 위로 올려
   * 지난 자막을 읽는 동안 다음 자막이 도착할 때마다 아래로 끌려 내려가, 사실상 되돌아볼 수 없다.
   *
   * 사용자가 스크롤을 올리면 따라가기를 멈추고 "최근 자막으로 이동" 버튼을 보인다 — 멈췄다는
   * 사실과 되돌아갈 방법을 눈에 보이게 준다. ref가 아니라 state인 이유도 그 버튼을 그리기
   * 위해서다(ref 변경은 리렌더를 일으키지 않는다).
   *
   * 바닥 판정에 여유를 두는 것은 소수점 높이·확대 배율에서 scrollTop이 정확히 맞아떨어지지 않기
   * 때문이다. 한 줄 높이보다 작게 잡아야 "한 줄 올려둔 상태"를 바닥으로 오해하지 않는다.
   */
  const [isFollowingLatest, setIsFollowingLatest] = useState(true)
  const scrollToLatest = useCallback(() => {
    const el = sentencesRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    setIsFollowingLatest(true)
  }, [])
  const handleScroll = () => {
    const el = sentencesRef.current
    if (!el) return
    setIsFollowingLatest(el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK_PX)
  }
  /*
   * 아래 effect의 트리거는 `captions` 배열 자체가 아니라 이 서명(revision)이어야 한다.
   *
   * 호출부(LiveClassroomPage)는 재생 위치(positionMs)가 바뀔 때마다 selectVisibleCaptions·
   * attachGlossary를 다시 돌리는데, 이 둘은 실제 내용이 그대로여도 매번 새 배열을 만든다(.filter/.map).
   * positionMs는 영상 timeupdate마다 바뀌므로 이 새 배열도 초당 여러 번 만들어진다.
   *
   * effect가 배열 참조로 반응하면, 사용자가 위로 스크롤해 지난 자막을 읽는 동안에도 이 잦은
   * 재생성 때문에 계속 재실행된다. 실제로 "새 자막이 생겼다"고 볼 수 있는 변화만 이 서명에
   * 담는다 — 개수, 마지막 줄의 식별자, 길이(스트리밍 중 자라는 문장), pending 여부(확정 전환).
   * 내용이 같으면 서명도 같아 배열이 몇 번을 새로 만들어져도 effect가 다시 돌지 않는다.
   */
  const lastCaption = captions.length > 0 ? captions[captions.length - 1] : null
  const captionsRevision = `${captions.length}:${lastCaption?.segmentId ?? ''}:${lastCaption?.text.length ?? 0}:${lastCaption?.pending ? 1 : 0}`
  useLayoutEffect(() => {
    if (isFollowingLatest) scrollToLatest()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFollowingLatest, scrollToLatest, captionsRevision])
  const currentIndex = captions.reduce(
    (latest, caption, index) => (caption.startMs <= currentSessionMs ? index : latest),
    -1,
  )
  const hint = note ?? '시간을 누르면 영상과 자막이 함께 이동합니다.'
  return (
    <section
      className={`caption-dock${onToggleCollapse ? ' caption-dock--collapsible' : ''}${collapsed ? ' is-collapsed' : ''}`}
      aria-label={label}
    >
      {/*
        접을 수 있으면 헤더가 곧 손잡이다. 접힌 동안 남는 것이 이 줄뿐이라, 여기 말고는 다시 펼
        자리가 없다 — 1px 경계선만 남기면 접은 사람도 그것이 자막이었다는 것을 잊는다.
      */}
      {onToggleCollapse ? (
        <header>
          <button aria-expanded={!collapsed} className="caption-dock__disclosure" type="button" onClick={onToggleCollapse}>
            <span aria-hidden="true" className="caption-dock__chevron" />
            <strong><i />{label}</strong>
          </button>
          <span>{collapsed ? '눌러서 펼칩니다.' : hint}</span>
        </header>
      ) : (
        <header>
          <strong><i />{label}</strong>
          <span>{hint}</span>
        </header>
      )}
      {!collapsed && (
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
              {/* 라벨은 플레이어와 같은 축으로 보이고, 이동은 세션 축 값으로 건다(captionSeekMs). */}
              {canSeek
                ? <button type="button" onClick={() => onSeek(captionSeekMs(caption))}>{timeLabel(caption)}</button>
                : <time>{timeLabel(caption)}</time>}
              <p>{renderCaptionText(caption, onSelectTerm)}</p>
            </article>
          )
        })}
      </div>
      )}
      {!collapsed && !isFollowingLatest && (
        // 채팅처럼 한 줄을 차지하지 않는다 — 자막 위에 떠 있는 알약으로 둬서 자막 독 높이가
        // 늘었다 줄었다 하지 않는다(자막 영역이 채팅 목록과 달리 flex:1이 아니라 고정 높이라,
        // 아래 붙이면 그만큼 독 전체가 커져 아래 요소를 밀어낸다).
        <div className="latest-jump">
          <button type="button" onClick={scrollToLatest}>↓ 최근 자막으로 이동</button>
        </div>
      )}
    </section>
  )
}
