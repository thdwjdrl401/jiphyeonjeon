import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ChatMessageView } from './liveSessionService.interface'
import type { GlossaryTermView, LearningPanel, LiveSummaryBlock } from './liveLearningPreview'

interface LearningSidebarProps {
  panel: LearningPanel
  onPanelChange: (panel: LearningPanel) => void
  currentSessionMs: number
  onSeek: (sessionMs: number) => void
  selectedTermId: string | null
  onSelectedTermChange: (termId: string) => void
  summaryBlocks: LiveSummaryBlock[]
  glossaryTerms: GlossaryTermView[]
  messages: ChatMessageView[]
  discussionComposer?: ReactNode
  discussionNotice?: string
  aiContent: ReactNode
  noteContext: 'LIVE' | 'REPLAY'
}

const tabs: Array<{ id: LearningPanel; label: string }> = [
  { id: 'discussion', label: '채팅·질문' },
  { id: 'notes', label: '실시간 노트' },
  { id: 'ai', label: 'AI 질문' },
  { id: 'glossary', label: '핵심 용어' },
]

function formatTime(sessionMs: number) {
  const seconds = Math.floor(sessionMs / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
}

function DiscussionPanel({ messages, composer, notice }: { messages: ChatMessageView[]; composer?: ReactNode; notice?: string }) {
  const [filter, setFilter] = useState<'all' | 'questions'>('all')
  const visibleMessages = filter === 'questions' ? messages.filter((message) => message.question) : messages

  return (
    <div className="side-panel-content discussion-panel" role="tabpanel">
      <div className="discussion-filter" aria-label="채팅 필터">
        <button className={filter === 'all' ? 'is-active' : ''} type="button" onClick={() => setFilter('all')}>전체 {messages.length}</button>
        <button className={filter === 'questions' ? 'is-active' : ''} type="button" onClick={() => setFilter('questions')}>질문 {messages.filter((message) => message.question).length}</button>
      </div>
      <div className="chat-list">
        {visibleMessages.length > 0
          ? visibleMessages.map((item) => (
              <article className={item.question ? 'is-question' : ''} key={item.id}>
                <header><strong>{item.alias}</strong><time>{item.time}</time></header>
                <p>{item.text}</p>
                {item.question && <small>질문으로 등록됨</small>}
              </article>
            ))
          : <p className="panel-empty">등록된 질문이 없습니다.</p>}
      </div>
      {notice && <p className="discussion-notice">{notice}</p>}
      {composer}
    </div>
  )
}

function SummaryPanel({ blocks, currentSessionMs, onSeek, context }: { blocks: LiveSummaryBlock[]; currentSessionMs: number; onSeek: (sessionMs: number) => void; context: 'LIVE' | 'REPLAY' }) {
  return (
    <div className="side-panel-content summary-panel" role="tabpanel">
      <header className="learning-panel-heading">
        <div><strong>{context === 'LIVE' ? 'AI 실시간 강의 노트' : '라이브에서 작성된 강의 노트'}</strong><small>완성된 구간별 블록을 순서대로 누적합니다.</small></div>
        <span>{blocks.length}개 블록</span>
      </header>
      <div className="summary-block-list">
        {blocks.map((block) => {
          const isCurrent = currentSessionMs >= block.startMs && currentSessionMs <= block.endMs
          return (
            <article className={isCurrent ? 'is-current' : ''} key={block.summaryBlockId}>
              <header>
                <button type="button" onClick={() => onSeek(block.startMs)}>{formatTime(block.startMs)}–{formatTime(block.endMs)}</button>
                <small>{block.createdAtLabel}</small>
              </header>
              <h3>{block.title}</h3>
              <section><strong>현재까지의 핵심 내용</strong><ul>{block.keyPoints.map((point) => <li key={point}>{point}</li>)}</ul></section>
              <section><strong>주요 개념</strong>{block.concepts.map((concept) => <div className="summary-concept" key={concept.name}><b>{concept.name}</b><p>{concept.description}</p></div>)}</section>
              <section className="summary-emphasis"><strong>강사 강조</strong><p>{block.emphasis.join(' ')}</p></section>
              <section><strong>예시와 사례</strong><p>{block.examples.join(' ')}</p></section>
            </article>
          )
        })}
      </div>
      {context === 'LIVE' && <div className="summary-generating"><i /><span><strong>다음 구간을 정리하고 있어요</strong><small>완성되면 새 블록으로 추가됩니다.</small></span></div>}
    </div>
  )
}

function GlossaryPanel({ terms, selectedTermId, onSelectedTermChange }: { terms: GlossaryTermView[]; selectedTermId: string | null; onSelectedTermChange: (termId: string) => void }) {
  const [search, setSearch] = useState('')
  useEffect(() => setSearch(''), [selectedTermId])
  const normalizedSearch = search.trim().toLocaleLowerCase()
  const filteredTerms = useMemo(
    () => terms.filter((term) => [term.term, ...term.aliases].some((value) => value.toLocaleLowerCase().includes(normalizedSearch))),
    [normalizedSearch, terms],
  )
  const selectedTerm = terms.find((term) => term.termId === selectedTermId) ?? filteredTerms[0] ?? null

  return (
    <div className="side-panel-content glossary-panel" role="tabpanel">
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
      <div className="media-tabs learning-tabs" role="tablist">
        {tabs.map((tab) => <button aria-selected={props.panel === tab.id} className={props.panel === tab.id ? 'is-active' : ''} key={tab.id} role="tab" type="button" onClick={() => props.onPanelChange(tab.id)}>{tab.label}</button>)}
      </div>
      {props.panel === 'discussion' && <DiscussionPanel messages={props.messages} composer={props.discussionComposer} notice={props.discussionNotice} />}
      {props.panel === 'notes' && <SummaryPanel blocks={props.summaryBlocks} currentSessionMs={props.currentSessionMs} onSeek={props.onSeek} context={props.noteContext} />}
      {props.panel === 'ai' && <div className="side-panel-content ai-panel" role="tabpanel">{props.aiContent}</div>}
      {props.panel === 'glossary' && <GlossaryPanel terms={props.glossaryTerms} selectedTermId={props.selectedTermId} onSelectedTermChange={props.onSelectedTermChange} />}
    </aside>
  )
}
