import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthContext'
import { demoCaptions, demoLesson, demoMessages } from '@/features/demo/demoData'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { InlineNotice, StatusBadge } from '@/shared/ui/WorkspaceUi'

type ReplayPanel = 'outline' | 'caption' | 'chat' | 'ai' | 'quiz'

export default function ReplayLessonPage() {
  const { lessonId = demoLesson.lessonId } = useParams()
  const { user } = useAuth()
  const isInstructor = user?.role === 'INSTRUCTOR'
  const [panel, setPanel] = useState<ReplayPanel>('outline')
  const [position, setPosition] = useState(42)
  const [playing, setPlaying] = useState(false)
  const [aiQuestion, setAiQuestion] = useState('')
  const [aiAnswer, setAiAnswer] = useState('')
  const [quizAnswer, setQuizAnswer] = useState('')
  const [quizSubmitted, setQuizSubmitted] = useState(false)
  usePageTitle(`다시보기 · ${demoLesson.title}`)

  const askAi = (event: FormEvent) => { event.preventDefault(); if (aiQuestion.trim()) setAiAnswer('세션은 인증 상태를 여러 요청에 걸쳐 유지하고, SecurityContext는 현재 요청에서 인증 주체를 참조하는 역할을 합니다.') }
  return <div className="media-page replay-page"><header className="media-page__title"><div><StatusBadge tone="success">REPLAY</StatusBadge><h1>{demoLesson.title}</h1><small>레슨 {lessonId} · 교정 자막 v2</small></div><div className="media-page__status"><span>학습 진행률 {position}%</span><Link className="button button--soft button--small" to={`/curriculums/cur_spring_live/sections/sec_security/lessons/${lessonId}`}>레슨 상세</Link></div></header>
    {isInstructor && <div className="review-toolbar"><div><StatusBadge tone="warning">강사 미리보기</StatusBadge><strong>수강생 공개 전 게시본을 검수하고 있습니다.</strong></div><div><button className="button button--soft button--small" type="button">검수 초안 저장</button><button className="button button--primary button--small" type="button">게시본 공개</button></div></div>}
    <div className="media-layout"><section className="media-primary"><div className="video-stage replay-video"><button className="play-button" type="button" aria-label={playing ? '일시정지' : '재생'} onClick={() => setPlaying((current) => !current)}>{playing ? 'Ⅱ' : '▶'}</button><div className="slide-preview"><span>SPRING SECURITY</span><h2>SecurityContext와<br />세션의 경계</h2><div className="slide-code">Request → FilterChain → Context → Service</div></div><div className="caption-overlay"><small>교정 자막 · 12:24</small><p>{demoCaptions[1].text}</p></div></div>
      <div className="replay-controls"><div className="timeline-row"><span>00:00</span><input aria-label="다시보기 타임라인" min="0" max="100" type="range" value={position} onChange={(event) => setPosition(Number(event.target.value))} /><span>1:32:18</span></div><div className="control-row"><button type="button" onClick={() => setPlaying((current) => !current)}>{playing ? '일시정지' : '재생'}</button><button type="button">1.0×</button><button type="button">CC 켜짐</button><button type="button">☆ 북마크</button><span>{position}% 시청</span></div></div>
      <div className="chapter-row"><button type="button" onClick={() => setPosition(8)}><span>00:00</span>인증 흐름</button><button type="button" onClick={() => setPosition(34)}><span>31:20</span>세션 저장소</button><button type="button" onClick={() => setPosition(67)}><span>1:01:40</span>CSRF 실습</button></div>
    </section>
    <aside className="media-side"><div className="media-tabs media-tabs--scroll" role="tablist"><button className={panel === 'outline' ? 'is-active' : ''} onClick={() => setPanel('outline')} type="button">목차</button><button className={panel === 'caption' ? 'is-active' : ''} onClick={() => setPanel('caption')} type="button">자막</button><button className={panel === 'chat' ? 'is-active' : ''} onClick={() => setPanel('chat')} type="button">채팅</button><button className={panel === 'ai' ? 'is-active' : ''} onClick={() => setPanel('ai')} type="button">AI</button><button className={panel === 'quiz' ? 'is-active' : ''} onClick={() => setPanel('quiz')} type="button">퀴즈</button></div>
      {panel === 'outline' && <div className="side-panel-content"><div className="replay-outline"><button className="is-current" type="button"><span>12:08</span><div><strong>SecurityContext의 역할</strong><small>현재 재생 중</small></div></button><button type="button"><span>31:20</span><div><strong>Redis 세션 저장</strong><small>핵심 개념 3개</small></div></button><button type="button"><span>58:42</span><div><strong>CSRF 방어 흐름</strong><small>실습</small></div></button></div><div className="evidence-card"><span>구조 요약</span><strong>이번 레슨의 핵심</strong><p>인증 주체, 요청 컨텍스트, 공유 세션 저장소의 책임을 구분합니다.</p></div></div>}
      {panel === 'caption' && <div className="side-panel-content"><label className="panel-search"><span className="visually-hidden">자막 검색</span><input placeholder="자막에서 검색" /></label><div className="caption-list">{demoCaptions.map((caption) => <button type="button" key={caption.at}><time>{caption.at}</time><p>{caption.text}</p></button>)}</div></div>}
      {panel === 'chat' && <div className="side-panel-content chat-list">{demoMessages.map((item) => <article key={item.id}><header><strong>{item.alias}</strong><time>{item.time}</time></header><p>{item.text}</p></article>)}</div>}
      {panel === 'ai' && <div className="side-panel-content ai-panel"><InlineNotice>현재 재생 시각과 레슨 전체 자료를 함께 근거로 사용합니다.</InlineNotice>{aiAnswer && <div className="ai-answer"><strong>답변</strong><p>{aiAnswer}</p><small>근거 · session-and-csrf.pptx 8쪽</small></div>}<form onSubmit={askAi}><textarea rows={4} value={aiQuestion} placeholder="이 구간에서 궁금한 점을 질문하세요." onChange={(event) => setAiQuestion(event.target.value)} /><button className="button button--primary button--full" type="submit">질문하기</button></form></div>}
      {panel === 'quiz' && <div className="side-panel-content quiz-panel"><header><StatusBadge tone="success">QUIZ v1</StatusBadge><strong>핵심 개념 확인</strong><small>1 / 3 문제</small></header><p>현재 요청의 인증 주체를 참조하는 객체는 무엇인가요?</p>{['HttpSession', 'SecurityContext', 'RedisConnection'].map((answer) => <label className={quizAnswer === answer ? 'is-selected' : ''} key={answer}><input name="quiz" type="radio" value={answer} checked={quizAnswer === answer} onChange={(event) => { setQuizAnswer(event.target.value); setQuizSubmitted(false) }} /><span>{answer}</span></label>)}<button className="button button--primary button--full" disabled={!quizAnswer} type="button" onClick={() => setQuizSubmitted(true)}>정답 확인</button>{quizSubmitted && <InlineNotice tone={quizAnswer === 'SecurityContext' ? 'success' : 'danger'}>{quizAnswer === 'SecurityContext' ? '정답입니다. 현재 요청의 인증 주체를 보관합니다.' : '다시 생각해 보세요. 세션 저장소와 요청 컨텍스트는 책임이 다릅니다.'}</InlineNotice>}</div>}
    </aside></div>
  </div>
}
