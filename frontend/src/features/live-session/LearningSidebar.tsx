import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import SearchIcon from '@/shared/ui/SearchIcon'
import Tabs, { tabPanelProps, type TabItem } from '@/shared/ui/Tabs'
import ProfileAvatar from '@/features/profile/ProfileAvatar'
import LectureNotePanel from './LectureNotePanel'
import { selectVisibleMessages } from './replayTimeline'
import type { ChatMessageView, LectureNoteView } from './liveSessionService.interface'
import type { GlossaryTermView, LearningPanel } from './liveLearningPreview'

/** 패널 래퍼를 새로 만들지 않고 기존 .side-panel-content에 그대로 얹는다(flex·스크롤 구조 유지). */
type PanelProps = ReturnType<typeof tabPanelProps>

/**
 * 자막 용어 클릭이 용어집 패널에 "펼치고·스크롤하고·강조하라"고 보내는 명령.
 *
 * `termId`만 들고 있으면 같은 용어를 연달아 눌러도 값이 안 바뀌어(React가 같은 값 setState를
 * 무시한다) 두 번째 클릭이 아무 일도 하지 않는다 — `sequence`를 함께 올려 매번 다른 값이 되게
 * 한다(자막 seek의 `sequence`와 같은 요령, ReplayLessonPage.seekSession 참고).
 */
export interface GlossaryFocusRequest {
  termId: string
  sequence: number
}

interface LearningSidebarProps {
  panel: LearningPanel
  onPanelChange: (panel: LearningPanel) => void
  selectedTermId: string | null
  onSelectedTermChange: (termId: string) => void
  /** 자막에서 용어를 눌렀을 때만 채워진다 — 용어집 목록에서 직접 펼칠 때는 건드리지 않는다. */
  glossaryFocusRequest: GlossaryFocusRequest | null
  /** 서버가 준 강의 노트(CONTRACT §3-4a). 아직 없으면 null — 패널이 비었다고 정직하게 말한다. */
  lectureNote: LectureNoteView | null
  glossaryTerms: GlossaryTermView[]
  messages: ChatMessageView[]
  /** 내가 보낸 말풍선의 header에 alias 대신 표시할 이름(로그인한 내 닉네임). */
  myDisplayName: string
  /**
   * 재생 위치(세션 상대 ms). 주면 그 지점까지 올라온 채팅만 보인다 — 다시보기에서 미래의 질문이
   * 먼저 떠 있지 않게 한다. 라이브처럼 지금이 곧 최신인 화면은 생략한다.
   */
  revealThroughMs?: number | null
  discussionComposer?: ReactNode
  discussionNotice?: string
  aiContent: ReactNode
  noteContext: 'LIVE' | 'REPLAY'
  windowAction?: ReactNode
  /** 화면이 지원하는 패널만 노출한다. 생략하면 라이브·다시보기의 기존 네 탭을 모두 유지한다. */
  availablePanels?: readonly LearningPanel[]
}

const tabs: ReadonlyArray<TabItem<LearningPanel>> = [
  { id: 'discussion', label: '채팅' },
  { id: 'notes', label: '실시간 노트' },
  { id: 'ai', label: 'AI 질문' },
  { id: 'glossary', label: '핵심 용어' },
]

const LEARNING_TAB_PREFIX = 'learning-sidebar'

/**
 * 세션 한정 익명 가명(예: 익명1, ADR-0050·ADR-0023)인지. 서버는 userId도 별도 anonymous 플래그도
 * 보내지 않는다 — alias 하나로만 노출하므로(프라이버시 불변식), 발신자가 익명을 선택했는지는
 * 서버가 실제로 만드는 이 고정 형식(`익명` + 세션 내 등장 순번, ChatService)으로만 구별할 수 있다.
 */
const ANONYMOUS_ALIAS_PATTERN = /^익명\d+$/
function isAnonymousAlias(alias: string) {
  return ANONYMOUS_ALIAS_PATTERN.test(alias)
}

