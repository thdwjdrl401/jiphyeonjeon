import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthContext'
import { demoCaptions, demoLesson, demoMessages, demoSession } from '@/features/demo/demoData'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { InlineNotice, StatusBadge } from '@/shared/ui/WorkspaceUi'

type LivePanel = 'chat' | 'caption' | 'ai' | 'materials'

export default function LiveClassroomPage() {
  const { sessionId = demoSession.sessionId } = useParams()
  const { user } = useAuth()
  const isInstructor = user?.role === 'INSTRUCTOR'
  const [panel, setPanel] = useState<LivePanel>('chat')
  const [isLive, setIsLive] = useState(true)
  const [position, setPosition] = useState(88)
  const [messages, setMessages] = useState(demoMessages)
  const [message, setMessage] = useState('')
  const [isQuestion, setIsQuestion] = useState(false)
  const [aiQuestion, setAiQuestion] = useState('')
  const [aiAnswer, setAiAnswer] = useState('')
  const [bookmarked, setBookmarked] = useState(false)
  usePageTitle(`LIVE · ${demoLesson.title}`)

  const sendMessage = (event: FormEvent) => {
    event.preventDefault()
    if (!message.trim()) return
    setMessages((current) => [...current, { id: `msg_${Date.now()}`, alias: user?.displayName ?? '나', text: message.trim(), time: '현재', question: isQuestion }])
    setMessage(''); setIsQuestion(false)
  }
  const askAi = (event: FormEvent) => {
    event.preventDefault()
    if (!aiQuestion.trim()) return
    setAiAnswer('SecurityContext는 인증이 끝난 현재 요청의 사용자 정보를 보관합니다. 세션 저장소와는 책임이 다르며, 요청이 끝나면 컨텍스트가 정리됩니다.')
  }

  return <div className="media-page"><header className="media-page__title"><div><span className="live-dot" /> <strong>LIVE</strong><h1>{demoLesson.title}</h1><small>세션 {sessionId}</small></div><div className="media-page__status"><StatusBadge tone="success">연결 안정적</StatusBadge><span>{demoSession.participants}명 참여 중</span>{isInstructor && <Link className="button button--soft button--small" to={`/instructor/live-sessions/${sessionId}/processing`}>세션 종료</Link>}</div></header>
    <div className="media-layout"><section className="media-primary"><div className="video-stage"><div className="video-stage__glow" /><div className="presenter-card"><span>이</span><div><strong>이도현 강사</strong><small>화면 공유 중</small></div></div><div className="slide-preview"><span>SPRING SECURITY</span><h2>요청은 어떻게<br />인증되는가?</h2><div className="slide-code">SecurityFilterChain → Authentication → SecurityContext</div></div><div className="caption-overlay"><small>실시간 자막 · FINAL</small><p>{demoCaptions[1].text}</p></div></div>
      <div className="live-controls"><div className="timeline-row"><span>00:00</span><input aria-label="라이브 타임라인" min="0" max="100" type="range" value={position} onChange={(event) => { const value = Number(event.target.value); setPosition(value); setIsLive(value > 96) }} /><span>현재</span></div><div className="control-row"><div>{isInstructor ? <><button type="button">마이크 켜짐</button><button type="button">카메라 켜짐</button><button type="button">화면 공유</button></> : <button className={bookmarked ? 'is-active' : ''} type="button" onClick={() => setBookmarked((current) => !current)}>{bookmarked ? '★ 북마크됨' : '☆ 북마크'}</button>}</div><button className={`go-live${isLive ? ' is-live' : ''}`} type="button" onClick={() => { setPosition(100); setIsLive(true) }}><i /> LIVE{!isLive && '로 이동'}</button></div></div>
      {!isLive && <InlineNotice>현재 라이브보다 약 2분 14초 이전을 재생하고 있습니다. 채팅과 자막도 같은 시각으로 이동했습니다.</InlineNotice>}
      {isInstructor && <div className="question-strip"><strong>질문 집중 구간</strong><button type="button"><span>12:18</span> 3개 질문</button><button type="button"><span>27:40</span> 5개 질문</button><button type="button"><span>41:05</span> 2개 질문</button></div>}
    </section>
    <aside className="media-side"><div className="media-tabs" role="tablist"><button className={panel === 'chat' ? 'is-active' : ''} type="button" onClick={() => setPanel('chat')}>채팅</button><button className={panel === 'caption' ? 'is-active' : ''} type="button" onClick={() => setPanel('caption')}>자막</button><button className={panel === 'ai' ? 'is-active' : ''} type="button" onClick={() => setPanel('ai')}>AI 질문</button><button className={panel === 'materials' ? 'is-active' : ''} type="button" onClick={() => setPanel('materials')}>자료</button></div>
      {panel === 'chat' && <div className="side-panel-content chat-panel"><div className="chat-list">{messages.map((item) => <article className={item.question ? 'is-question' : ''} key={item.id}><header><strong>{item.alias}</strong><time>{item.time}</time></header><p>{item.text}</p>{item.question && <small>질문으로 등록됨</small>}</article>)}</div><form className="chat-composer" onSubmit={sendMessage}><textarea aria-label="채팅 메시지" rows={2} value={message} placeholder="메시지를 입력하세요" onChange={(event) => setMessage(event.target.value)} /><div><label><input type="checkbox" checked={isQuestion} onChange={(event) => setIsQuestion(event.target.checked)} /> 질문으로 등록</label><button className="button button--primary button--small" type="submit">전송</button></div></form></div>}
      {panel === 'caption' && <div className="side-panel-content"><div className="caption-list">{demoCaptions.map((caption, index) => <button className={index === 1 ? 'is-current' : ''} type="button" key={caption.at}><time>{caption.at}</time><p>{caption.text}</p></button>)}</div><div className="evidence-card"><span>PPTX · 12번 슬라이드</span><strong>SecurityContext의 생명주기</strong><p>현재 자막과 연결된 강의 자료 근거입니다.</p></div></div>}
      {panel === 'ai' && <div className="side-panel-content ai-panel"><div className="ai-empty"><span>AI</span><h3>현재 수업 맥락에 질문하세요</h3><p>강의 자료와 발화를 근거로 답변합니다.</p></div>{aiAnswer && <div className="ai-answer"><strong>답변</strong><p>{aiAnswer}</p><small>근거 · 12번 슬라이드, 12:08–12:41 발화</small></div>}<form onSubmit={askAi}><textarea rows={3} value={aiQuestion} placeholder="예: SecurityContext와 세션은 어떻게 다른가요?" onChange={(event) => setAiQuestion(event.target.value)} /><button className="button button--primary button--full" type="submit">근거와 함께 질문</button></form></div>}
      {panel === 'materials' && <div className="side-panel-content"><ul className="material-list material-list--compact">{demoLesson.materials.map((material) => <li key={material.id}><span className="file-icon">PPTX</span><div><strong>{material.name}</strong><small>{material.size}</small></div><button className="text-button" type="button">열기</button></li>)}</ul><InlineNotice>수업 전에 공개된 활성 자료만 표시됩니다.</InlineNotice></div>}
    </aside></div>
  </div>
}
