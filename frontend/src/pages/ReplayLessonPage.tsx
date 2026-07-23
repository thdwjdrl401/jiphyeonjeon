import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { instructorPaths, studentPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import { getLesson } from '@/features/lesson/lessonService'
import CaptionDock from '@/features/live-session/CaptionDock'
import LearningSidebar from '@/features/live-session/LearningSidebar'
import { getLiveLearningPreview, type LearningPanel } from '@/features/live-session/liveLearningPreview'
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

const replayDurationMs = 5_538_000
const initialReplayPositionMs = 1_880_000
const { summaryBlocks, glossaryTerms } = getLiveLearningPreview()
const reviewDraft = 'SecurityContext는 인증이 완료된 현재 요청의 인증 주체를 보관합니다.'

function formatSessionTime(sessionMs: number) {
  const seconds = Math.floor(sessionMs / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
}

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
  const [positionMs, setPositionMs] = useState(initialReplayPositionMs)
  const [playing, setPlaying] = useState(false)
  const [aiQuestion, setAiQuestion] = useState('')
  const [aiAnswer, setAiAnswer] = useState('')
  const [reviewSaved, setReviewSaved] = useState(false)
  const [published, setPublished] = useState(false)
  const progressPercent = Math.round((positionMs / replayDurationMs) * 100)
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

  if (!lessonId) return <PageState title="잘못된 다시보기 경로입니다" />
  if (lessonQuery.isPending || captionsQuery.isPending || messagesQuery.isPending) return <PageState title="다시보기를 불러오는 중입니다" />
  if (lessonQuery.isError || captionsQuery.isError || messagesQuery.isError || !lesson) return <PageState title="다시보기를 불러오지 못했습니다" />

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
          <div className="video-stage replay-video" tabIndex={0}>
            <button className="play-button" type="button" aria-label={playing ? '일시정지' : '재생'} onClick={() => setPlaying((current) => !current)}>{playing ? 'Ⅱ' : '▶'}</button>
            <div className="slide-preview"><span>SPRING SECURITY</span><h2>SecurityContext와<br />세션의 경계</h2><div className="slide-code">Request → FilterChain → Context → Service</div></div>
            <div className="video-controls-overlay" aria-label="다시보기 재생 컨트롤">
              <div className="timeline-row"><span>00:00</span><input aria-label="다시보기 타임라인" min="0" max={replayDurationMs} type="range" value={positionMs} onChange={(event) => setPositionMs(Number(event.target.value))} /><span>{formatSessionTime(positionMs)} / 1:32:18</span></div>
              <div className="control-row"><div><button type="button" onClick={() => setPlaying((current) => !current)}>{playing ? '일시정지' : '재생'}</button><button type="button">1.0×</button><button type="button">CC 켜짐</button><button type="button">☆ 북마크</button></div><span>{progressPercent}% 지점</span></div>
            </div>
          </div>

          <CaptionDock captions={captions} currentSessionMs={positionMs} label="교정 자막" onSeek={setPositionMs} onSelectTerm={openGlossaryTerm} />

          <div className="chapter-row"><button type="button" onClick={() => setPositionMs(0)}><span>00:00</span>인증 흐름</button><button type="button" onClick={() => setPositionMs(1_880_000)}><span>31:20</span>세션 저장소</button><button type="button" onClick={() => setPositionMs(3_700_000)}><span>1:01:40</span>CSRF 실습</button></div>
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