/**
 * 한 번이라도 연 탭을 <b>계속 살려 둔다</b>.
 *
 * <p>예전에는 활성 탭만 그렸다(`{panel === 'ai' && <Panel/>}`). 그러면 탭을 옮기는 순간 패널이
 * 언마운트돼 <b>그 안의 상태가 통째로 사라진다</b> — AI 대화, 진행 중이던 답변 스트림(정리 훅이
 * abort한다), 채팅 스크롤 위치, 용어집 검색어, 쓰다 만 입력까지. 특히 AI 답변은 방금 받은 것이
 * 서버 기록 조회에 아직 없어서, 돌아오면 사라진 것처럼 보였다.
 *
 * <p>그래서 감추기만 한다(`hidden`) — ARIA tabpanel의 표준 방식이기도 하다.
 *
 * <p><b>처음부터 넷 다 그리지는 않는다.</b> 노트 패널은 Markdown 렌더러를 지연 로드하므로,
 * 열지도 않은 탭 때문에 그 청크를 받게 된다. 연 적 있는 탭만 남긴다.
 */
function useVisitedPanels(active: LearningPanel) {
  const [visited, setVisited] = useState<ReadonlySet<LearningPanel>>(() => new Set([active]))
  useEffect(() => {
    setVisited((current) => (current.has(active) ? current : new Set(current).add(active)))
  }, [active])
  // 활성 탭은 방금 바뀌었어도 이번 렌더에서 바로 그려야 한다(effect는 렌더 뒤에 돈다).
  return useCallback(
    (panel: LearningPanel) => panel === active || visited.has(panel),
    [active, visited],
  )
}

/** 하단에서 이만큼 안쪽이면 "읽는 중"으로 보고 강제로 끌어내리지 않는다(AI 질문 패널과 같은 값). */
const CHAT_FOLLOW_THRESHOLD_PX = 48

