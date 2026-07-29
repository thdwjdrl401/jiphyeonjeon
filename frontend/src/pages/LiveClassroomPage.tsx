import { lazy, Suspense, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { instructorPaths } from '@/app/router/paths'
import yeongsilImage from '@/assets/yeongsil.png'
import { useAuth } from '@/features/auth/AuthContext'
import { getLesson } from '@/features/lesson/lessonService'
import CaptionDock from '@/features/live-session/CaptionDock'
import {
  emptyCaptionStreamState,
  reduceCaptionStream,
  selectCaptionViews,
} from '@/features/live-session/captionAdapter'
import LearningSidebar from '@/features/live-session/LearningSidebar'
import { getLiveLearningPreview, type LearningPanel } from '@/features/live-session/liveLearningPreview'
import {
  askLiveAi,
  endLiveSession,
  getChatMessages,
  getLiveSession,
  saveBookmark,
  sendChatMessage,
  subscribeCaptions,
  subscribeChatMessages,
  type CaptionView,
  type ChatConnectionState,
  type ChatMessageView,
} from '@/features/live-session/liveSessionService'
import type { PlaybackSeekRequest } from '@/features/live-session/PlaybackPlayer'
import { useDetachedSidebarWindow } from '@/features/live-session/useDetachedSidebarWindow'
import { usePlayback } from '@/features/live-session/usePlayback'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import PageState from '@/shared/ui/PageState'

const { summaryBlocks, glossaryTerms } = getLiveLearningPreview()
const InstructorLiveKitStage = lazy(() => import('@/features/live-session/InstructorLiveKitStage'))
const PlaybackPlayer = lazy(() => import('@/features/live-session/PlaybackPlayer'))

function mergeChatMessage(messages: ChatMessageView[], incoming: ChatMessageView) {
  const existingIndex = messages.findIndex((message) => message.id === incoming.id)
  if (existingIndex < 0) return [...messages, incoming]
  return messages.map((message, index) => index === existingIndex ? incoming : message)
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
  const session = sessionQuery.data
  const lesson = lessonQuery.data
  const messages = chatQuery.data ?? []
  // 라이브 자막은 REST 스냅샷이 아니라 WS 델타 스트림으로 구동한다(§3-4 / ADR-0043).
  // 누적기는 ref에 두고, 파생 CaptionView[]만 state로 올려 CaptionDock에 넘긴다.
  const captionAccumulator = useRef(emptyCaptionStreamState())
  const [captions, setCaptions] = useState<CaptionView[]>([])
  const [captionConnectionState, setCaptionConnectionState] = useState<ChatConnectionState>('connecting')
  const [panel, setPanel] = useState<LearningPanel>('discussion')
  const [selectedTermId, setSelectedTermId] = useState<string | null>(null)
  const [positionMs, setPositionMs] = useState(0)
  const [message, setMessage] = useState('')
  const [isQuestion, setIsQuestion] = useState(false)
  const [aiQuestion, setAiQuestion] = useState('')
  const [aiAnswer, setAiAnswer] = useState('')
  const [bookmarked, setBookmarked] = useState(false)
  const [studentSeekRequest, setStudentSeekRequest] = useState<PlaybackSeekRequest | null>(null)
  const [endRequested, setEndRequested] = useState(false)
  const [chatConnectionState, setChatConnectionState] = useState<ChatConnectionState>('connecting')
  const sidebarWindow = useDetachedSidebarWindow(sessionId)
  // 라이브는 녹화되고 채팅·자막이 AI 처리된다는 안내를 입장 시 한 번 확인받는다.
  // 상시 배너 대신 진입 모달로 알려 시야를 가리지 않게 한다.
  const [recordingNoticeAck, setRecordingNoticeAck] = useState(false)
  // 강사는 LiveKit로 직접 송출하므로 재생 경로를 타지 않는다. 학생도 녹화 안내를 확인한 뒤에 붙는다.
  const playback = usePlayback(sessionQuery.data?.lessonId, !isInstructor && recordingNoticeAck)
  const sendMutation = useMutation({
    mutationFn: ({ text, question }: { text: string; question: boolean }) => sendChatMessage(sessionId, text, question),
    onSuccess: (sent) => queryClient.setQueryData<ChatMessageView[]>(
      ['live-chat', sessionId],
      (current = []) => mergeChatMessage(current, sent),
    ),
  })
  const aiMutation = useMutation({ mutationFn: (question: string) => askLiveAi(lesson!.lessonId, question), onSuccess: (data) => setAiAnswer(data.answer) })
  const bookmarkMutation = useMutation({ mutationFn: () => saveBookmark(lesson!.lessonId, positionMs), onSuccess: () => setBookmarked(true) })
  const endMutation = useMutation({ mutationFn: () => endLiveSession(sessionId), onSuccess: () => navigate(instructorPaths.processing(sessionId)) })
  useEffect(() => {
    if (!sessionId) return undefined
    return subscribeChatMessages(
      sessionId,
      (incoming) => queryClient.setQueryData<ChatMessageView[]>(
        ['live-chat', sessionId],
        (current = []) => mergeChatMessage(current, incoming),
      ),
      setChatConnectionState,
    )
  }, [queryClient, sessionId])
  useEffect(() => {
    if (!sessionId) return undefined
    captionAccumulator.current = emptyCaptionStreamState()
    setCaptions([])
    return subscribeCaptions(
      sessionId,
      (event) => {
        captionAccumulator.current = reduceCaptionStream(captionAccumulator.current, event)
        setCaptions(selectCaptionViews(captionAccumulator.current))
      },
      setCaptionConnectionState,
    )
  }, [sessionId])
  usePageTitle(`LIVE · ${lesson?.title ?? ''}`)

  const sendMessage = (event: FormEvent) => {
    event.preventDefault()
    if (!message.trim()) return
    sendMutation.mutate({ text: message.trim(), question: isInstructor ? false : isQuestion })
    setMessage('')
    setIsQuestion(false)
  }

  const handleMessageKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    if (event.ctrlKey) {
      event.preventDefault()
      const textarea = event.currentTarget
      const selectionStart = textarea.selectionStart
      const selectionEnd = textarea.selectionEnd
      const nextCursor = selectionStart + 1
      setMessage(`${message.slice(0, selectionStart)}\n${message.slice(selectionEnd)}`)
      Promise.resolve().then(() => textarea.setSelectionRange(nextCursor, nextCursor))
      return
    }
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
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

  const seekSession = (sessionMs: number) => {
    setPositionMs(sessionMs)
    if (!isInstructor) {
      setStudentSeekRequest((current) => ({
        sessionMs,
        sequence: (current?.sequence ?? 0) + 1,
      }))
    }
  }

  // 진입 게이트에는 이 화면의 정체성인 세션·레슨만 둔다.
  // 자막은 WS 델타 스트림으로 구동하며(§3-4), 연결 실패해도 게이트를 막지 않는다 —
  // 자막 없이도 미디어·채팅은 살아 있어야 한다. 연결 상태는 자막 독 헤더에서 안내한다.
  //
  // 실패 검사를 로딩보다 먼저 한다. 레슨 조회는 세션 결과에 의존해(enabled) 세션이 실패하면
  // 비활성인 채 영원히 isPending으로 남는다 — 로딩을 먼저 보면 오류 화면에 닿지 못한다.
  if (!sessionId) return <PageState title="잘못된 라이브 세션 경로입니다" />
  if (sessionQuery.isError || lessonQuery.isError) return <PageState title="라이브 강의를 불러오지 못했습니다" />
  if (!session || !lesson) return <PageState title="라이브 강의를 불러오는 중입니다" />

  const discussionComposer = (
    <form className="chat-composer" onSubmit={sendMessage}>
      <textarea
        aria-label="채팅 메시지"
        rows={2}
        value={message}
        placeholder="메시지를 입력하세요 (Enter 전송 · Ctrl+Enter 줄바꿈)"
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={handleMessageKeyDown}
      />
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

  // 자막이 이미 흐르면(누적 라인 존재) 연결 문구로 시야를 어지럽히지 않는다.
  // 아직 한 줄도 없을 때만 연결 상태를 안내한다.
  const captionNote = captions.length > 0 || captionConnectionState === 'connected'
    ? undefined
    : captionConnectionState === 'connecting'
      ? '실시간 자막을 연결하고 있습니다.'
      : captionConnectionState === 'reconnecting'
        ? '실시간 자막 연결이 끊겨 다시 연결하고 있습니다.'
        : captionConnectionState === 'error'
          ? '실시간 자막 연결에 문제가 생겼습니다. 자동 재연결을 시도합니다.'
          : '실시간 자막 연결이 종료되었습니다.'

  const chatConnectionNotice = chatConnectionState === 'connected'
    ? undefined
    : chatConnectionState === 'connecting'
      ? '실시간 채팅을 연결하고 있습니다.'
      : chatConnectionState === 'reconnecting'
        ? '실시간 채팅 연결이 끊겨 다시 연결하고 있습니다.'
        : chatConnectionState === 'error'
          ? '실시간 채팅 연결에 문제가 생겼습니다. 자동 재연결을 시도합니다.'
          : '실시간 채팅 연결이 종료되었습니다.'

  const sidebar = (
    <LearningSidebar
      panel={panel}
      onPanelChange={setPanel}
      currentSessionMs={positionMs}
      onSeek={seekSession}
      selectedTermId={selectedTermId}
      onSelectedTermChange={setSelectedTermId}
      summaryBlocks={summaryBlocks}
      glossaryTerms={glossaryTerms}
      messages={messages}
      discussionComposer={discussionComposer}
      discussionNotice={chatConnectionNotice}
      aiContent={aiContent}
      noteContext="LIVE"
      windowAction={isInstructor
        ? (
          <>
            <span className="learning-sidebar-windowbar__status">
              {sidebarWindow.isDetached
                ? sidebarWindow.mode === 'picture-in-picture' ? '항상 위 패널' : '별도 팝업'
                : '화면 공유 중에도 채팅 확인'}
            </span>
            {sidebarWindow.error && <span className="learning-sidebar-windowbar__error" role="alert">{sidebarWindow.error}</span>}
            <button
              className="learning-sidebar-windowbar__button"
              type="button"
              onClick={sidebarWindow.isDetached ? sidebarWindow.close : sidebarWindow.open}
            >
              {sidebarWindow.isDetached ? '패널 합치기' : '운영 패널 분리'}
            </button>
          </>
        )
        : undefined}
    />
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

      {isInstructor && endRequested && (
        <div className="instructor-end-confirm" role="alert">
          <div><strong>라이브 강의를 종료할까요?</strong><p>학생 연결을 종료하고 녹화·AI 후처리 단계로 이동합니다.</p></div>
          <div><button className="button button--ghost button--small" type="button" onClick={() => setEndRequested(false)}>계속 진행</button><button className="button button--primary button--small" type="button" disabled={endMutation.isPending} onClick={() => endMutation.mutate()}>종료하고 처리 현황 보기</button></div>
        </div>
      )}

      <div className={`media-layout${isInstructor && sidebarWindow.isDetached ? ' is-sidebar-detached' : ''}`}>
        <section className="media-primary">
          {isInstructor
            ? (
              <Suspense fallback={<div className="video-stage instructor-livekit-loading" role="status">LiveKit 송출 도구를 불러오는 중입니다.</div>}>
                <InstructorLiveKitStage
                  lessonTitle={lesson.title}
                  participantCount={session.participants}
                  sessionId={sessionId}
                  onRequestEnd={() => setEndRequested(true)}
                />
              </Suspense>
            )
            : (
              <Suspense fallback={<div className="video-stage instructor-livekit-loading" role="status">Vidstack 플레이어를 불러오는 중입니다.</div>}>
                <PlaybackPlayer
                  bookmarked={bookmarked}
                  errorMessage={playback.errorMessage}
                  lessonTitle={lesson.title}
                  loading={playback.loading}
                  participantCount={session.participants}
                  playback={playback.playback}
                  reloadToken={playback.reloadToken}
                  seekRequest={studentSeekRequest}
                  onBookmark={() => bookmarkMutation.mutate()}
                  onRetry={playback.reload}
                  onSessionTimeChange={setPositionMs}
                />
              </Suspense>
            )}

          <CaptionDock captions={captions} currentSessionMs={positionMs} label="실시간 자막" note={captionNote} onSeek={seekSession} onSelectTerm={openGlossaryTerm} />
        </section>

        {(!isInstructor || !sidebarWindow.isDetached) && sidebar}
        {isInstructor && sidebarWindow.portalContainer && createPortal(sidebar, sidebarWindow.portalContainer)}
      </div>
    </div>
  )
}
