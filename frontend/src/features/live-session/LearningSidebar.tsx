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
}

const tabs: ReadonlyArray<TabItem<LearningPanel>> = [
  { id: 'discussion', label: '채팅·질문' },
  { id: 'notes', label: '실시간 노트' },
  { id: 'ai', label: 'AI 질문' },
  { id: 'glossary', label: '핵심 용어' },
]

const LEARNING_TAB_PREFIX = 'learning-sidebar'

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
  return (
    <aside className="media-side learning-sidebar">
      {props.windowAction && <div className="learning-sidebar-windowbar">{props.windowAction}</div>}
      <Tabs
        className="media-tabs learning-tabs"
        idPrefix={LEARNING_TAB_PREFIX}
        label="학습 사이드바"
        items={tabs}
        value={props.panel}
        onChange={props.onPanelChange}
      />
      {props.panel === 'discussion' && <DiscussionPanel messages={props.messages} composer={props.discussionComposer} notice={props.discussionNotice} panelProps={tabPanelProps(LEARNING_TAB_PREFIX, 'discussion')} />}
      {props.panel === 'notes' && <LectureNotePanel note={props.lectureNote} live={props.noteContext === 'LIVE'} panelProps={tabPanelProps(LEARNING_TAB_PREFIX, 'notes')} />}
      {props.panel === 'ai' && <div className="side-panel-content ai-panel" {...tabPanelProps(LEARNING_TAB_PREFIX, 'ai')}>{props.aiContent}</div>}
      {props.panel === 'glossary' && <GlossaryPanel terms={props.glossaryTerms} selectedTermId={props.selectedTermId} onSelectedTermChange={props.onSelectedTermChange} panelProps={tabPanelProps(LEARNING_TAB_PREFIX, 'glossary')} />}
    </aside>
  )
}