function DiscussionPanel({ messages, myDisplayName, revealThroughMs, composer, notice, panelProps }: { messages: ChatMessageView[]; myDisplayName: string; revealThroughMs?: number | null; composer?: ReactNode; notice?: string; panelProps: PanelProps }) {
  const [isFollowingLatest, setIsFollowingLatest] = useState(true)
  const chatListRef = useRef<HTMLDivElement>(null)
  // 직전 렌더가 남긴 스크롤 높이(아래 layout effect에서 "이 갱신 전에 바닥에 있었는가"를 재는 기준).
  const previousScrollHeightRef = useRef(0)
  // 재생 위치까지 올라온 것만 남긴다 — 다시보기에서 미래의 채팅이 먼저 떠 있지 않게 한다.
  const visibleMessages = useMemo(
    () => selectVisibleMessages(messages, revealThroughMs ?? null),
    [messages, revealThroughMs],
  )
  /** 위치로 자른 결과가 빈 것과, 애초에 채팅이 없던 것은 다른 상황이다. 문구를 나눈다. */
  const isTrimmedEmpty = visibleMessages.length === 0 && messages.length > 0

  const scrollToLatest = useCallback(() => {
    const chatList = chatListRef.current
    if (!chatList) return
    chatList.scrollTop = chatList.scrollHeight
    setIsFollowingLatest(true)
  }, [])

  const handleChatScroll = () => {
    const chatList = chatListRef.current
    if (!chatList) return
    const distanceFromBottom = chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight
    setIsFollowingLatest(distanceFromBottom <= CHAT_FOLLOW_THRESHOLD_PX)
    // 실제 스크롤이 있었던 순간의 높이로도 기준을 맞춰 둔다 — 마운트 이후 한 번도 새 메시지가
    // 오지 않은 채로 시간이 지나면(레이아웃이 바뀌는 등) 아래 effect의 기준이 낡을 수 있다.
    previousScrollHeightRef.current = chatList.scrollHeight
  }

  /*
   * 새 메시지를 따라 하단으로 붙는다. 위로 올려 읽는 중이면 건드리지 않는다 — 단, 그 판정을
   * isFollowingLatest(state) 대신 DOM의 실제 scrollTop으로 직접 잰다(AI 질문 패널과 같은 이유 —
   * 'scroll' 이벤트 지연으로 인한 경합을 피한다).
   *
   * 예외가 하나 있다: 목록의 마지막 메시지가 <b>내가 막 보낸 것</b>이면 지금 스크롤 위치와
   * 무관하게 바닥으로 붙는다 — 전송은 "지금 여기를 보여 달라"는 명시적 요청이다(위로 올려 지난
   * 대화를 읽던 중이었어도, 방금 내가 보낸 말풍선은 보여야 한다).
   */
  useLayoutEffect(() => {
    const chatList = chatListRef.current
    if (!chatList) return
    const lastMessage = visibleMessages[visibleMessages.length - 1]
    const wasAtBottom = chatList.scrollTop + chatList.clientHeight >= previousScrollHeightRef.current - CHAT_FOLLOW_THRESHOLD_PX
    if (wasAtBottom || lastMessage?.mine) {
      chatList.scrollTop = chatList.scrollHeight
      // scrollTop을 코드로 옮기는 것만으로는 'scroll' 이벤트가 (제때) 오지 않는다 — 버튼 표시가
      // 이 스크롤과 어긋나지 않도록 상태도 바로 맞춘다.
      setIsFollowingLatest(true)
    }
    previousScrollHeightRef.current = chatList.scrollHeight
  }, [visibleMessages])

  return (
    <div className="side-panel-content discussion-panel" {...panelProps}>
      <div className="scroll-pane">
        <div className="chat-list" ref={chatListRef} onScroll={handleChatScroll}>
          {visibleMessages.length > 0
            ? visibleMessages.map((item) => {
                /*
                 * 이름은 <b>남들에게 보이는 그대로</b> 쓴다.
                 *
                 * <p>예전에는 내 메시지만 `myDisplayName`으로 갈아 끼웠다. 그래서 익명으로 보내도
                 * 내 말풍선에는 <b>내 이름</b>이 떴고, 강사·다른 수강생에게는 `익명3`이 보였다 —
                 * 보내는 사람만 그 사실을 모른다. 익명이 되고 있는지 확인할 방법이 화면에 없었다.
                 *
                 * <p>내 것이라는 표시는 <b>오른쪽 정렬</b>이 이미 하고 있다(`is-mine`). 이름까지
                 * 그 일을 겹쳐 할 이유가 없다.
                 *
                 * <p>서버가 아직 확정하지 않은 낙관적 항목은 alias가 비어 있다 — 그때만 내 이름으로
                 * 메운다. 익명으로 보낸 낙관적 항목은 보내는 쪽이 `익명`을 채워 준다(순번은 서버가
                 * 정하므로 거기까지만 적는다).
                 */
                const displayName = item.alias || myDisplayName
                // 익명 가명은 진짜 이름이 아니므로 이니셜 아바타 대신 "?"로 채운다(ProfileAvatar의
                // 빈 이름 폴백). 내가 보낸 것이어도 마찬가지다 — 익명이면 남들이 보는 것과 같게 둔다.
                const avatarName = isAnonymousAlias(displayName) || displayName === '익명' ? '' : displayName
                return (
                  <article className={item.mine ? 'is-mine' : ''} key={item.id}>
                    {/* 시각은 서버가 확정한 뒤에만 있다(낙관적 항목은 빈 문자열). */}
                    <header>
                      <span className="chat-list__author">
                        <ProfileAvatar className="user-avatar--chat" displayName={avatarName} decorative />
                        <strong>{displayName}</strong>
                      </span>
                      {item.time && <time>{item.time}</time>}
                    </header>
                    <p>{item.text}</p>
                  </article>
                )
              })
            : (
              <p className="panel-empty">
                {isTrimmedEmpty
                  ? '이 지점까지 올라온 채팅이 없습니다. 재생하면 그때의 대화가 여기에 쌓입니다.'
                  : '등록된 채팅이 없습니다.'}
              </p>
            )}
        </div>
        {!isFollowingLatest && (
          <div className="latest-jump">
            <button type="button" onClick={scrollToLatest}>↓ 최근 채팅으로 이동</button>
          </div>
        )}
      </div>
      {notice && <p className="discussion-notice">{notice}</p>}
      {composer}
    </div>
  )
}

/** 자막 용어를 눌렀을 때, 방금 연 항목을 잠깐 테두리로 강조해 두는 시간(ms). CSS 애니메이션 길이와 맞춘다. */
const GLOSSARY_FLASH_MS = 2400

