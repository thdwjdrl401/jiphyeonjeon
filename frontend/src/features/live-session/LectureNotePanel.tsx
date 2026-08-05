import { useLayoutEffect, useRef, useState } from 'react'
import NoteMarkdown from './NoteMarkdown'
import type { LectureNoteView } from './liveSessionService.interface'

/** 하단에서 이만큼 안쪽이면 "읽는 중"으로 보고 강제로 끌어내리지 않는다(채팅·AI 패널과 같은 값). */
const FOLLOW_THRESHOLD_PX = 48

/**
 * AI가 자막에서 만든 주제별 강의 노트(CONTRACT §3-4a).
 *
 * <p><b>서버가 준 것만 그린다.</b> 이 자리에는 오래 하드코딩된 예시 텍스트가 들어 있었다 — 실제 강의와
 * 무관한 내용이 그럴듯하게 보여서, 노트 기능이 동작하지 않는다는 사실이 가려졌다.
 *
 * <p><b>주제 하나 = `<details>` 하나.</b> 본문(`keyPoints`)은 서버가 준 Markdown 조각이라 그대로
 * `NoteMarkdown`에 맡긴다 — 예전에는 `<ul><li>`로 직접 그려서 계약이 허용하는 굵게·인라인 코드가
 * `**이렇게**` 글자로 남았다. 주제 개수·본문은 구조화 필드(`topics`)에서 뽑는다 — `markdown`(전체
 * 이어붙인 본문)과는 같은 값에서 나온 두 표현이라 어긋나지 않는 것이 계약이다.
 *
 * <p>여러 주제를 동시에 펼쳐 둘 수 있다(상호 배타 아코디언이 아니다) — 강의가 길어지면 주제도
 * 여럿이라, 하나를 열면 나머지가 접히는 방식은 비교하며 읽는 사람에게 불편하다.
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
  /*
   * 빈 판정은 <b>본문</b>으로 한다. topics만 보면, 구조화 필드는 왔는데 Markdown이 비어 있는
   * 어긋난 상태에서 "3개 주제"라는 머리말 아래 아무것도 없는 화면이 나온다.
   */
  const markdown = (note?.markdown ?? '').trim()

  const listRef = useRef<HTMLDivElement>(null)
  const [isFollowingLatest, setIsFollowingLatest] = useState(true)
  /*
   * 주제별 <details>는 그대로 비제어(uncontrolled)로 둔다 — 눌러서 접고 펴는 평범한 동작에는
   * 리렌더가 필요 없다. "모두 접기/펼치기"만 이 맵으로 모든 요소를 한 번에 직접 건드린다.
   */
  const detailsRefs = useRef(new Map<string, HTMLDetailsElement>())
  const setDetailsRef = (key: string) => (el: HTMLDetailsElement | null) => {
    if (el) detailsRefs.current.set(key, el)
    else detailsRefs.current.delete(key)
  }
  const setAllTopicsOpen = (open: boolean) => {
    detailsRefs.current.forEach((el) => { el.open = open })
  }

  const scrollToLatest = () => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
    setIsFollowingLatest(true)
  }

  const handleScroll = () => {
    const list = listRef.current
    if (!list) return
    const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight
    setIsFollowingLatest(distanceFromBottom <= FOLLOW_THRESHOLD_PX)
  }

  // 새 주제·정리 중 표시가 늘면(채팅·AI 패널과 같은 규칙) 바닥에 붙어 있을 때만 따라간다.
  useLayoutEffect(() => {
    if (!isFollowingLatest) return
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [isFollowingLatest, markdown, note?.status])

  return (
    <div className="side-panel-content summary-panel" {...panelProps}>
      <header className="learning-panel-heading">
        <div>
          <strong>AI 실시간 강의 노트</strong>
          <small>자막에서 주제를 뽑아 정리합니다.</small>
        </div>
        <div className="lecture-note-heading__actions">
          {topics.length > 0 && (
            <div className="lecture-note-toolbar">
              <button type="button" onClick={() => setAllTopicsOpen(true)}>모두 펼치기</button>
              <button type="button" onClick={() => setAllTopicsOpen(false)}>모두 접기</button>
            </div>
          )}
          <span>{topics.length}개 주제</span>
        </div>
      </header>

      <div className="scroll-pane">
        <div className="lecture-note-list" ref={listRef} onScroll={handleScroll}>
          {markdown === ''
            ? (
              <p className="summary-empty">
                {live
                  ? '아직 정리된 노트가 없습니다. 강의가 진행되면 주제별로 채워집니다.'
                  : '이 강의에서는 노트가 만들어지지 않았습니다.'}
              </p>
            )
            : topics.length > 0
              ? topics.map((topic, index) => {
                const key = topic.topicId ?? `${index}-${topic.title}`
                return (
                  <details className="lecture-note-topic" key={key} ref={setDetailsRef(key)} open>
                    <summary><h3>{topic.title}</h3></summary>
                    <NoteMarkdown markdown={topic.keyPoints.map((point) => `- ${point}`).join('\n')} />
                  </details>
                )
              })
              // topics는 비었는데 markdown만 있는 어긋난 상태(계약상 없어야 하지만) — 빈 화면보다는 통짜로라도 보여준다.
              : <NoteMarkdown markdown={markdown} />}

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

        {topics.length > 0 && !isFollowingLatest && (
          <div className="latest-jump">
            <button type="button" onClick={scrollToLatest}>↓ 최근 노트로 이동</button>
          </div>
        )}
      </div>
    </div>
  )
}
