import { lazy, Suspense, useCallback, useMemo, useState, type CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { instructorPaths, studentPaths } from '@/app/router/paths'
import PersonalAiQuestionPanel, { type AskAiAnswer } from '@/features/ai/PersonalAiQuestionPanel'
import { useAuth } from '@/features/auth/AuthContext'
import { getLearningContext } from '@/features/learning/learningService'
import { getLesson } from '@/features/lesson/lessonService'
import BookmarkStrip from '@/features/live-session/BookmarkStrip'
import CaptionDock from '@/features/live-session/CaptionDock'
import LearningSidebar from '@/features/live-session/LearningSidebar'
import type { LearningPanel } from '@/features/live-session/liveLearningPreview'
import WatchHeatmapCurve from '@/features/live-session/WatchHeatmapCurve'
import { attachGlossary } from '@/features/live-session/glossaryView'
import { useWatchTracking } from '@/features/live-session/useWatchTracking'
import {
  emptyCaptionStreamState,
  reduceCaptionStream,
  selectCaptionViews,
  selectVisibleCaptions,
} from '@/features/live-session/captionAdapter'
import {
  askReplayAi,
  getAiAnswerHistory,
  getCaptions,
  getGlossary,
  getWatchHeatmap,
  saveBookmark,
  getChatMessages,
  getLectureNotes,
} from '@/features/live-session/liveSessionService'
import type { PlaybackSeekRequest } from '@/features/live-session/PlaybackPlayer'
import { usePlayback } from '@/features/live-session/usePlayback'
import { useResizablePane } from '@/features/live-session/useResizablePane'
import { publishReplayReview } from '@/features/replay/replayService'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { useToast } from '@/shared/ui/Toast'
import PageState from '@/shared/ui/PageState'
import { StatusBadge } from '@/shared/ui/WorkspaceUi'

const PlaybackPlayer = lazy(() => import('@/features/live-session/PlaybackPlayer'))

export default function ReplayLessonPage() {
  const { lessonId = '' } = useParams()
  const { user } = useAuth()
  const isInstructor = user?.role === 'INSTRUCTOR'
  const lessonQuery = useQuery({
    queryKey: ['replay-lesson', lessonId, user?.role],
    queryFn: () => getLesson({ lessonId, role: user?.role, userId: user?.userId }),
    enabled: Boolean(lessonId),
  })
  const lesson = lessonQuery.data
  const lessonPath = lesson
    ? isInstructor
      ? instructorPaths.lesson(lesson.curriculumId, lesson.sectionId, lesson.lessonId)
      : studentPaths.lesson(lesson.curriculumId, lesson.sectionId, lesson.lessonId)
    : '#'
  const [panel, setPanel] = useState<LearningPanel>('discussion')
  const [selectedTermId, setSelectedTermId] = useState<string | null>(null)
  const [positionMs, setPositionMs] = useState(0)
  const [seekRequest, setSeekRequest] = useState<PlaybackSeekRequest | null>(null)
  const [bookmarked, setBookmarked] = useState(false)
  // 재생바 위에 재시청 곡선을 얹으려면 플레이어 루트가 필요하다(WatchHeatmapCurve).
  const [playerRoot, setPlayerRoot] = useState<HTMLElement | null>(null)
  // 라이브와 같은 조절 규칙. 저장 키만 화면별로 나눈다 — 다시보기는 자막을 더 크게 보는 편이 흔하다.
  const sidebarPane = useResizablePane({
    storageKey: 'liveclass.replay.sidebarWidth',
    defaultSize: 370, min: 260, max: 620, axis: 'inline', direction: -1,
    label: '사이드 패널 너비 조절',
  })
  const captionPane = useResizablePane({
    storageKey: 'liveclass.replay.captionHeight',
    defaultSize: 152, min: 96, max: 420, axis: 'block', direction: -1,
    label: '자막 높이 조절',
  })
  const queryClient = useQueryClient()
  const toast = useToast()
  // 라이브 강의실과 같은 재생 계약을 쓴다 — BE가 라이브·종료 후 VOD를 한 엔드포인트로 준다.
  const playback = usePlayback(lessonId)
  /*
   * 다시보기가 보여줄 것들은 <b>세션 단위로 이미 저장돼 있다</b> — 자막·채팅·노트·AI 질문 모두
   * 라이브 중에 그대로 쌓였다. 그래서 다시보기 전용 엔드포인트를 새로 만들지 않고, 재생 응답이
   * 알려주는 sessionId로 같은 조회를 그대로 쓴다.
   *
   * 인가도 같다 — 세션 참가자(소유 강사·활성 수강생)만 읽는다.
   */
  const sessionId = playback.playback?.sessionId ?? ''
  const captionsQuery = useQuery({
    queryKey: ['replay-captions', sessionId],
    queryFn: () => getCaptions(sessionId),
    enabled: Boolean(sessionId),
  })
  const messagesQuery = useQuery({
    queryKey: ['replay-messages', sessionId],
    queryFn: () => getChatMessages(sessionId),
    enabled: Boolean(sessionId),
  })
  const noteQuery = useQuery({
    queryKey: ['replay-notes', sessionId],
    queryFn: () => getLectureNotes(sessionId),
    enabled: Boolean(sessionId),
  })
  const aiHistoryQuery = useQuery({
    queryKey: ['replay-ai-answers', sessionId],
    queryFn: () => getAiAnswerHistory(sessionId),
    enabled: Boolean(sessionId),
  })
  /*
   * 많이 다시 본 구간(ADR-0063)과 학습 진도(ADR-0033). 강사는 세지 않는다 — 검수하며 되감은 것이
   * 학생 재시청으로 잡히면 그래프가 오염되고, 강사는 애초에 자기 강의의 수강자가 아니다.
   * 보기는 강사도 본다(그러라고 만든 것이다).
   *
   * durationMs를 넘기는 것이 진도를 켜는 스위치다 — 녹화 완료 webhook이 길이를 채우기 전에는
   * null이고, 그동안은 칸만 쌓인다. 길이가 들어오면 다음 주기부터 그 칸이 진도로 환산된다.
   */
  const durationMs = playback.playback?.durationMs ?? null
  useWatchTracking(lessonId, positionMs, !isInstructor && Boolean(lessonId), durationMs)
  // 용어집(ADR-0064). 라이브와 같은 규칙으로 자막에 링크를 건다 — 두 화면이 다르면 안 된다.
  const glossaryQuery = useQuery({
    queryKey: ['glossary', lessonId],
    queryFn: () => getGlossary(lessonId),
    enabled: Boolean(lessonId),
  })
  /*
   * 진도·북마크. 라이브 화면과 <b>같은 조회</b>다 — 다시보기라고 다른 것을 보여줄 이유가 없고,
   * 라이브에서 찍은 북마크로 되돌아오는 것이 다시보기의 쓸모다. 강사는 자기 강의에 진도가 없다.
   */
  const learningQuery = useQuery({
    queryKey: ['learning-context', lessonId],
    queryFn: () => getLearningContext(lessonId),
    enabled: Boolean(lessonId) && !isInstructor,
  })
  const progressPercent = learningQuery.data?.progress?.progressPercent ?? null
  /*
   * 북마크는 <b>저장한다.</b> 예전에는 별표만 토글하고 아무것도 보내지 않아, 눌러도 아래 띠에
   * 나타나지 않았다. 라이브와 같은 뮤테이션을 쓴다 — 두 화면이 같은 축(세션 상대 ms)이므로
   * 라이브에서 찍은 것과 다시보기에서 찍은 것이 한 목록에 쌓이는 것이 맞다.
   */
  const bookmarkMutation = useMutation({
    mutationFn: () => saveBookmark(lessonId, positionMs),
    onSuccess: () => {
      setBookmarked(true)
      void queryClient.invalidateQueries({ queryKey: ['learning-context', lessonId] })
    },
  })
  const heatmapQuery = useQuery({
    queryKey: ['watch-heatmap', lessonId, durationMs],
    queryFn: () => getWatchHeatmap(lessonId, durationMs),
    enabled: Boolean(lessonId),
  })
  /*
   * 저장된 자막 이벤트를 라이브와 같은 누적기로 접는다. 다시보기라고 다른 규칙으로 접으면
   * 같은 강의가 두 화면에서 다르게 보인다.
   */
  const captions = useMemo(() => {
    const events = captionsQuery.data ?? []
    let state = emptyCaptionStreamState()
    for (const event of events) state = reduceCaptionStream(state, event)
    return selectCaptionViews(state)
  }, [captionsQuery.data])
  const messages = messagesQuery.data ?? []
  /*
   * 재생 위치까지만 보여 준다(라이브 화면과 같은 규칙, ADR-0045).
   *
   * 이 화면은 세션 전체를 한 번에 불러오므로, 그대로 그리면 0:00에서 <b>강의 끝 무렵 자막과
   * 질문이 이미 떠 있다</b>. 무엇에 대한 이야기인지 알 수 없는 목록이고, 라이브를 겪은 사람이
   * 다시 볼 때 기대하는 모양도 아니다.
   *
   * <b>역할로 가르지 않는다.</b> 라이브에서는 강사에게 플레이어가 없어 위치를 몰랐지만, 여기서는
   * 강사도 같은 플레이어를 쓴다 — 강사 검수 화면이 수강생이 볼 화면과 달라지면 검수가 성립하지
   * 않는다.
   */
  const visibleCaptions = useMemo(() => selectVisibleCaptions(captions, positionMs), [captions, positionMs])
  const glossary = attachGlossary(visibleCaptions, glossaryQuery.data ?? [])
  // 게시는 방금 누른 행동의 결과다 — 화면에 남기지 않고 토스트로 알린다.
  // (게시 여부 자체는 위 툴바 배지가 계속 보여 준다.)
  const publishMutation = useMutation({
    mutationFn: () => publishReplayReview(lessonId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['playback', lessonId] })
      toast.success('다시보기를 수강생에게 공개했습니다.')
    },
    onError: () => toast.error('다시보기를 공개하지 못했습니다.'),
  })
  usePageTitle(`다시보기 · ${lesson?.title ?? ''}`)

  const openGlossaryTerm = (termId: string) => {
    setSelectedTermId(termId)
    setPanel('glossary')
  }

  // 자막·목차에서 특정 시각을 누르면 플레이어를 그 지점으로 옮긴다. sequence는 같은 시각을
  // 다시 눌러도 effect가 재실행되게 하는 용도다.
  const seekSession = (sessionMs: number) => {
    setPositionMs(sessionMs)
    setSeekRequest((current) => ({ sessionMs, sequence: (current?.sequence ?? 0) + 1 }))
  }

  /*
   * 다시보기 AI 질의응답(ADR-0075). 라이브와 달리 **재생 위치를 함께** 보낸다 — 서버가 그 지점
   * 주변의 확정 자막을 근거로 고른다.
   *
   * 보내는 값은 질문을 누른 순간의 positionMs다(플레이어가 availableFromMs를 반영해 준 세션-ms).
   * 질문 뒤에 계속 재생하거나 다른 곳으로 옮겨도 이미 보낸 요청의 기준 시점은 바뀌지 않는다.
   */
  const askAi = useCallback<AskAiAnswer>(
    async (question, options) => {
      try {
        await askReplayAi(lessonId, question, positionMs, options)
      } finally {
        // 서버가 스트리밍 중에 답변을 남기므로(ADR-0062) 끝나면 기록을 다시 읽는다. 실패해도 읽는다 —
        // 받은 데까지 남는 것이 계약이다.
        void queryClient.invalidateQueries({ queryKey: ['replay-ai-answers', sessionId] })
      }
    },
    [lessonId, positionMs, queryClient, sessionId],
  )

  // 게시본 자막·채팅은 아직 서버 경로가 없다(CP3~CP5). 진입 게이트에 넣으면 레슨을
  // 정상으로 불러왔는데도 화면이 통째로 막힌다 — 필수는 레슨 하나뿐이다.
  if (!lessonId) return <PageState title="잘못된 다시보기 경로입니다" />
  if (lessonQuery.isError) return <PageState title="다시보기를 불러오지 못했습니다" />
  if (!lesson) return <PageState title="다시보기를 불러오는 중입니다" />

  const replayStatus = playback.playback?.replayStatus ?? 'NOT_READY'
  const published = replayStatus === 'PUBLISHED'
  const canPublishManually = replayStatus === 'DRAFT'
    || replayStatus === 'READY_FOR_REVIEW'
    || replayStatus === 'WITHDRAWN'

  const aiContent = (
    <PersonalAiQuestionPanel
      ask={askAi}
      history={aiHistoryQuery.data}
      placeholder="이 지점에서 궁금한 점을 질문하세요. (Enter 전송 · Shift+Enter 줄바꿈)"
      emptyDescription="강의 자료와 지금 보고 있는 지점 주변의 발화를 근거로 답변합니다."
      onSeekEvidence={seekSession}
    />
  )

  return (
    <div className={`media-page media-page--live replay-page${isInstructor ? ' media-page--instructor' : ''}`}>
      <header className="media-page__title">
        <div><StatusBadge tone="success">REPLAY</StatusBadge><h1>{lesson.title}</h1><small>강의 {lesson.title}</small></div>
        <div className="media-page__status">
          {/* 진행률은 서버가 주는 값이 있을 때만 적는다. 예전에는 "42%"가 고정으로 박혀 있어
              누구에게나 같은 숫자가 보였다 — 틀린 숫자는 없는 것만 못하다. */}
          {isInstructor
            ? <><StatusBadge tone="warning">강사 검수 모드</StatusBadge><span>VIDEO {playback.playback ? `READY · ${replayStatus}` : '상태 확인 중'}</span></>
            : progressPercent !== null && <span>학습 진행률 {progressPercent}%</span>}
          <Link className="button button--soft button--small" to={lessonPath}>강의 상세</Link>
        </div>
      </header>

      {isInstructor && <div className="review-toolbar"><div><StatusBadge tone={published ? 'success' : 'warning'}>{published ? '게시 완료' : '강사 미리보기'}</StatusBadge><strong>{published ? '영상 다시보기가 수강생에게 공개되어 있습니다.' : '기존 미게시 또는 철회된 다시보기입니다.'}</strong></div><div>{canPublishManually && <button className="button button--primary button--small" type="button" disabled={publishMutation.isPending} onClick={() => publishMutation.mutate()}>다시보기 공개</button>}</div></div>}

      <div
        className={`media-layout${sidebarPane.collapsed ? ' is-sidebar-collapsed' : ''}`}
        style={{ '--sidebar-width': `${sidebarPane.size}px` } as CSSProperties}
      >
        <section className="media-primary">
          <Suspense fallback={<div className="video-stage replay-video" role="status">플레이어를 불러오는 중입니다.</div>}>
            <PlaybackPlayer
              bookmarked={bookmarked}
              errorMessage={playback.errorMessage}
              lessonTitle={lesson.title}
              loading={playback.loading}
              playback={playback.playback}
              reloadToken={playback.reloadToken}
              seekRequest={seekRequest}
              onBookmark={() => bookmarkMutation.mutate()}
              onRetry={playback.reload}
              onRootChange={setPlayerRoot}
              onSessionTimeChange={setPositionMs}
            />
          </Suspense>
          <WatchHeatmapCurve heatmap={heatmapQuery.data ?? null} playerRoot={playerRoot} />

          <BookmarkStrip
            bookmarks={learningQuery.data?.bookmarks ?? []}
            canSeek
            onSeek={seekSession}
          />

          <div {...captionPane.handleProps} />

          {/* 라이브 당시 저장된 자막이다. "교정"은 후처리가 붙은 뒤의 이름이라 아직 쓰지 않는다. */}
          {!captionPane.collapsed && (
            <CaptionDock captions={glossary.captions} currentSessionMs={positionMs} heightPx={captionPane.size} label="자막" onSeek={seekSession} onSelectTerm={openGlossaryTerm} />
          )}
        </section>

        <div {...sidebarPane.handleProps} />

        <LearningSidebar
          panel={panel}
          onPanelChange={setPanel}
          selectedTermId={selectedTermId}
          onSelectedTermChange={setSelectedTermId}
          lectureNote={noteQuery.data ?? null}
          glossaryTerms={glossary.terms}
          messages={messages}
          revealThroughMs={positionMs}
          discussionNotice="라이브 당시 채팅을 읽기 전용으로 표시합니다. 질문 필터로 질문만 모아볼 수 있습니다."
          aiContent={aiContent}
          noteContext="REPLAY"
        />
      </div>
    </div>
  )
}