/**
 * 용어 목록. 실시간 노트와 같은 패턴이다 — 용어 하나 = `<details>` 하나, 설명은 그 안에서 펼쳐 본다.
 * 예전에는 목록 아래 카드 하나에 "지금 고른 용어"만 보여줬는데, 자막에서 용어를 눌러도 그 카드가
 * 화면 밖에 있으면 뭐가 바뀌었는지 알기 어려웠다 — 이제는 항목 자체가 펼쳐지고, 그 위치로 스크롤한
 * 뒤 테두리를 잠깐 강조해 "여기다"를 보여준다.
 */
function GlossaryPanel({
  terms,
  selectedTermId,
  onSelectedTermChange,
  focusRequest,
  panelProps,
}: {
  terms: GlossaryTermView[]
  selectedTermId: string | null
  onSelectedTermChange: (termId: string) => void
  focusRequest: GlossaryFocusRequest | null
  panelProps: PanelProps
}) {
  const [search, setSearch] = useState('')
  const [flashTermId, setFlashTermId] = useState<string | null>(null)
  useEffect(() => setSearch(''), [selectedTermId, focusRequest])
  const normalizedSearch = search.trim().toLocaleLowerCase()
  const filteredTerms = useMemo(
    () => terms.filter((term) => [term.term, ...term.aliases].some((value) => value.toLocaleLowerCase().includes(normalizedSearch))),
    [normalizedSearch, terms],
  )

  /* 열고 닫기는 비제어(uncontrolled)로 둔다(실시간 노트와 같은 이유) — "펼치기" 자체는 리렌더가 필요 없다. */
  const detailsRefs = useRef(new Map<string, HTMLDetailsElement>())
  const setDetailsRef = (termId: string) => (el: HTMLDetailsElement | null) => {
    if (el) detailsRefs.current.set(termId, el)
    else detailsRefs.current.delete(termId)
  }
  const setAllTermsOpen = (open: boolean) => {
    detailsRefs.current.forEach((el) => { el.open = open })
  }

  /*
   * 자막에서 용어를 누르면 focusRequest가 바뀐다(목록에서 직접 펼치는 쪽은 이 값을 건드리지
   * 않는다 — onToggle 참고). 그 항목을 펼치고, 화면에 보이게 스크롤한 뒤, 테두리를 잠깐 강조한다.
   *
   * focusRequest는 `{ termId, sequence }` 쌍이다 — sequence를 매번 올려서, 같은 용어를 연달아
   * 눌러도(termId만으로는 값이 안 바뀌어 React가 무시했을 상황) 매번 새 값이 되어 다시 실행된다.
   *
   * 탭이 이 틱에 막 보이는 상태로 바뀌었을 수 있어(hidden 해제) 레이아웃이 아직 0폭일 수 있다 —
   * ScrollToTop의 해시 스크롤과 같은 방식으로 몇 프레임 재시도한다.
   */
  useEffect(() => {
    if (!focusRequest) return
    const element = detailsRefs.current.get(focusRequest.termId)
    if (!element) return
    element.open = true

    let attempts = 0
    let frame = 0
    const scrollAndFlash = () => {
      if (element.getClientRects().length === 0) {
        if (attempts++ < 20) frame = requestAnimationFrame(scrollAndFlash)
        return
      }
      // 목록 맨 위가 아니라 화면(뷰포트) 맨 위에 오게 하면 스크롤 컨테이너 밖까지 밀 수 있어
      // block: 'start'로 스크롤 조상 기준 맨 위에 맞춘다 — 탭의 가장 위쪽에 온다.
      element.scrollIntoView({ block: 'start', behavior: 'smooth' })
      setFlashTermId(focusRequest.termId)
    }
    frame = requestAnimationFrame(scrollAndFlash)
    return () => cancelAnimationFrame(frame)
  }, [focusRequest])

  // 강조는 한 번 반짝이고 사라진다 — 계속 남아 있으면 "지금 막 도착했다"는 뜻이 무뎌진다.
  useEffect(() => {
    if (!flashTermId) return
    const timeout = setTimeout(() => setFlashTermId(null), GLOSSARY_FLASH_MS)
    return () => clearTimeout(timeout)
  }, [flashTermId])

  return (
    <div className="side-panel-content glossary-panel" {...panelProps}>
      <header className="learning-panel-heading">
        <div><strong>검수된 핵심 용어</strong><small>강의 전에 강사가 확정한 설명입니다.</small></div>
        <div className="lecture-note-heading__actions">
          {terms.length > 0 && (
            <div className="lecture-note-toolbar">
              <button type="button" onClick={() => setAllTermsOpen(true)}>모두 펼치기</button>
              <button type="button" onClick={() => setAllTermsOpen(false)}>모두 접기</button>
            </div>
          )}
          <span>{terms.length}개</span>
        </div>
      </header>
      <label className="glossary-search search-field"><span className="visually-hidden">핵심 용어 검색</span><SearchIcon /><input value={search} placeholder="용어 검색" onChange={(event) => setSearch(event.target.value)} /></label>
      {/* 검색·버튼 영역은 스크롤과 무관하게 위에 고정한다 — 목록만 이 안에서 흐른다(채팅·강의 노트와 같은 골격). */}
      <div className="scroll-pane">
        {filteredTerms.length > 0 ? (
          <div className="glossary-list">
            {filteredTerms.map((term) => (
              <details
                className={`glossary-term${flashTermId === term.termId ? ' is-flash' : ''}`}
                key={term.termId}
                ref={setDetailsRef(term.termId)}
                onToggle={(event) => {
                  if (!event.currentTarget.open) return
                  onSelectedTermChange(term.termId)
                }}
              >
                <summary>
                  <span><strong>{term.term}</strong><small>{term.sourceLabel}</small></span>
                  <b>{term.occurrenceCount}회</b>
                </summary>
                <div className="glossary-term__body">
                  <p>{term.description}</p>
                  {term.aliases.length > 0 && <small>함께 찾는 표현 · {term.aliases.join(', ')}</small>}
                </div>
              </details>
            ))}
          </div>
        ) : (
          <p className="panel-empty">검색 결과가 없습니다.</p>
        )}
      </div>
    </div>
  )
}

