import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Tabs, { tabPanelProps, type TabItem } from '@/shared/ui/Tabs'
import LectureNotePanel from './LectureNotePanel'
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
  discussionComposer?: ReactNode
  discussionNotice?: string
  aiContent: ReactNode
  noteContext: 'LIVE' | 'REPLAY'
  windowAction?: ReactNode
  /** 화면이 지원하는 패널만 노출한다. 생략하면 라이브·다시보기의 기존 네 탭을 모두 유지한다. */
  availablePanels?: readonly LearningPanel[]
}

const tabs: ReadonlyArray<TabItem<LearningPanel>> = [
  { id: 'discussion', label: '채팅·질문' },
  { id: 'notes', label: '실시간 노트' },
  { id: 'ai', label: 'AI 질문' },
  { id: 'glossary', label: '핵심 용어' },
]

const LEARNING_TAB_PREFIX = 'learning-sidebar'

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

function DiscussionPanel({ messages, composer, notice, panelProps }: { messages: ChatMessageView[]; composer?: ReactNode; notice?: string; panelProps: PanelProps }) {
  const [filter, setFilter] = useState<'all' | 'questions'>('all')
  const [isFollowingLatest, setIsFollowingLatest] = useState(true)
  const chatListRef = useRef<HTMLDivElement>(null)
  const visibleMessages = useMemo(
    () => filter === 'questions' ? messages.filter((message) => message.question) : messages,
    [filter, messages],
  )

  const scrollToLatest = useCallback(() => {
    const chatList = chatListRef.current
    if (!chatList) return
    chatList.scrollTop = chatList.scrollHeight
    setIsFollowingLatest(true)
  }, [])

  const changeFilter = (nextFilter: 'all' | 'questions') => {
    setFilter(nextFilter)
    setIsFollowingLatest(true)
  }

  const handleChatScroll = () => {
    const chatList = chatListRef.current
    if (!chatList) return
    const distanceFromBottom = chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight
    setIsFollowingLatest(distanceFromBottom <= 48)
  }

  useLayoutEffect(() => {
    if (isFollowingLatest) scrollToLatest()
  }, [isFollowingLatest, scrollToLatest, visibleMessages.length])

  return (
    <div className="side-panel-content discussion-panel" {...panelProps}>
      <div className="discussion-filter" aria-label="채팅 필터">
        <button className={filter === 'all' ? 'is-active' : ''} type="button" onClick={() => changeFilter('all')}>전체 {messages.length}</button>
        <button className={filter === 'questions' ? 'is-active' : ''} type="button" onClick={() => changeFilter('questions')}>질문 {messages.filter((message) => message.question).length}</button>
      </div>
      <div className="chat-list" ref={chatListRef} onScroll={handleChatScroll}>
        {visibleMessages.length > 0
          ? visibleMessages.map((item) => (
              <article
                className={[item.question ? 'is-question' : '', item.mine ? 'is-mine' : '']
                  .filter(Boolean).join(' ')}
                key={item.id}
              >
                {/* 내 메시지엔 이름을 쓰지 않는다 — 우측 정렬 자체가 "내 것"이라는 표시다.
                    시각은 서버가 확정한 뒤에만 있다(낙관적 항목은 빈 문자열). */}
                <header>
                  {!item.mine && <strong>{item.alias}</strong>}
                  {item.time && <time>{item.time}</time>}
                </header>
                <p>{item.text}</p>
                {item.question && <small>질문으로 등록됨</small>}
              </article>
            ))
          : <p className="panel-empty">등록된 질문이 없습니다.</p>}
      </div>
      {!isFollowingLatest && (
        <div className="chat-latest-jump">
          <button type="button" onClick={scrollToLatest}>↓ 최근 채팅으로 이동</button>
        </div>
      )}
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
      <label className="glossary-search"><span className="visually-hidden">핵심 용어 검색</span><input value={search} placeholder="용어 검색" onChange={(event) => setSearch(event.target.value)} /></label>
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
      {isAvailable('discussion') && isMounted('discussion') && <DiscussionPanel messages={props.messages} composer={props.discussionComposer} notice={props.discussionNotice} panelProps={panelProps('discussion')} />}
      {isAvailable('notes') && isMounted('notes') && <LectureNotePanel note={props.lectureNote} live={props.noteContext === 'LIVE'} panelProps={panelProps('notes')} />}
      {isAvailable('ai') && isMounted('ai') && <div className="side-panel-content ai-panel" {...panelProps('ai')}>{props.aiContent}</div>}
      {isAvailable('glossary') && isMounted('glossary') && <GlossaryPanel terms={props.glossaryTerms} selectedTermId={props.selectedTermId} onSelectedTermChange={props.onSelectedTermChange} panelProps={panelProps('glossary')} />}
    </aside>
  )
}
