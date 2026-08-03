import { lazy, Suspense, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { instructorPaths, studentPaths } from '@/app/router/paths'
import PersonalAiQuestionPanel from '@/features/ai/PersonalAiQuestionPanel'
import { useAuth } from '@/features/auth/AuthContext'
import { getLesson } from '@/features/lesson/lessonService'
import CaptionDock from '@/features/live-session/CaptionDock'
import LearningSidebar from '@/features/live-session/LearningSidebar'
import { getLiveLearningPreview, type LearningPanel } from '@/features/live-session/liveLearningPreview'
import WatchHeatmapStrip from '@/features/live-session/WatchHeatmapStrip'
import { useWatchTracking } from '@/features/live-session/useWatchTracking'
import {
  emptyCaptionStreamState,
  reduceCaptionStream,
  selectCaptionViews,
} from '@/features/live-session/captionAdapter'
import {
  getAiAnswerHistory,
  getCaptions,
  getWatchHeatmap,
  getChatMessages,
  getLectureNotes,
} from '@/features/live-session/liveSessionService'
import type { PlaybackSeekRequest } from '@/features/live-session/PlaybackPlayer'
import { usePlayback } from '@/features/live-session/usePlayback'
import {
  publishReplayReview,
  saveReplayReview,
} from '@/features/replay/replayService'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { useToast } from '@/shared/ui/Toast'
import PageState from '@/shared/ui/PageState'
import { StatusBadge } from '@/shared/ui/WorkspaceUi'

const { summaryBlocks, glossaryTerms } = getLiveLearningPreview()
const reviewDraft = 'SecurityContext는 인증이 완료된 현재 요청의 인증 주체를 보관합니다.'
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
   * 많이 다시 본 구간(ADR-0063). 강사는 세지 않는다 — 검수하며 되감은 것이 학생 재시청으로 잡히면
   * 그래프가 오염된다. 보기는 강사도 본다(그러라고 만든 것이다).
   */
  const durationMs = playback.playback?.durationMs ?? null
  useWatchTracking(lessonId, positionMs, !isInstructor && Boolean(lessonId))
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
  // 검수 저장·게시는 방금 누른 행동의 결과다 — 화면에 남기지 않고 토스트로 알린다.
  // (게시 여부 자체는 위 툴바 배지가 계속 보여 준다.)
  const saveReviewMutation = useMutation({
    mutationFn: () => saveReplayReview(lessonId, reviewDraft),
    onSuccess: () => toast.success('검수 초안을 저장했습니다. 기존 게시본은 변경되지 않습니다.'),
    onError: () => toast.error('검수 초안을 저장하지 못했습니다.'),
  })
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

  // 다시보기 AI는 서버에 경로가 없다 — ai-api가 sessionId를 필수로 받고 근거 시각이 attempt-local이라,
  // 다시보기의 세션-ms를 되돌릴 시간 앵커 계약이 서기 전에는 열 수 없다(ADR-0047 §9). 예전에는 질문을
  // 눌러도 501이 조용히 삼켜져 아무 반응이 없었다 — 지금은 왜 못 쓰는지 패널이 먼저 밝힌다.
  const aiContent = (
    <PersonalAiQuestionPanel
      history={aiHistoryQuery.data}
      unavailableNotice="다시보기에서는 새 질문을 보낼 수 없습니다. 라이브 중에 물어본 내용은 아래에 그대로 남아 있습니다."
    />
  )

  return (
    <div className={`media-page replay-page${isInstructor ? ' media-page--instructor' : ''}`}>
      <header className="media-page__title">
        <div><StatusBadge tone="success">REPLAY</StatusBadge><h1>{lesson.title}</h1><small>강의 {lesson.title}</small></div>
        <div className="media-page__status">
          {isInstructor ? <><StatusBadge tone="warning">강사 검수 모드</StatusBadge><span>VIDEO {playback.playback ? `READY · ${replayStatus}` : '상태 확인 중'}</span></> : <span>학습 진행률 42%</span>}
          <Link className="button button--soft button--small" to={lessonPath}>강의 상세</Link>
        </div>
      </header>

      {isInstructor && <div className="review-toolbar"><div><StatusBadge tone={published ? 'success' : 'warning'}>{published ? '게시 완료' : '강사 미리보기'}</StatusBadge><strong>{published ? '영상 다시보기가 수강생에게 공개되어 있습니다.' : '기존 미게시 또는 철회된 다시보기입니다.'}</strong></div><div><button className="button button--soft button--small" type="button" onClick={() => saveReviewMutation.mutate()}>검수 초안 저장</button>{canPublishManually && <button className="button button--primary button--small" type="button" disabled={publishMutation.isPending} onClick={() => publishMutation.mutate()}>다시보기 공개</button>}</div></div>}

      <div className="media-layout">
        <section className="media-primary">
          <Suspense fallback={<div className="video-stage replay-video" role="status">플레이어를 불러오는 중입니다.</div>}>
            <PlaybackPlayer
              bookmarked={bookmarked}
              errorMessage={playback.errorMessage}
              lessonTitle={lesson.title}
              loading={playback.loading}
              participantCount={0}
              playback={playback.playback}
              reloadToken={playback.reloadToken}
              seekRequest={seekRequest}
              onBookmark={() => setBookmarked((current) => !current)}
              onRetry={playback.reload}
              onSessionTimeChange={setPositionMs}
            />
          </Suspense>

          <WatchHeatmapStrip
            durationMs={durationMs}
            heatmap={heatmapQuery.data ?? null}
          />

          {/* 라이브 당시 저장된 자막이다. "교정"은 후처리가 붙은 뒤의 이름이라 아직 쓰지 않는다. */}
          <CaptionDock captions={captions} currentSessionMs={positionMs} label="자막" onSeek={seekSession} onSelectTerm={openGlossaryTerm} />

          <div className="chapter-row"><button type="button" onClick={() => seekSession(0)}><span>00:00</span>인증 흐름</button><button type="button" onClick={() => seekSession(1_880_000)}><span>31:20</span>세션 저장소</button><button type="button" onClick={() => seekSession(3_700_000)}><span>1:01:40</span>CSRF 실습</button></div>
        </section>

        <LearningSidebar
          panel={panel}
          onPanelChange={setPanel}
          currentSessionMs={positionMs}
          onSeek={setPositionMs}
          selectedTermId={selectedTermId}
          onSelectedTermChange={setSelectedTermId}
          summaryBlocks={summaryBlocks}
          lectureNote={noteQuery.data ?? null}
          glossaryTerms={glossaryTerms}
          messages={messages}
          discussionNotice="라이브 당시 채팅을 읽기 전용으로 표시합니다. 질문 필터로 질문만 모아볼 수 있습니다."
          aiContent={aiContent}
          noteContext="REPLAY"
        />
      </div>
    </div>
  )
}