export default function LearningSidebar(props: LearningSidebarProps) {
  const isMounted = useVisitedPanels(props.panel)
  const visibleTabs = props.availablePanels
    ? tabs.filter((tab) => props.availablePanels?.includes(tab.id))
    : tabs
  const isAvailable = (panel: LearningPanel) => visibleTabs.some((tab) => tab.id === panel)
  // 활성 탭이 아닌 패널은 감춘다. 지우지 않는다 — 지우면 그 안의 상태가 함께 사라진다.
  const panelProps = (panel: LearningPanel) => ({
    ...tabPanelProps(LEARNING_TAB_PREFIX, panel),
    hidden: props.panel !== panel,
  })

  return (
    <aside className="media-side learning-sidebar">
      {props.windowAction && <div className="learning-sidebar-windowbar">{props.windowAction}</div>}
      <Tabs
        className="media-tabs learning-tabs"
        idPrefix={LEARNING_TAB_PREFIX}
        label="학습 사이드바"
        items={visibleTabs}
        value={props.panel}
        onChange={props.onPanelChange}
      />
      {isAvailable('discussion') && isMounted('discussion') && <DiscussionPanel messages={props.messages} myDisplayName={props.myDisplayName} revealThroughMs={props.revealThroughMs} composer={props.discussionComposer} notice={props.discussionNotice} panelProps={panelProps('discussion')} />}
      {isAvailable('notes') && isMounted('notes') && <LectureNotePanel note={props.lectureNote} live={props.noteContext === 'LIVE'} panelProps={panelProps('notes')} />}
      {isAvailable('ai') && isMounted('ai') && <div className="side-panel-content ai-panel" {...panelProps('ai')}>{props.aiContent}</div>}
      {isAvailable('glossary') && isMounted('glossary') && <GlossaryPanel terms={props.glossaryTerms} selectedTermId={props.selectedTermId} onSelectedTermChange={props.onSelectedTermChange} focusRequest={props.glossaryFocusRequest} panelProps={panelProps('glossary')} />}
    </aside>
  )
}
