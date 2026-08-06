import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { instructorPaths } from '@/app/router/paths'
import PersonalAiQuestionPanel, { type AskAiAnswer } from '@/features/ai/PersonalAiQuestionPanel'
import { useAuth } from '@/features/auth/AuthContext'
import { getLesson } from '@/features/lesson/lessonService'
import { resolveLessonPath } from '@/features/lesson/lessonRouting'
import WatchHeatmapCurve from '@/features/live-session/WatchHeatmapCurve'
import { useWatchTracking } from '@/features/live-session/useWatchTracking'
import { mergeLectureNote } from '@/features/live-session/lectureNoteMerge'
import { attachGlossary } from '@/features/live-session/glossaryView'
import CaptionDock from '@/features/live-session/CaptionDock'
import {
  emptyCaptionStreamState,
  reduceCaptionStream,
  selectCaptionViews,
  selectVisibleCaptions,
} from '@/features/live-session/captionAdapter'
import LearningSidebar, { type GlossaryFocusRequest } from '@/features/live-session/LearningSidebar'
import LivePrestartStage from '@/features/live-session/LivePrestartStage'
import { isPrestartStatus, prestartNotice } from '@/features/live-session/livePrestart'
import type { LearningPanel } from '@/features/live-session/liveLearningPreview'
import {
  askLiveAi,
  endLiveSession,
  getCaptions,
  getChatMessages,
  getAiAnswerHistory,
  getGlossary,
  getLectureNotes,
  getLiveSession,
  getWatchHeatmap,
  sendChatMessage,
  subscribeCaptions,
  subscribeChatMessages,
  subscribeLectureNotes,
  subscribeSessionState,
  type CaptionView,
  type LectureNoteView,
  type ChatConnectionState,
  type ChatMessageView,
  type LiveSessionView,
  type SendChatMessageInput,
} from '@/features/live-session/liveSessionService'
import type { PlaybackSeekRequest } from '@/features/live-session/PlaybackPlayer'
import { useDetachedSidebarWindow } from '@/features/live-session/useDetachedSidebarWindow'
import { usePlayback } from '@/features/live-session/usePlayback'
import { useResizablePane } from '@/features/live-session/useResizablePane'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import PageState from '@/shared/ui/PageState'
import { isMockApiEnabled, isTestMode } from '@/shared/config/runtime'

const DevLivePanel = lazy(() => import('@/features/live-session/DevLivePanel'))
/** mock API가 실제로 응답을 만들어 줄 때만 의미가 있다 — HTTP 모드에선 패널이 아무것도 못 흔든다. */
const showDevLivePanel = import.meta.env.DEV && isMockApiEnabled && !isTestMode

const InstructorLiveKitStage = lazy(() => import('@/features/live-session/InstructorLiveKitStage'))
const PlaybackPlayer = lazy(() => import('@/features/live-session/PlaybackPlayer'))

/**
 * 같은 메시지를 두 번 그리지 않게 합친다. 한 메시지가 세 번 도착할 수 있다 —
 * 낙관적 항목(전송 즉시) → WS 브로드캐스트 에코 → REST 전송 응답. messageId는 서버가 붙이므로
 * 낙관적 항목엔 없고, `clientMessageId`가 세 경로를 잇는 유일한 키다.
 *
 * `mine`은 WS 에코에 없다(토픽 브로드캐스트는 뷰어별이 될 수 없다). 그래서 이미 내 것으로 확정된
 * 항목을 에코가 덮어 좌측으로 튀지 않도록 기존 값을 살린다.
 */
export function mergeChatMessage(messages: ChatMessageView[], incoming: ChatMessageView) {
  const existingIndex = messages.findIndex((message) => (
    incoming.clientMessageId !== undefined && message.clientMessageId === incoming.clientMessageId
  ) || message.id === incoming.id)
  if (existingIndex < 0) return [...messages, incoming]
  const existing = messages[existingIndex]
  const merged: ChatMessageView = { ...incoming, mine: incoming.mine ?? existing.mine }
  return messages.map((message, index) => index === existingIndex ? merged : message)
}

