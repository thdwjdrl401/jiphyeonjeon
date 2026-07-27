import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { instructorPaths } from '@/app/router/paths'
import yeongsilImage from '@/assets/yeongsil.png'
import { useAuth } from '@/features/auth/AuthContext'
import { getLesson } from '@/features/lesson/lessonService'
import CaptionDock from '@/features/live-session/CaptionDock'
import LearningSidebar from '@/features/live-session/LearningSidebar'
import { getLiveLearningPreview, type LearningPanel } from '@/features/live-session/liveLearningPreview'
import {
  askLiveAi,
  endLiveSession,
  getCaptions,
  getChatMessages,
  getLiveSession,
  getQuestionHighlights,
  saveBookmark,
  sendChatMessage,
  type ChatMessageView,
} from '@/features/live-session/liveSessionService'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import PageState from '@/shared/ui/PageState'
import { InlineNotice, StatusBadge } from '@/shared/ui/WorkspaceUi'

const liveEdgeMs = 779_000
const { summaryBlocks, glossaryTerms } = getLiveLearningPreview()

function formatSessionTime(sessionMs: number) {
  const seconds = Math.floor(sessionMs / 1000)
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function timeLabelToMs(label: string) {
  const [minutes, seconds] = label.split(':').map(Number)
  return (minutes * 60 + seconds) * 1000
}

export default function LiveClassroomPage() {
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const isInstructor = user?.role === 'INSTRUCTOR'
  const sessionQuery = useQuery({ queryKey: ['live-session', sessionId], queryFn: () => getLiveSession(sessionId), enabled: Boolean(sessionId) })
  const lessonQuery = useQuery({
    queryKey: ['live-classroom-lesson', sessionQuery.data?.lessonId, user?.role],
    queryFn: () => getLesson({ lessonId: sessionQuery.data!.lessonId, role: user?.role, userId: user?.userId }),
    enabled: Boolean(sessionQuery.data?.lessonId),
  })
  const chatQuery = useQuery({ queryKey: ['live-chat', sessionId], queryFn: () => getChatMessages(sessionId), enabled: Boolean(sessionId) })
  const captionsQuery = useQuery({ queryKey: ['live-captions', sessionId], queryFn: () => getCaptions(sessionId), enabled: Boolean(sessionId) })
  const questionsQuery = useQuery({ queryKey: ['live-question-highlights', sessionId], queryFn: () => getQuestionHighlights(sessionId), enabled: isInstructor && Boolean(sessionId) })
  const session = sessionQuery.data
  const lesson = lessonQuery.data
  const messages = chatQuery.data ?? []
  const captions = captionsQuery.data ?? []
  const instructorQuestions = questionsQuery.data ?? []
  const [panel, setPanel] = useState<LearningPanel>('discussion')
  const [selectedTermId, setSelectedTermId] = useState<string | null>(null)
  const [positionMs, setPositionMs] = useState(liveEdgeMs)
  const [message, setMessage] = useState('')
  const [isQuestion, setIsQuestion] = useState(false)
  const [aiQuestion, setAiQuestion] = useState('')
  const [aiAnswer, setAiAnswer] = useState('')
  const [bookmarked, setBookmarked] = useState(false)
  const [endRequested, setEndRequested] = useState(false)
  // 라이브는 녹화되고 채팅·자막이 AI 처리된다는 안내를 입장 시 한 번 확인받는다.
  // 상시 배너 대신 진입 모달로 알려 시야를 가리지 않게 한다.
  const [recordingNoticeAck, setRecordingNoticeAck] = useState(false)
  const isLive = liveEdgeMs - positionMs < 3_000
  const sendMutation = useMutation({
    mutationFn: ({ text, question }: { text: string; question: boolean }) => sendChatMessage(sessionId, text, question),
    onSuccess: (sent) => queryClient.setQueryData<ChatMessageView[]>(['live-chat', sessionId], (current = []) => [...current, sent]),
  })
  const aiMutation = useMutation({ mutationFn: (question: string) => askLiveAi(lesson!.lessonId, question), onSuccess: (data) => setAiAnswer(data.answer) })
  const bookmarkMutation = useMutation({ mutationFn: () => saveBookmark(lesson!.lessonId, positionMs), onSuccess: () => setBookmarked(true) })
  const endMutation = useMutation({ mutationFn: () => endLiveSession(sessionId), onSuccess: () => navigate(instructorPaths.processing(sessionId)) })
  usePageTitle(`LIVE · ${lesson?.title ?? ''}`)

  const sendMessage = (event: FormEvent) => {
    event.preventDefault()
    if (!message.trim()) return
    sendMutation.mutate({ text: message.trim(), question: isInstructor ? false : isQuestion })
    setMessage('')
    setIsQuestion(false)
  }

  const askAi = (event: FormEvent) => {
    event.preventDefault()
    if (!aiQuestion.trim()) return
    aiMutation.mutate(aiQuestion.trim())
  }

  const openGlossaryTerm = (termId: string) => {
    setSelectedTermId(termId)
    setPanel('glossary')
  }

  // 진입 게이트에는 이 화면의 정체성인 세션·레슨만 둔다.
  // 자막·질문 하이라이트는 아직 서버 경로가 없어(CP2) 늘 실패하는데, 여기에 섞으면
  // 나머지가 멀쩡해도 라이브 화면 전체가 뜨지 않는다. 패널 안에서 각자 안내한다.
  //
  // 실패 검사를 로딩보다 먼저 한다. 레슨 조회는 세션 결과에 의존해(enabled) 세션이 실패하면
  // 비활성인 채 영원히 isPending으로 남는다 — 로딩을 먼저 보면 오류 화면에 닿지 못한다.
  if (!sessionId) return <PageState title="잘못된 라이브 세션 경로입니다" />
  if (sessionQuery.isError || lessonQuery.isError) return <PageState title="라이브 강의를 불러오지 못했습니다" />
  if (!session || !lesson) return <PageState title="라이브 강의를 불러오는 중입니다" />

  const discussionComposer = (
    <form className="chat-composer" onSubmit={sendMessage}>
      <textarea aria-label="채팅 메시지" rows={2} value={message} placeholder="메시지를 입력하세요" onChange={(event) => setMessage(event.target.value)} />
      <div>
        {!isInstructor
          ? <label><input type="checkbox" checked={isQuestion} onChange={(event) => setIsQuestion(event.target.checked)} /> 질문으로 등록</label>
          : <span>강사 메시지로 전송됩니다.</span>}
        <button className="button button--primary button--small" type="submit">전송</button>
      </div>
    </form>
  )

  const aiContent = (
    <>
      <div className="ai-empty"><img className="ai-empty__avatar" src={yeongsilImage} alt="AI 질문 도우미 영실" /><h3>한 번 아뢰어 보거라</h3><p>강의 자료와 현재 재생 시점까지의 발화를 근거로 답변합니다.</p></div>
      {aiAnswer && <div className="ai-answer"><strong>답변</strong><p>{aiAnswer}</p><small>근거 · 12번 슬라이드, 12:08–12:41 발화</small></div>}
      <form onSubmit={askAi}><textarea rows={3} value={aiQuestion} placeholder="예: SecurityContext와 세션은 어떻게 다른가요?" onChange={(event) => setAiQuestion(event.target.value)} /><button className="button button--primary button--full" type="submit">질문하기</button></form>
    </>
  )

  return (
    <div className={`media-page media-page--live${isInstructor ? ' media-page--instructor' : ''}`}>
      {!recordingNoticeAck && (
        <div className="recording-consent-overlay" role="dialog" aria-modal="true" aria-labelledby="recording-consent-title">
          <div className="recording-consent-modal">
            <span className="recording-consent-modal__badge"><i aria-hidden="true" /> 녹화 안내</span>
            <h2 id="recording-consent-title">이 강의는 녹화됩니다</h2>
            <p>AI 기능 제공을 위해 채팅과 자막이 함께 처리됩니다. 참여하면 안내를 확인한 것으로 간주됩니다.</p>
            <button className="button button--primary button--full" type="button" onClick={() => setRecordingNoticeAck(true)}>확인하고 참여하기</button>
          </div>
        </div>
      )}

      {isInstructor && (
        <section className="instructor-live-console" aria-label="강사 라이브 운영 상태">
          <div><span>송출</span><strong>LIVE</strong><small>카메라·화면 공유 정상</small></div>
          <div><span>녹화</span><strong>RECORDING</strong><small>Egress HLS 저장 중</small></div>
          <div><span>실시간 자막</span><strong>ACTIVE</strong><small>지연 1.2초</small></div>
          <div><span>질문</span><strong>{instructorQuestions.reduce((sum, item) => sum + item.count, 0)}개</strong><small>집중 구간 {instructorQuestions.length}곳</small></div>
        </section>
      )}

      {isInstructor && endRequested && (
        <div className="instructor-end-confirm" role="alert">
          <div><strong>라이브 강의를 종료할까요?</strong><p>학생 연결을 종료하고 녹화·AI 후처리 단계로 이동합니다.</p></div>
          <div><button className="button button--ghost button--small" type="button" onClick={() => setEndRequested(false)}>계속 진행</button><button className="button button--primary button--small" type="button" disabled={endMutation.isPending} onClick={() => endMutation.mutate()}>종료하고 처리 현황 보기</button></div>
        </div>
      )}

      <div className="media-layout">
        <section className="media-primary">
          <div className="video-stage" tabIndex={0}>
            <div className="video-stage__glow" />
            <header className="video-status-overlay" aria-label="라이브 강의 정보">
              <div className="video-status-overlay__identity"><span className="live-dot" /><strong>LIVE</strong><h1>{lesson.title}</h1><small>강의 {sessionId}</small></div>
              <div className="video-status-overlay__status">
                {isInstructor && <StatusBadge tone="warning">강사 운영 모드</StatusBadge>}
                <StatusBadge tone="success">연결 안정적</StatusBadge>
                <span>{session.participants}명 참여 중</span>
                {isInstructor && <button className="button button--soft button--small" type="button" onClick={() => setEndRequested(true)}>강의 종료</button>}
              </div>
            </header>
            <div className="slide-preview"><span>SPRING SECURITY</span><h2>요청은 어떻게<br />인증되는가?</h2><div className="slide-code">SecurityFilterChain → Authentication → SecurityContext</div></div>
            <div className="video-controls-overlay" aria-label="라이브 재생 컨트롤">
              <div className="timeline-row"><span>00:00</span><input aria-label="라이브 타임라인" min="0" max={liveEdgeMs} type="range" value={positionMs} onChange={(event) => setPositionMs(Number(event.target.value))} /><span>{formatSessionTime(positionMs)}</span></div>
              <div className="control-row">
                <div>{isInstructor ? <><button type="button">마이크 켜짐</button><button type="button">카메라 켜짐</button><button type="button">화면 공유 중</button></> : <button className={bookmarked ? 'is-active' : ''} type="button" onClick={() => bookmarkMutation.mutate()}>{bookmarked ? '★ 북마크됨' : '☆ 북마크'}</button>}</div>
                <button className={`go-live${isLive ? ' is-live' : ''}`} type="button" onClick={() => setPositionMs(liveEdgeMs)}><i /> LIVE{!isLive && '로 이동'}</button>
              </div>
            </div>
          </div>

          <CaptionDock captions={captions} currentSessionMs={positionMs} label="실시간 자막" onSeek={setPositionMs} onSelectTerm={openGlossaryTerm} />

          {!isLive && <InlineNotice>현재 라이브보다 {formatSessionTime(liveEdgeMs - positionMs)} 이전을 재생하고 있습니다. 영상과 자막이 같은 시각으로 이동했습니다.</InlineNotice>}
          {isInstructor && <div className="question-strip"><strong>질문 집중 구간</strong>{instructorQuestions.map((question) => <button type="button" key={question.at} onClick={() => { setPositionMs(timeLabelToMs(question.at)); setPanel('discussion') }}><span>{question.at}</span> {question.count}개 질문</button>)}</div>}
        </section>

        <LearningSidebar
          panel={panel}
          onPanelChange={setPanel}
          currentSessionMs={positionMs}
          onSeek={setPositionMs}
          selectedTermId={selectedTermId}
          onSelectedTermChange={setSelectedTermId}
          summaryBlocks={summaryBlocks}
          glossaryTerms={glossaryTerms}
          messages={messages}
          discussionComposer={discussionComposer}
          aiContent={aiContent}
          noteContext="LIVE"
        />
      </div>
    </div>
  )
}
