import { lazy, Suspense, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { instructorPaths, studentPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import { getLesson } from '@/features/lesson/lessonService'
import CaptionDock from '@/features/live-session/CaptionDock'
import LearningSidebar from '@/features/live-session/LearningSidebar'
import { getLiveLearningPreview, type LearningPanel } from '@/features/live-session/liveLearningPreview'
import type { PlaybackSeekRequest } from '@/features/live-session/PlaybackPlayer'
import { usePlayback } from '@/features/live-session/usePlayback'
import {
  askReplayAi,
  getReplayCaptions,
  getReplayMessages,
  publishReplayReview,
  saveReplayReview,
} from '@/features/replay/replayService'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import PageState from '@/shared/ui/PageState'
import { InlineNotice, StatusBadge } from '@/shared/ui/WorkspaceUi'

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
  const captionsQuery = useQuery({ queryKey: ['replay-captions', lessonId], queryFn: () => getReplayCaptions(lessonId), enabled: Boolean(lessonId) })
  const messagesQuery = useQuery({ queryKey: ['replay-messages', lessonId], queryFn: () => getReplayMessages(lessonId), enabled: Boolean(lessonId) })
  const lesson = lessonQuery.data
  const captions = captionsQuery.data ?? []
  const messages = messagesQuery.data ?? []
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
  const [aiQuestion, setAiQuestion] = useState('')
  const [aiAnswer, setAiAnswer] = useState('')
  const [reviewSaved, setReviewSaved] = useState(false)
  const [published, setPublished] = useState(false)
  // 라이브 강의실과 같은 재생 계약을 쓴다 — BE가 라이브·종료 후 VOD를 한 엔드포인트로 준다.
  const playback = usePlayback(lessonId)
  const aiMutation = useMutation({ mutationFn: (question: string) => askReplayAi(lessonId, question, positionMs), onSuccess: (data) => setAiAnswer(data.answer) })
  const saveReviewMutation = useMutation({ mutationFn: () => saveReplayReview(lessonId, reviewDraft), onSuccess: () => setReviewSaved(true) })
  const publishMutation = useMutation({ mutationFn: () => publishReplayReview(lessonId, reviewDraft), onSuccess: () => { setReviewSaved(true); setPublished(true) } })
  usePageTitle(`다시보기 · ${lesson?.title ?? ''}`)

  const askAi = (event: FormEvent) => {
    event.preventDefault()
    if (aiQuestion.trim()) aiMutation.mutate(aiQuestion.trim())
  }

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

  const aiContent = (
    <>
      <InlineNotice>현재 재생 시각과 강의 전체 자료를 함께 근거로 사용합니다.</InlineNotice>
      {aiAnswer && <div className="ai-answer"><strong>답변</strong><p>{aiAnswer}</p><small>근거 · session-and-csrf.pptx 8쪽</small></div>}
      <form onSubmit={askAi}><textarea rows={4} value={aiQuestion} placeholder="이 구간에서 궁금한 점을 질문하세요." onChange={(event) => setAiQuestion(event.target.value)} /><button className="button button--primary button--full" type="submit">질문하기</button></form>
    </>
  )

  return (
    <div className={`media-page replay-page${isInstructor ? ' media-page--instructor' : ''}`}>
      <header className="media-page__title">
        <div><StatusBadge tone="success">REPLAY</StatusBadge><h1>{lesson.title}</h1><small>강의 {lesson.lessonId} · 교정 자막 v2</small></div>
        <div className="media-page__status">
          {isInstructor ? <><StatusBadge tone="warning">강사 검수 모드</StatusBadge><span>VIDEO READY · {published ? 'PUBLISHED' : 'READY_FOR_REVIEW'}</span></> : <span>학습 진행률 42%</span>}
          <Link className="button button--soft button--small" to={lessonPath}>강의 상세</Link>
        </div>
      </header>

      {isInstructor && <div className="review-toolbar"><div><StatusBadge tone={published ? 'success' : 'warning'}>{published ? '게시 완료' : '강사 미리보기'}</StatusBadge><strong>{published ? '새 게시본이 수강생 화면에 반영되었습니다.' : '현재는 라이브 학습 화면과 같은 탭 구성을 미리 봅니다.'}</strong></div><div><button className="button button--soft button--small" type="button" onClick={() => saveReviewMutation.mutate()}>검수 초안 저장</button><button className="button button--primary button--small" type="button" onClick={() => publishMutation.mutate()}>게시본 공개</button></div></div>}
      {isInstructor && reviewSaved && <InlineNotice tone={published ? 'success' : 'info'}>{published ? '교정 자막 게시본 v3이 활성화되었습니다.' : '검수 초안을 저장했습니다. 기존 게시본은 변경되지 않습니다.'}</InlineNotice>}

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

          <CaptionDock captions={captions} currentSessionMs={positionMs} label="교정 자막" onSeek={seekSession} onSelectTerm={openGlossaryTerm} />

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