/** 낙관적 항목·서버 응답·WS 에코를 잇는 키. 서버는 이 값으로 재전송을 멱등 처리한다. */
function createClientMessageId() {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
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
  const session = sessionQuery.data
  const lesson = lessonQuery.data
  /*
   * 강의 <b>내용</b>(자막·노트·채팅 기록·AI 기록)을 읽어도 되는가.
   *
   * <p>서버가 같은 판정을 한다(`LiveAccessGuard.requireCanReadContent`) — 수강생이 시작 전에 물으면
   * 409다. 여기서 막는 것은 그 409를 안 만나기 위해서가 아니라 <b>없는 것을 묻지 않기 위해서</b>다.
   * 이 넷은 전부 강의가 시작된 뒤에 생긴다.
   *
   * <p>세션을 <b>받은 뒤에</b> 판단한다. 상태를 모르는 채로 먼저 쏘면 시작 전 세션에 한 번씩 헛물을
   * 켠다. 이 조회들은 복원용이라 한 왕복 늦어도 첫 화면이 밀리지 않는다.
   *
   * <p>강사는 상태와 무관하다 — 서버도 소유 강사는 통과시킨다.
   */
  const canReadContent = Boolean(session) && (isInstructor || !isPrestartStatus(session?.status))
  const chatQuery = useQuery({ queryKey: ['live-chat', sessionId], queryFn: () => getChatMessages(sessionId), enabled: Boolean(sessionId) && canReadContent })
  // 저장된 자막 리로드(CAPTION-01, ADR-0045). 마운트 시 세션-ms 순 자막을 받아 WS 누적기에 시드해
  // 새로고침·재연결 뒤 이전 자막을 복원한다. 실패해도 진입 게이트를 막지 않는다(자막 없이도 미디어·채팅은 산다).
  // 강사는 자막 독을 그리지 않는다(아래 렌더 참고). 자막을 쓰는 곳이 없으므로 리로드도 하지 않는다 —
  // 송출 중인 브라우저에서 쓰지도 않을 자막을 받아 두는 것은 그대로 낭비다.
  const captionReloadQuery = useQuery({ queryKey: ['live-captions', sessionId], queryFn: () => getCaptions(sessionId), enabled: Boolean(sessionId) && !isInstructor && canReadContent })
  // 라이브 송출이 끝나도 이 세션의 후속 토론·복습 질문은 이어 간다. 자막 seek와 미디어 상태는
  // hasEnded로 별도 잠그므로 대화 가능 상태와 섞지 않는다.
  const canUseConversation = session?.status === 'LIVE'
    || session?.status === 'ENDING'
    || session?.status === 'ENDED'
  const hasEnded = session?.status === 'ENDED'
  /*
   * 아직 시작하지 않은 강의에 들어와 있다.
   *
   * <p>입장창은 <b>시계가 연다</b>(예정 시각 −N분) — 강사가 여는 것이 아니다. 그래서 강사가 시작을
   * 누르기 전에도 이 화면에 사람이 있고, 그 상태에도 이름이 필요하다. 재생·채팅·질문이 모두 잠기는데
   * 왜 잠겼는지는 각 자리에서 따로 말한다(잠금 하나에 안내 하나).
   *
   * <p>`STARTING`을 여기 포함하는 이유: 시작 게이트(STT dispatch·Egress·마이크 확인)는 수 초가 걸리고
   * 그동안 재생할 것이 아직 없다. 다만 기다림의 성격은 다르므로 문구는 아래에서 갈라 쓴다.
   *
   * <p>강사는 해당 없다 — LiveKit으로 직접 송출하므로 재생 경로를 타지 않는다.
   */
  const isBeforeLive = !isInstructor && isPrestartStatus(session?.status)
  const isStarting = session?.status === 'STARTING'
  const messages = chatQuery.data ?? []
  // 라이브 자막은 REST 스냅샷이 아니라 WS 델타 스트림으로 구동한다(§3-4 / ADR-0043).
  // 누적기는 ref에 두고, 파생 CaptionView[]만 state로 올려 CaptionDock에 넘긴다.
  const captionAccumulator = useRef(emptyCaptionStreamState())
  const [captions, setCaptions] = useState<CaptionView[]>([])
  const [captionConnectionState, setCaptionConnectionState] = useState<ChatConnectionState>('connecting')
  const [panel, setPanel] = useState<LearningPanel>('discussion')
  const [selectedTermId, setSelectedTermId] = useState<string | null>(null)
  const [glossaryFocusRequest, setGlossaryFocusRequest] = useState<GlossaryFocusRequest | null>(null)
  const [positionMs, setPositionMs] = useState(0)
  const [message, setMessage] = useState('')
  // 익명은 기본 꺼짐 — 켰을 때만 세션 한정 가명으로 나간다(ADR-0050). 끄면 본인이 지정한 표시 이름.
  const [anonymous, setAnonymous] = useState(false)
  // 재생바 위에 재시청 곡선을 얹으려면 플레이어 루트가 필요하다(WatchHeatmapCurve).
  const [playerRoot, setPlayerRoot] = useState<HTMLElement | null>(null)
  /*
   * PersonalAiQuestionPanel은 history를 "한 번만" 되살린다 — 이미 턴이 있으면 이후 restore는
   * 무시한다(진행 중인 실제 대화를 늦게 온 조회가 지우지 않기 위해서다). 그래서 DevLivePanel이
   * AI 기록을 추가·초기화해도 이 패널은 반영하지 않는다. 개발 도구가 값을 바꿀 때만 이 값을
   * 올려 key로 꽂아 그 순간만 컴포넌트를 새로 마운트시킨다 — 실제 질문·답변 흐름이 쓰는
   * invalidateQueries 경로는 건드리지 않는다.
   */
  const [aiHistoryDevVersion, setAiHistoryDevVersion] = useState(0)
  /*
   * 영상·자막·사이드패널의 배분은 사람마다 다르다. 경계를 끌어 정하고, 최소치 아래로 끌면 접힌다.
   * 강사 화면에는 자막 독이 없으므로 세로 손잡이도 두지 않는다.
   */
  const sidebarPane = useResizablePane({
    storageKey: 'liveclass.live.sidebarWidth',
    defaultSize: 370, min: 260, max: 620, axis: 'inline', direction: -1,
    label: '사이드 패널 너비 조절',
  })
  const captionPane = useResizablePane({
    storageKey: 'liveclass.live.captionHeight',
    defaultSize: 96, min: 96, max: 420, axis: 'block', direction: -1,
    label: '자막 높이 조절',
  })
  const [studentSeekRequest, setStudentSeekRequest] = useState<PlaybackSeekRequest | null>(null)
  const [endRequested, setEndRequested] = useState(false)
  const [chatConnectionState, setChatConnectionState] = useState<ChatConnectionState>('connecting')
  const sidebarWindow = useDetachedSidebarWindow(sessionId)
  // 라이브는 녹화되고 채팅·자막이 AI 처리된다는 안내를 입장 시 한 번 확인받는다.
  // 상시 배너 대신 진입 모달로 알려 시야를 가리지 않게 한다.
  const [recordingNoticeAck, setRecordingNoticeAck] = useState(false)
  /*
   * 강사는 LiveKit로 직접 송출하므로 재생 경로를 타지 않는다. 학생도 녹화 안내를 확인한 뒤에 붙는다.
   *
   * <p><b>시작 전에는 아예 조회하지 않는다.</b> 녹화 자산은 시작 시점에 만들어지므로 그 전에 물으면
   * 없는 것이 당연한데, 화면에는 "시청할 수 있는 영상이 없습니다"라는 <b>오류</b>로 나온다 — 기다리면
   * 되는 상황을 고장으로 읽히게 한다. 3초마다 실패할 요청을 보내지도 않는다.
   */
  const playback = usePlayback(
    sessionQuery.data?.lessonId,
    !isInstructor && !isBeforeLive && (recordingNoticeAck || hasEnded),
  )
  const sendMutation = useMutation({
    mutationFn: (input: SendChatMessageInput) => sendChatMessage(sessionId, input),
    // 낙관적 항목을 먼저 올린다 — 내 말풍선이 전송 즉시 우측에 보여야 한다. clientMessageId가
    // 낙관적 항목·WS 에코·전송 응답을 잇는 키다(mergeChatMessage).
    onMutate: (input) => queryClient.setQueryData<ChatMessageView[]>(
      ['live-chat', sessionId],
      (current = []) => mergeChatMessage(current, {
        id: input.clientMessageId,
        clientMessageId: input.clientMessageId,
        // 서버가 확정할 값이라 여기서 가명/표시 이름을 흉내내지 않는다 — 내 말풍선엔 이름을 쓰지 않는다.
        alias: '',
        text: input.text,
        time: '',
        question: input.question,
        mine: true,
        pending: true,
      }),
    ),
    onSuccess: (sent) => queryClient.setQueryData<ChatMessageView[]>(
      ['live-chat', sessionId],
      (current = []) => mergeChatMessage(current, sent),
    ),
  })
  // AI 질의응답은 뮤테이션이 아니라 SSE 스트림이다(ADR-0047) — 응답 하나가 아니라 델타가 여러 번 온다.
  // 세션 스코프라 lessonId가 아니라 sessionId를 넘긴다(서버가 lessonId를 세션에서 조회해 채운다).
  const askAi = useCallback<AskAiAnswer>(
    async (question, options) => {
      try {
        await askLiveAi(sessionId, question, options)
      } finally {
        /*
         * 답변이 끝나면 <b>서버 기록을 다시 읽는다.</b> 서버는 스트리밍하는 동안 답변을 남기는데
         * (ADR-0062), 화면의 기록 조회는 그대로라 방금 받은 답변만 이 컴포넌트 안에 있었다.
         * 그러면 다른 경로로 대화가 복원될 때(강사의 분리 패널 등) 방금 것이 빠진 채로 보인다.
         *
         * 실패해도 읽는다 — 받은 데까지 남는 것이 계약이다. 이미 화면에 있는 대화를 덮지는
         * 않는다(`restore`는 대화가 비어 있을 때만 적용된다).
         */
        void queryClient.invalidateQueries({ queryKey: ['ai-answers', sessionId] })
      }
    },
    [queryClient, sessionId],
  )
  const endMutation = useMutation({
    mutationFn: () => endLiveSession(sessionId),
    onSuccess: (endedSession) => {
      // 종료 응답이 가진 정본 맥락으로 돌아간다. 녹화 처리는 백그라운드에서 계속되고,
      // 강사는 강의 상세에서 준비 중/다시보기 가능 상태를 필요할 때 확인한다(ADR-0092).
      queryClient.setQueryData<LiveSessionView>(['live-session', sessionId], endedSession)
      void queryClient.invalidateQueries({ queryKey: ['lesson', endedSession.lessonId] })
      navigate(instructorPaths.lesson(
        endedSession.curriculumId,
        endedSession.sectionId,
        endedSession.lessonId,
      ), { replace: true })
    },
  })
  useEffect(() => {
    if (!sessionId) return undefined
    return subscribeSessionState(
      sessionId,
      (event) => {
        // 접속자 수는 세션 상태가 아니다. 같은 토픽으로 오지만 status를 건드리면 안 된다.
        if (event.type === 'session.presence') {
          queryClient.setQueryData<LiveSessionView>(
            ['live-session', sessionId],
            (cached) => cached ? { ...cached, participants: event.payload.participantCount } : cached,
          )
          return
        }
        const current = queryClient.getQueryData<LiveSessionView>(['live-session', sessionId])
        queryClient.setQueryData<LiveSessionView>(
          ['live-session', sessionId],
          (cached) => cached
            ? { ...cached, status: event.payload.liveSessionStatus }
            : cached,
        )
        if (!current) {
          void queryClient.invalidateQueries({ queryKey: ['live-session', sessionId] })
        }
      },
      (state) => {
        // 최초 연결·재연결 모두 REST 정본을 다시 읽어 이벤트 유실을 보완한다.
        if (state === 'connected') {
          void queryClient.invalidateQueries({ queryKey: ['live-session', sessionId] })
        }
      },
    )
  }, [queryClient, sessionId])
  /*
   * 강의 노트(CONTRACT §3-4a). 새로고침·재연결 복구는 조회가, 이후 갱신은 WS가 맡는다 — 둘이 같은
   * 모양(현재 전체)이라 화면은 마지막 것만 들고 있으면 된다.
   */
  /*
   * 내 AI 질문 기록. 새로고침하면 대화가 통째로 사라지던 것을 되살린다 — 이 기능만 휘발이었다
   * (채팅·자막·노트는 모두 서버에 남는다).
   */
  const aiHistoryQuery = useQuery({
    queryKey: ['ai-answers', sessionId],
    queryFn: () => getAiAnswerHistory(sessionId),
    enabled: Boolean(sessionId) && canReadContent,
  })
  /*
   * 많이 다시 본 구간(ADR-0063). 수강생만 센다 — 강사 화면에는 재생바가 없고(LiveKit 송출 미리보기),
   * 강사 재생이 섞이면 그래프가 오염된다.
   *
   * <b>라이브 중에는 진도가 나가지 않는다.</b> durationMs는 녹화 완료 webhook이 채우는 값이라
   * 진행 중인 세션에서는 null이고, 전체 칸 수를 모르는 채로 낸 비율은 뜻이 없기 때문이다. 대신
   * 라이브에서 본 칸은 그대로 서버에 쌓이고, 나중에 다시보기를 열면 그 누적을 물려받아 진도로
   * 환산된다 — 라이브로 들은 시간이 사라지지는 않는다.
   */
  const watchDurationMs = playback.playback?.durationMs ?? null
  // 시작 전에는 세지 않는다 — 재생 중인 것이 없는데 위치 0에 시청 한 번이 찍히면 곡선이 오염된다.
  useWatchTracking(
    lesson?.lessonId ?? '',
    positionMs,
    !isInstructor && !isBeforeLive && Boolean(lesson?.lessonId),
    watchDurationMs,
  )
  const heatmapQuery = useQuery({
    queryKey: ['watch-heatmap', lesson?.lessonId, watchDurationMs],
    queryFn: () => getWatchHeatmap(lesson!.lessonId, watchDurationMs),
    enabled: !isInstructor && Boolean(lesson?.lessonId),
  })
  /*
   * 용어집(ADR-0064). 강의 시작 전에 한 번 받아 두고, 도착하는 자막에서 화면이 직접 찾는다 —
   * 서버가 자막마다 매핑해 주면 왕복이 생기고 강사가 용어를 고쳤을 때 이미 그린 자막을 다시 계산해야 한다.
   */
  const glossaryQuery = useQuery({
    queryKey: ['glossary', lesson?.lessonId],
    queryFn: () => getGlossary(lesson!.lessonId),
    enabled: Boolean(lesson?.lessonId),
  })
  const noteQuery = useQuery({
    queryKey: ['lecture-notes', sessionId],
    queryFn: () => getLectureNotes(sessionId),
    enabled: Boolean(sessionId) && canReadContent,
  })
  const [liveNote, setLiveNote] = useState<LectureNoteView | null>(null)
  useEffect(() => {
    if (!sessionId) return undefined
    return subscribeLectureNotes(sessionId, setLiveNote, (state) => {
      /*
       * 최초 연결·재연결 모두 조회를 다시 한다(CONTRACT §3-6의 유실 보완 규칙). 끊겼다 붙는 사이의
       * 갱신을 놓치면, 다음 갱신이 올 때까지 뒤처진 노트가 남는다 — 강의가 끝나 더 이상 갱신이 없으면
       * 새로고침 전까지 영영 그대로다. 채팅·세션 상태가 이미 같은 규칙을 쓴다.
       */
      if (state === 'connected') {
        void queryClient.invalidateQueries({ queryKey: ['lecture-notes', sessionId] })
      }
    })
  }, [queryClient, sessionId])
  // 조회와 WS는 같은 것의 다른 도착 경로다. 더 멀리 간 쪽을 고른다(뒤로 가지 않는다).
  const note = mergeLectureNote(liveNote, noteQuery.data)

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
  // 자막 WS는 자막을 그리는 화면만 연다. 강사 화면에는 자막 독이 없고 다른 자막 소비처도 없어,
  // 구독을 열면 송출 중인 브라우저에 쓰지 않을 스트림 하나가 계속 붙어 있게 된다.
  useEffect(() => {
    if (!sessionId || isInstructor) return undefined
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
  }, [isInstructor, sessionId])
  // 리로드된 저장 자막을 누적기에 시드한다. WS 델타와 같은 이벤트라 reduceCaptionStream이 멱등하게 흡수하므로
  // WS가 먼저 붙어 일부가 이미 쌓였어도(순서 무관) 안전하다 — 중복 sequence는 무시, 누락분만 채운다.
  useEffect(() => {
    const seed = captionReloadQuery.data
    if (!seed || seed.length === 0) return
    for (const event of seed) {
      captionAccumulator.current = reduceCaptionStream(captionAccumulator.current, event)
    }
    setCaptions(selectCaptionViews(captionAccumulator.current))
  }, [captionReloadQuery.data])
  useEffect(() => {
    if (hasEnded) setStudentSeekRequest(null)
  }, [hasEnded])
  usePageTitle(`LIVE · ${lesson?.title ?? ''}`)

  const sendMessage = (event: FormEvent) => {
    event.preventDefault()
    if (!canUseConversation || !message.trim()) return
    sendMutation.mutate({
      clientMessageId: createClientMessageId(),
      text: message.trim(),
      // 채팅에는 질문 등록 기능이 없다 — 항상 false. 강사는 익명도 해당 없다(서버도 강사 익명을 무시한다).
      question: false,
      anonymous: isInstructor ? false : anonymous,
    })
    setMessage('')
  }

  const handleMessageKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    if (event.shiftKey) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  const openGlossaryTerm = (termId: string) => {
    setSelectedTermId(termId)
    setGlossaryFocusRequest((current) => ({ termId, sequence: (current?.sequence ?? 0) + 1 }))
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

  // 자막은 수강생 화면에만 있다. HLS 위치(positionMs)까지 도달한 위치 동기화 자막만 노출하고,
  // 앞선 자막은 누적기(버퍼)에 두었다가 위치가 닿으면 드러낸다(ADR-0045).
  // 강사 화면에는 플레이어가 없어 위치를 구할 수 없다 — null을 넘겨 실시간 append 그대로 둔다.
  const visibleCaptions = selectVisibleCaptions(captions, isInstructor ? null : positionMs)
  // 자막에 용어 링크를 걸고, 그 김에 용어별 등장 횟수도 센다(어차피 한 번 훑는다).
  const glossary = attachGlossary(visibleCaptions, glossaryQuery.data ?? [])

  const discussionComposer = canUseConversation ? (
    <form className="chat-composer" onSubmit={sendMessage}>
      <textarea
        aria-label="채팅 메시지"
        rows={2}
        value={message}
        placeholder="메시지를 입력하세요 (Enter 전송 · Shift+Enter 줄바꿈)"
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={handleMessageKeyDown}
      />
      <div>
        {!isInstructor && (
          <button
            type="button"
            role="switch"
            aria-checked={anonymous}
            className={`anonymous-toggle${anonymous ? ' is-on' : ''}`}
            onClick={() => setAnonymous((current) => !current)}
          >
            <span>익명</span>
            <span className="anonymous-toggle__track"><span className="anonymous-toggle__thumb" /></span>
          </button>
        )}
        <button className="button button--primary button--small" type="submit" disabled={!message.trim()}>전송</button>
      </div>
    </form>
  ) : isBeforeLive ? (
    /*
     * 시작 전에는 <b>입력창을 지우지 않고 잠근다.</b> 예전에는 통째로 사라져서, 채팅이 원래 없는
     * 화면인지 지금만 막힌 것인지 구별할 수 없었다 — 잠긴 자리와 그 이유가 같이 보여야 한다.
     * 이유는 바로 위 `discussionNotice`가 말한다.
     */
    <form className="chat-composer" onSubmit={(event) => event.preventDefault()}>
      <textarea
        aria-label="채팅 메시지"
        disabled
        rows={2}
        value=""
        placeholder="강의가 시작되면 채팅을 보낼 수 있습니다."
        readOnly
      />
      <div>
        <button className="button button--primary button--small" disabled type="submit">전송</button>
      </div>
    </form>
  ) : undefined

  const aiContent = (
    <PersonalAiQuestionPanel
      key={showDevLivePanel ? aiHistoryDevVersion : undefined}
      ask={canUseConversation ? askAi : undefined}
      /*
       * 왜 못 쓰는지 이 패널 안에서 말한다. 값이 없으면 "이 화면에서는 지원하지 않습니다"라는
       * 기본 문구가 나가는데, 지금은 <b>기다리면 되는</b> 상황이라 뜻이 다르다.
       */
      unavailableNotice={isBeforeLive ? prestartNotice(isStarting) : undefined}
      history={aiHistoryQuery.data}
      placeholder="예: SecurityContext와 세션은 어떻게 다른가요? (Enter 전송 · Shift+Enter 줄바꿈)"
      emptyDescription="강의 자료와 지금까지의 발화를 근거로 답변합니다."
    />
  )

  // 자막이 이미 흐르면(누적 라인 존재) 연결 문구로 시야를 어지럽히지 않는다.
  // 아직 한 줄도 없을 때만 연결 상태를 안내한다.
  const captionNote = isBeforeLive
    // 자막은 강사의 발화에서 나온다 — 시작 전이라 연결과 무관하게 나올 것이 없다.
    ? '강의가 시작되면 실시간 자막이 여기에 표시됩니다.'
    : hasEnded
    ? '라이브가 종료되어 자막 시간 이동을 사용할 수 없습니다.'
    : captions.length > 0 || captionConnectionState === 'connected'
      ? undefined
      : captionConnectionState === 'connecting'
        ? '실시간 자막을 연결하고 있습니다.'
        : captionConnectionState === 'reconnecting'
          ? '실시간 자막 연결이 끊겨 다시 연결하고 있습니다.'
          : captionConnectionState === 'error'
            ? '실시간 자막 연결에 문제가 생겼습니다. 자동 재연결을 시도합니다.'
            : '실시간 자막 연결이 종료되었습니다.'

  /*
   * 시작 전이라는 사실이 연결 상태보다 앞선다 — 소켓이 연결 중이라 못 보내는 것이 아니라 강의가
   * 아직 시작되지 않아 못 보내는 것이다. 연결 문구를 그대로 두면 잘못된 원인을 짚는다.
   */
  const chatConnectionNotice = isBeforeLive
    ? prestartNotice(isStarting)
    : chatConnectionState === 'connected'
    ? undefined
    : chatConnectionState === 'connecting'
      ? '실시간 채팅을 연결하고 있습니다.'
      : chatConnectionState === 'reconnecting'
        ? '실시간 채팅 연결이 끊겨 다시 연결하고 있습니다.'
        : chatConnectionState === 'error'
          ? '실시간 채팅 연결에 문제가 생겼습니다. 자동 재연결을 시도합니다.'
          : '실시간 채팅 연결이 종료되었습니다.'

  /*
   * 예전에 페이지 위쪽 네비바(LessonLayout)가 담당하던 "돌아가기" 링크. 강의실은 그 네비바를
   * 없애고(LessonLayout 참고) 이 링크를 재생 정보 헤더 안에 담는다 — 강의실을 벗어날 유일한
   * 길이 사라지면 안 되므로, 네비바가 없어져도 이 버튼은 항상 있어야 한다.
   *
   * 커리큘럼 홈이 아니라 이 강의의 상세로 보낸다 — 강의실을 나가면 대개 방금 보던 그 강의로
   * 돌아가려는 것이지, 커리큘럼 목록 전체로 갈 일은 드물다.
   */
  const backLink = user && (
    <Link
      className="playback-header-back"
      to={resolveLessonPath({
        curriculumId: session.curriculumId,
        sectionId: session.sectionId,
        lessonId: session.lessonId,
        destination: 'LESSON_DETAIL',
        role: user.role,
        deliveryType: lesson.deliveryType,
      })}
    >
      강의 상세로 이동
    </Link>
  )

  const sidebar = (
    <LearningSidebar
      panel={panel}
      onPanelChange={setPanel}
      selectedTermId={selectedTermId}
      onSelectedTermChange={setSelectedTermId}
      glossaryFocusRequest={glossaryFocusRequest}
      lectureNote={note}
      glossaryTerms={glossary.terms}
      messages={messages}
      myDisplayName={user?.displayName ?? ''}
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
      {!recordingNoticeAck && !hasEnded && (
        <div className="recording-consent-overlay" role="dialog" aria-modal="true" aria-labelledby="recording-consent-title">
          <div className="recording-consent-modal">
            <span className="recording-consent-modal__badge"><i aria-hidden="true" /> 녹화 안내</span>
            <h2 id="recording-consent-title">이 강의는 녹화됩니다</h2>
            <p>AI 기능 제공을 위해 채팅과 자막이 함께 처리됩니다. 참여하면 안내를 확인한 것으로 간주됩니다.</p>
            <button className="button button--primary button--full" type="button" onClick={() => setRecordingNoticeAck(true)}>확인하고 참여하기</button>
          </div>
        </div>
      )}

      {!isInstructor && session.status === 'ENDING' && (
        <div className="live-session-state-banner" role="status">
          강사가 수업을 종료하고 있습니다. 남은 영상을 재생 중입니다.
        </div>
      )}

      {!isInstructor && hasEnded && (
        <div className="live-session-state-banner is-ended" role="status">
          라이브가 종료된 강의입니다.
        </div>
      )}

      <div
        className={`media-layout${isInstructor && sidebarWindow.isDetached ? ' is-sidebar-detached' : ''}${sidebarPane.collapsed ? ' is-sidebar-collapsed' : ''}`}
        style={{ '--sidebar-width': `${sidebarPane.size}px` } as CSSProperties}
      >
        <section className="media-primary">
          {isInstructor
            ? (
              <Suspense fallback={<div className="video-stage instructor-livekit-loading" role="status">LiveKit 송출 도구를 불러오는 중입니다.</div>}>
                <InstructorLiveKitStage
                  backLink={backLink}
                  lessonTitle={lesson.title}
                  participantCount={session.participants}
                  sessionId={sessionId}
                  onRequestEnd={() => setEndRequested(true)}
                  onDismissEndConfirm={() => setEndRequested(false)}
                  endConfirm={endRequested && (
                    <div className="instructor-end-confirm" role="alert">
                      <div><strong>라이브 강의를 종료할까요?</strong><p>학생 연결을 종료하고 이 강의의 상세 화면으로 돌아갑니다.</p></div>
                      <div><button className="button button--ghost button--small" type="button" onClick={() => setEndRequested(false)}>계속 진행</button><button className="button button--primary button--small" type="button" disabled={endMutation.isPending} onClick={() => endMutation.mutate()}>종료하고 강의 상세로 이동</button></div>
                    </div>
                  )}
                />
              </Suspense>
            )
            : isBeforeLive
            ? (
              /*
               * 시작 전에는 플레이어를 <b>띄우지 않는다</b>. 재생할 자산이 아직 없어서 플레이어가
               * 오류를 그리는데, 기다리면 되는 상황을 고장으로 읽히게 한다. 시작 신호를 받으면
               * `isBeforeLive`가 풀리면서 이 자리에 플레이어가 들어온다 — 새로고침이 필요 없다.
               */
              <LivePrestartStage
                isStarting={isStarting}
                lessonTitle={lesson.title}
                scheduledAt={session.scheduledAt}
              />
            )
            : (
              <Suspense fallback={<div className="video-stage instructor-livekit-loading" role="status">Vidstack 플레이어를 불러오는 중입니다.</div>}>
                <PlaybackPlayer
                  backLink={backLink}
                  errorMessage={playback.errorMessage}
                  lessonTitle={lesson.title}
                  loading={playback.loading}
                  participantCount={session.participants}
                  playback={playback.playback}
                  reloadToken={playback.reloadToken}
                  seekRequest={studentSeekRequest}
                  onRetry={playback.reload}
                  onRootChange={setPlayerRoot}
                  onSessionTimeChange={setPositionMs}
                />
              </Suspense>
            )}

          {!isInstructor && <WatchHeatmapCurve heatmap={heatmapQuery.data ?? null} playerRoot={playerRoot} />}

          {!isInstructor && <div {...captionPane.handleProps} />}

          {/*
            자막은 수강생 화면에만 둔다. 강사는 자기가 말한 것을 다시 읽을 이유가 없고, 자막 독이
            차지하는 높이만큼 송출 미리보기가 눌려 실제로 나가는 프레임을 작게 보게 된다.
          */}
          {!isInstructor && !captionPane.collapsed && (
            <CaptionDock
              captions={glossary.captions}
              currentSessionMs={positionMs}
              label="실시간 자막"
              note={captionNote}
              onSeek={seekSession}
              onSelectTerm={openGlossaryTerm}
              canSeek={!hasEnded}
              heightPx={captionPane.size}
            />
          )}
        </section>

        {(!isInstructor || !sidebarWindow.isDetached) && <div {...sidebarPane.handleProps} />}
        {(!isInstructor || !sidebarWindow.isDetached) && sidebar}
        {isInstructor && sidebarWindow.portalContainer && createPortal(sidebar, sidebarWindow.portalContainer)}
      </div>
      {showDevLivePanel && (
        <Suspense fallback={null}>
          <DevLivePanel
            sessionId={sessionId}
            lessonId={lesson.lessonId}
            onAiHistoryChanged={() => setAiHistoryDevVersion((version) => version + 1)}
          />
        </Suspense>
      )}
    </div>
  )
}
