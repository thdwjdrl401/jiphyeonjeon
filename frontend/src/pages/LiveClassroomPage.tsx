import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { instructorPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import { demoCaptions, demoMessages, demoSession, getDemoLesson, getDemoLiveSession } from '@/features/demo/demoData'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { InlineNotice, StatusBadge } from '@/shared/ui/WorkspaceUi'

type LivePanel = 'questions' | 'participants' | 'chat' | 'caption' | 'ai' | 'materials'

const instructorQuestions = [
  { at: '12:18', count: 3, text: '세션과 JWT를 함께 사용하는 기준이 궁금해요.' },
  { at: '27:40', count: 5, text: '필터 순서가 실제 인증에 어떤 영향을 주나요?' },
  { at: '41:05', count: 2, text: 'Redis 장애 시 세션 복구 방식이 궁금해요.' },
]

const participants = [
  { alias: '수강생-14A2', state: '시청 중', joinedAt: '09:52' },
  { alias: '수강생-09C1', state: 'DVR · 2분 전', joinedAt: '09:55' },
  { alias: '수강생-21B3', state: '시청 중', joinedAt: '10:03' },
]

export default function LiveClassroomPage() {
  const { sessionId = demoSession.sessionId } = useParams()
  const session = getDemoLiveSession(sessionId)
  const lesson = getDemoLesson(session.lessonId)
  const { user } = useAuth()
  const isInstructor = user?.role === 'INSTRUCTOR'
  const [panel, setPanel] = useState<LivePanel>(isInstructor ? 'questions' : 'chat')
  const [isLive, setIsLive] = useState(true)
  const [position, setPosition] = useState(88)
  const [messages, setMessages] = useState(demoMessages)
  const [message, setMessage] = useState('')
  const [isQuestion, setIsQuestion] = useState(false)
  const [aiQuestion, setAiQuestion] = useState('')
  const [aiAnswer, setAiAnswer] = useState('')
  const [bookmarked, setBookmarked] = useState(false)
  const [endRequested, setEndRequested] = useState(false)
  usePageTitle(`LIVE · ${lesson.title}`)

  const sendMessage = (event: FormEvent) => {
    event.preventDefault()
    if (!message.trim()) return
    setMessages((current) => [
      ...current,
      {
        id: `msg_${Date.now()}`,
        alias: user?.displayName ?? '나',
        text: message.trim(),
        time: '현재',
        question: isInstructor ? false : isQuestion,
      },
    ])
    setMessage('')
    setIsQuestion(false)
  }

  const askAi = (event: FormEvent) => {
    event.preventDefault()
    if (!aiQuestion.trim()) return
    setAiAnswer('SecurityContext는 인증이 끝난 현재 요청의 사용자 정보를 보관합니다. 세션 저장소와는 책임이 다르며, 요청이 끝나면 컨텍스트가 정리됩니다.')
  }

  const tabs: Array<{ id: LivePanel; label: string }> = isInstructor
    ? [
        { id: 'questions', label: '질문' },
        { id: 'participants', label: '참여자' },
        { id: 'chat', label: '채팅' },
        { id: 'caption', label: '자막' },
        { id: 'materials', label: '자료' },
      ]
    : [
        { id: 'chat', label: '채팅' },
        { id: 'caption', label: '자막' },
        { id: 'ai', label: 'AI 질문' },
        { id: 'materials', label: '자료' },
      ]

  return (
    <div className={`media-page${isInstructor ? ' media-page--instructor' : ''}`}>
      <header className="media-page__title">
        <div>
          <span className="live-dot" />
          <strong>LIVE</strong>
          <h1>{lesson.title}</h1>
          <small>세션 {sessionId}</small>
        </div>
        <div className="media-page__status">
          {isInstructor && <StatusBadge tone="warning">강사 운영 모드</StatusBadge>}
          <StatusBadge tone="success">연결 안정적</StatusBadge>
          <span>{session.participants}명 참여 중</span>
          {isInstructor && <button className="button button--soft button--small" type="button" onClick={() => setEndRequested(true)}>세션 종료</button>}
        </div>
      </header>

      {isInstructor && (
        <section className="instructor-live-console" aria-label="강사 라이브 운영 상태">
          <div><span>송출</span><strong>LIVE</strong><small>카메라·화면 공유 정상</small></div>
          <div><span>녹화</span><strong>RECORDING</strong><small>Egress HLS 저장 중</small></div>
          <div><span>실시간 자막</span><strong>ACTIVE</strong><small>지연 1.2초</small></div>
          <div><span>질문</span><strong>10개</strong><small>집중 구간 3곳</small></div>
        </section>
      )}

      {isInstructor && endRequested && (
        <div className="instructor-end-confirm" role="alert">
          <div><strong>라이브 세션을 종료할까요?</strong><p>학생 연결을 종료하고 녹화·AI 후처리 단계로 이동합니다.</p></div>
          <div><button className="button button--ghost button--small" type="button" onClick={() => setEndRequested(false)}>계속 진행</button><Link className="button button--primary button--small" to={instructorPaths.processing(sessionId)}>종료하고 처리 현황 보기</Link></div>
        </div>
      )}

      <div className="media-layout">
        <section className="media-primary">
          <div className="video-stage">
            <div className="video-stage__glow" />
            <div className="presenter-card"><span>이</span><div><strong>이도현 강사</strong><small>화면 공유 중</small></div></div>
            <div className="slide-preview"><span>SPRING SECURITY</span><h2>요청은 어떻게<br />인증되는가?</h2><div className="slide-code">SecurityFilterChain → Authentication → SecurityContext</div></div>
            <div className="caption-overlay"><small>실시간 자막 · FINAL</small><p>{demoCaptions[1].text}</p></div>
          </div>

          <div className="live-controls">
            <div className="timeline-row"><span>00:00</span><input aria-label="라이브 타임라인" min="0" max="100" type="range" value={position} onChange={(event) => { const value = Number(event.target.value); setPosition(value); setIsLive(value > 96) }} /><span>현재</span></div>
            <div className="control-row">
              <div>{isInstructor ? <><button type="button">마이크 켜짐</button><button type="button">카메라 켜짐</button><button type="button">화면 공유 중</button></> : <button className={bookmarked ? 'is-active' : ''} type="button" onClick={() => setBookmarked((current) => !current)}>{bookmarked ? '★ 북마크됨' : '☆ 북마크'}</button>}</div>
              <button className={`go-live${isLive ? ' is-live' : ''}`} type="button" onClick={() => { setPosition(100); setIsLive(true) }}><i /> LIVE{!isLive && '로 이동'}</button>
            </div>
          </div>

          {!isLive && <InlineNotice>현재 라이브보다 약 2분 14초 이전을 재생하고 있습니다. 채팅과 자막도 같은 시각으로 이동했습니다.</InlineNotice>}
          {isInstructor && <div className="question-strip"><strong>질문 집중 구간</strong>{instructorQuestions.map((question) => <button type="button" key={question.at} onClick={() => setPanel('questions')}><span>{question.at}</span> {question.count}개 질문</button>)}</div>}
        </section>

        <aside className="media-side">
          <div className={`media-tabs${tabs.length === 5 ? ' media-tabs--scroll' : ''}`} role="tablist">
            {tabs.map((tab) => <button aria-selected={panel === tab.id} className={panel === tab.id ? 'is-active' : ''} key={tab.id} role="tab" type="button" onClick={() => setPanel(tab.id)}>{tab.label}</button>)}
          </div>

          {isInstructor && panel === 'questions' && <div className="side-panel-content instructor-question-panel"><header><div><strong>익명 질문 흐름</strong><small>채팅 질문과 개인 AI 질문을 합산합니다.</small></div><StatusBadge tone="warning">10 NEW</StatusBadge></header>{instructorQuestions.map((question) => <button type="button" key={question.at} onClick={() => setPosition(Number.parseInt(question.at, 10) * 2)}><time>{question.at}</time><div><strong>{question.count}개 질문</strong><p>{question.text}</p></div><span>이동</span></button>)}</div>}

          {isInstructor && panel === 'participants' && <div className="side-panel-content instructor-participant-panel"><header><strong>참여 현황</strong><small>128명 중 124명 연결 · DVR 4명</small></header><div className="participant-summary"><span>LiveKit 124</span><span>재연결 1</span><span>지연 시청 4</span></div><ul>{participants.map((participant) => <li key={participant.alias}><div><strong>{participant.alias}</strong><small>{participant.joinedAt} 입장</small></div><StatusBadge tone={participant.state === '시청 중' ? 'success' : 'warning'}>{participant.state}</StatusBadge></li>)}</ul><InlineNotice>초기 화면은 운영에 필요한 최소 연결 정보만 표시합니다.</InlineNotice></div>}

          {panel === 'chat' && <div className="side-panel-content chat-panel"><div className="chat-list">{messages.map((item) => <article className={item.question ? 'is-question' : ''} key={item.id}><header><strong>{item.alias}</strong><time>{item.time}</time></header><p>{item.text}</p>{item.question && <small>질문으로 등록됨</small>}</article>)}</div><form className="chat-composer" onSubmit={sendMessage}><textarea aria-label="채팅 메시지" rows={2} value={message} placeholder="메시지를 입력하세요" onChange={(event) => setMessage(event.target.value)} /><div>{!isInstructor ? <label><input type="checkbox" checked={isQuestion} onChange={(event) => setIsQuestion(event.target.checked)} /> 질문으로 등록</label> : <span>강사 메시지로 전송됩니다.</span>}<button className="button button--primary button--small" type="submit">전송</button></div></form></div>}

          {panel === 'caption' && <div className="side-panel-content"><div className="caption-list">{demoCaptions.map((caption, index) => <button className={index === 1 ? 'is-current' : ''} type="button" key={caption.at}><time>{caption.at}</time><p>{caption.text}</p></button>)}</div><div className="evidence-card"><span>PPTX · 12번 슬라이드</span><strong>SecurityContext의 생명주기</strong><p>현재 자막과 연결된 강의 자료 근거입니다.</p></div></div>}

          {!isInstructor && panel === 'ai' && <div className="side-panel-content ai-panel"><div className="ai-empty"><span>AI</span><h3>현재 수업 맥락에 질문하세요</h3><p>강의 자료와 발화를 근거로 답변합니다.</p></div>{aiAnswer && <div className="ai-answer"><strong>답변</strong><p>{aiAnswer}</p><small>근거 · 12번 슬라이드, 12:08–12:41 발화</small></div>}<form onSubmit={askAi}><textarea rows={3} value={aiQuestion} placeholder="예: SecurityContext와 세션은 어떻게 다른가요?" onChange={(event) => setAiQuestion(event.target.value)} /><button className="button button--primary button--full" type="submit">근거와 함께 질문</button></form></div>}

          {panel === 'materials' && <div className="side-panel-content"><ul className="material-list material-list--compact">{lesson.materials.map((material) => <li key={material.id}><span className="file-icon">PPTX</span><div><strong>{material.name}</strong><small>{material.size}</small></div><button className="text-button" type="button">열기</button></li>)}</ul><InlineNotice>{isInstructor ? '현재 송출과 AI 근거에 사용하는 활성 자료입니다.' : '수업 전에 공개된 활성 자료만 표시됩니다.'}</InlineNotice></div>}
        </aside>
      </div>
    </div>
  )
}
