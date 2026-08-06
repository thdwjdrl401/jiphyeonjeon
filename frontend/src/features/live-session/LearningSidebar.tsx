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

interface LearningSidebarProps {
  panel: LearningPanel
  onPanelChange: (panel: LearningPanel) => void
  selectedTermId: string | null
  onSelectedTermChange: (termId: string) => void
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
                const displayName = item.mine ? myDisplayName : item.alias
                // 익명 가명은 진짜 이름이 아니므로 이니셜 아바타 대신 "?"로 채운다(ProfileAvatar의
                // 빈 이름 폴백). 내 메시지는 내가 익명으로 보냈어도 항상 내 아바타로 보인다 —
                // 이름 표시(myDisplayName)와 같은 규칙이다.
                const avatarName = item.mine || !isAnonymousAlias(item.alias) ? displayName : ''
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

function GlossaryPanel({ terms, selectedTermId, onSelectedTermChange, panelProps }: { terms: GlossaryTermView[]; selectedTermId: string | null; onSelectedTermChange: (termId: string) => void; panelProps: PanelProps }) {
  const [search, setSearch] = useState('')
  useEffect(() => setSearch(''), [selectedTermId])
  const normalizedSearch = search.trim().toLocaleLowerCase()
  const filteredTerms = useMemo(
    () => terms.filter((term) => [term.term, ...term.aliases].some((value) => value.toLocaleLowerCase().includes(normalizedSearch))),
    [normalizedSearch, terms],
  )
  const selectedTerm = terms.find((term) => term.termId === selectedTermId) ?? filteredTerms[0] ?? null

  return (
    <div className="side-panel-content glossary-panel" {...panelProps}>
      <header className="learning-panel-heading"><div><strong>검수된 핵심 용어</strong><small>강의 전에 강사가 확정한 설명입니다.</small></div><span>{terms.length}개</span></header>
      <label className="glossary-search search-field"><span className="visually-hidden">핵심 용어 검색</span><SearchIcon /><input value={search} placeholder="용어 검색" onChange={(event) => setSearch(event.target.value)} /></label>
      <div className="glossary-list">
        {filteredTerms.map((term) => (
          <button className={selectedTerm?.termId === term.termId ? 'is-active' : ''} type="button" key={term.termId} onClick={() => onSelectedTermChange(term.termId)}>
            <span><strong>{term.term}</strong><small>{term.sourceLabel}</small></span><b>{term.occurrenceCount}회</b>
          </button>
        ))}
      </div>
      {selectedTerm
        ? <article className="glossary-detail"><header><span>{selectedTerm.source === 'INSTRUCTOR' ? '강사 등록' : 'AI 자료 추출 · 강사 검수 완료'}</span><strong>{selectedTerm.term}</strong></header><p>{selectedTerm.description}</p>{selectedTerm.aliases.length > 0 && <small>함께 찾는 표현 · {selectedTerm.aliases.join(', ')}</small>}</article>
        : <p className="panel-empty">검색 결과가 없습니다.</p>}
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
      {isAvailable('glossary') && isMounted('glossary') && <GlossaryPanel terms={props.glossaryTerms} selectedTermId={props.selectedTermId} onSelectedTermChange={props.onSelectedTermChange} panelProps={panelProps('glossary')} />}
    </aside>
  )
}
