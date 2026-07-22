import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { instructorPaths, studentPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import { demoCaptions, demoLesson, demoMessages, getDemoLesson } from '@/features/demo/demoData'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { InlineNotice, StatusBadge } from '@/shared/ui/WorkspaceUi'

type ReplayPanel = 'review' | 'questions' | 'analytics' | 'outline' | 'caption' | 'chat' | 'ai' | 'quiz'

const reviewStatuses = [
  { label: '교정 자막', status: 'READY_FOR_REVIEW', version: '후보 v3' },
  { label: '전문용어', status: 'DRAFT_SAVED', version: '초안 v2' },
  { label: '챕터', status: 'PUBLISHED', version: '게시 v1' },
  { label: '퀴즈', status: 'PROCESSING', version: '후보 생성 중' },
]

const replayQuestions = [
  { at: 12, time: '12:18', count: 8, text: 'SecurityContext와 세션의 책임 차이' },
  { at: 31, time: '31:20', count: 5, text: 'Redis 세션 만료와 복구 방식' },
  { at: 58, time: '58:42', count: 4, text: 'CSRF 토큰 검증 시점' },
]

export default function ReplayLessonPage() {
  const { lessonId = demoLesson.lessonId } = useParams()
  const lesson = getDemoLesson(lessonId)
  const { user } = useAuth()
  const isInstructor = user?.role === 'INSTRUCTOR'
  const lessonPath = isInstructor
    ? instructorPaths.lesson(lesson.curriculumId, lesson.sectionId, lesson.lessonId)
    : studentPaths.lesson(lesson.curriculumId, lesson.sectionId, lesson.lessonId)
  const [panel, setPanel] = useState<ReplayPanel>(isInstructor ? 'review' : 'outline')
  const [position, setPosition] = useState(42)
  const [playing, setPlaying] = useState(false)
  const [aiQuestion, setAiQuestion] = useState('')
  const [aiAnswer, setAiAnswer] = useState('')
  const [quizAnswer, setQuizAnswer] = useState('')
  const [quizSubmitted, setQuizSubmitted] = useState(false)
  const [reviewDraft, setReviewDraft] = useState('SecurityContext는 인증이 완료된 현재 요청의 인증 주체를 보관합니다.')
  const [reviewSaved, setReviewSaved] = useState(false)
  const [published, setPublished] = useState(false)
  usePageTitle(`다시보기 · ${lesson.title}`)

  const askAi = (event: FormEvent) => {
    event.preventDefault()
    if (aiQuestion.trim()) setAiAnswer('세션은 인증 상태를 여러 요청에 걸쳐 유지하고, SecurityContext는 현재 요청에서 인증 주체를 참조하는 역할을 합니다.')
  }

  const tabs: Array<{ id: ReplayPanel; label: string }> = isInstructor
    ? [
        { id: 'review', label: '콘텐츠 검수' },
        { id: 'questions', label: '질문 핀' },
        { id: 'analytics', label: '학습 통계' },
        { id: 'caption', label: '자막' },
        { id: 'chat', label: '채팅' },
      ]
    : [
        { id: 'outline', label: '목차' },
        { id: 'caption', label: '자막' },
        { id: 'chat', label: '채팅' },
        { id: 'ai', label: 'AI' },
        { id: 'quiz', label: '퀴즈' },
      ]

  const saveReview = () => setReviewSaved(true)
  const publishReview = () => {
    setReviewSaved(true)
    setPublished(true)
  }

  return (
    <div className={`media-page replay-page${isInstructor ? ' media-page--instructor' : ''}`}>
      <header className="media-page__title">
        <div><StatusBadge tone="success">REPLAY</StatusBadge><h1>{lesson.title}</h1><small>강의 {lesson.lessonId} · 교정 자막 v2</small></div>
        <div className="media-page__status">
          {isInstructor ? <><StatusBadge tone="warning">강사 검수 모드</StatusBadge><span>VIDEO READY · {published ? 'PUBLISHED' : 'READY_FOR_REVIEW'}</span></> : <span>학습 진행률 {position}%</span>}
          <Link className="button button--soft button--small" to={lessonPath}>강의 상세</Link>
        </div>
      </header>

      {isInstructor && <div className="review-toolbar"><div><StatusBadge tone={published ? 'success' : 'warning'}>{published ? '게시 완료' : '강사 미리보기'}</StatusBadge><strong>{published ? '새 게시본이 수강생 화면에 반영되었습니다.' : 'AI 후보와 현재 게시본을 비교해 영역별로 검수합니다.'}</strong></div><div><button className="button button--soft button--small" type="button" onClick={saveReview}>검수 초안 저장</button><button className="button button--primary button--small" type="button" onClick={publishReview}>게시본 공개</button></div></div>}
      {isInstructor && reviewSaved && <InlineNotice tone={published ? 'success' : 'info'}>{published ? '교정 자막 게시본 v3이 활성화되었습니다.' : '검수 초안을 저장했습니다. 기존 게시본은 변경되지 않습니다.'}</InlineNotice>}

      <div className="media-layout">
        <section className="media-primary">
          <div className="video-stage replay-video">
            <button className="play-button" type="button" aria-label={playing ? '일시정지' : '재생'} onClick={() => setPlaying((current) => !current)}>{playing ? 'Ⅱ' : '▶'}</button>
            <div className="slide-preview"><span>SPRING SECURITY</span><h2>SecurityContext와<br />세션의 경계</h2><div className="slide-code">Request → FilterChain → Context → Service</div></div>
            <div className="caption-overlay"><small>{isInstructor ? '검수 후보 자막 · 12:24' : '교정 자막 · 12:24'}</small><p>{reviewDraft}</p></div>
          </div>

          <div className="replay-controls">
            <div className="timeline-row"><span>00:00</span><input aria-label="다시보기 타임라인" min="0" max="100" type="range" value={position} onChange={(event) => setPosition(Number(event.target.value))} /><span>1:32:18</span></div>
            <div className="control-row"><div><button type="button" onClick={() => setPlaying((current) => !current)}>{playing ? '일시정지' : '재생'}</button><button type="button">1.0×</button><button type="button">CC 켜짐</button>{isInstructor ? <button type="button" onClick={() => setPanel('review')}>현재 시점 검수</button> : <button type="button">☆ 북마크</button>}</div><span>{isInstructor ? '검수 시점 38:42' : `${position}% 시청`}</span></div>
          </div>

          <div className="chapter-row"><button type="button" onClick={() => setPosition(8)}><span>00:00</span>인증 흐름</button><button type="button" onClick={() => setPosition(34)}><span>31:20</span>세션 저장소</button><button type="button" onClick={() => setPosition(67)}><span>1:01:40</span>CSRF 실습</button></div>
        </section>

        <aside className="media-side">
          <div className="media-tabs media-tabs--scroll" role="tablist">{tabs.map((tab) => <button aria-selected={panel === tab.id} className={panel === tab.id ? 'is-active' : ''} key={tab.id} role="tab" type="button" onClick={() => setPanel(tab.id)}>{tab.label}</button>)}</div>

          {isInstructor && panel === 'review' && <div className="side-panel-content instructor-review-panel"><header><div><strong>콘텐츠 검수</strong><small>원본 후보와 현재 게시본을 분리해 관리합니다.</small></div><StatusBadge tone="warning">자막 후보 v3</StatusBadge></header><div className="review-status-grid">{reviewStatuses.map((item) => <button type="button" key={item.label}><span>{item.label}</span><strong>{item.status}</strong><small>{item.version}</small></button>)}</div><label className="review-editor"><span>현재 구간 교정 자막</span><textarea rows={6} value={reviewDraft} onChange={(event) => { setReviewDraft(event.target.value); setReviewSaved(false) }} /></label><div className="review-actions"><button className="button button--soft button--small" type="button" onClick={saveReview}>초안 저장</button><button className="button button--primary button--small" type="button" onClick={publishReview}>새 버전 게시</button></div><InlineNotice>게시 실패 시 기존 활성 게시본을 유지합니다.</InlineNotice></div>}

          {isInstructor && panel === 'questions' && <div className="side-panel-content instructor-question-panel"><header><div><strong>익명 질문 핀</strong><small>라이브·VOD 질문 원문과 시점만 집계합니다.</small></div><StatusBadge tone="warning">17개</StatusBadge></header>{replayQuestions.map((question) => <button type="button" key={question.time} onClick={() => setPosition(question.at)}><time>{question.time}</time><div><strong>{question.count}개 질문</strong><p>{question.text}</p></div><span>재생</span></button>)}</div>}

          {isInstructor && panel === 'analytics' && <div className="side-panel-content instructor-analytics-panel"><header><strong>학습 요약</strong><small>개인 식별 정보 없이 집계만 제공합니다.</small></header><div className="analytics-grid"><div><span>수강생</span><strong>48명</strong></div><div><span>재생 시작</span><strong>42명</strong></div><div><span>90% 완료</span><strong>31명</strong></div><div><span>퀴즈 평균</span><strong>82.5점</strong></div></div><div className="analytics-progress"><div><span>완료율</span><strong>64.6%</strong></div><i><b style={{ width: '64.6%' }} /></i></div><InlineNotice>질문 원문은 익명으로 제공하며 개인 AI 답변은 강사에게 노출하지 않습니다.</InlineNotice></div>}

          {!isInstructor && panel === 'outline' && <div className="side-panel-content"><div className="replay-outline"><button className="is-current" type="button"><span>12:08</span><div><strong>SecurityContext의 역할</strong><small>현재 재생 중</small></div></button><button type="button"><span>31:20</span><div><strong>Redis 세션 저장</strong><small>핵심 개념 3개</small></div></button><button type="button"><span>58:42</span><div><strong>CSRF 방어 흐름</strong><small>실습</small></div></button></div><div className="evidence-card"><span>구조 요약</span><strong>이번 강의의 핵심</strong><p>인증 주체, 요청 컨텍스트, 공유 세션 저장소의 책임을 구분합니다.</p></div></div>}

          {panel === 'caption' && <div className="side-panel-content"><label className="panel-search"><span className="visually-hidden">자막 검색</span><input placeholder="자막에서 검색" /></label><div className="caption-list">{demoCaptions.map((caption) => <button type="button" key={caption.at}><time>{caption.at}</time><p>{caption.text}</p></button>)}</div></div>}

          {panel === 'chat' && <div className="side-panel-content chat-list">{demoMessages.map((item) => <article key={item.id}><header><strong>{item.alias}</strong><time>{item.time}</time></header><p>{item.text}</p></article>)}</div>}

          {!isInstructor && panel === 'ai' && <div className="side-panel-content ai-panel"><InlineNotice>현재 재생 시각과 강의 전체 자료를 함께 근거로 사용합니다.</InlineNotice>{aiAnswer && <div className="ai-answer"><strong>답변</strong><p>{aiAnswer}</p><small>근거 · session-and-csrf.pptx 8쪽</small></div>}<form onSubmit={askAi}><textarea rows={4} value={aiQuestion} placeholder="이 구간에서 궁금한 점을 질문하세요." onChange={(event) => setAiQuestion(event.target.value)} /><button className="button button--primary button--full" type="submit">질문하기</button></form></div>}

          {!isInstructor && panel === 'quiz' && <div className="side-panel-content quiz-panel"><header><StatusBadge tone="success">QUIZ v1</StatusBadge><strong>핵심 개념 확인</strong><small>1 / 3 문제</small></header><p>현재 요청의 인증 주체를 참조하는 객체는 무엇인가요?</p>{['HttpSession', 'SecurityContext', 'RedisConnection'].map((answer) => <label className={quizAnswer === answer ? 'is-selected' : ''} key={answer}><input name="quiz" type="radio" value={answer} checked={quizAnswer === answer} onChange={(event) => { setQuizAnswer(event.target.value); setQuizSubmitted(false) }} /><span>{answer}</span></label>)}<button className="button button--primary button--full" disabled={!quizAnswer} type="button" onClick={() => setQuizSubmitted(true)}>정답 확인</button>{quizSubmitted && <InlineNotice tone={quizAnswer === 'SecurityContext' ? 'success' : 'danger'}>{quizAnswer === 'SecurityContext' ? '정답입니다. 현재 요청의 인증 주체를 보관합니다.' : '다시 생각해 보세요. 세션 저장소와 요청 컨텍스트는 책임이 다릅니다.'}</InlineNotice>}</div>}
        </aside>
      </div>
    </div>
  )
}
