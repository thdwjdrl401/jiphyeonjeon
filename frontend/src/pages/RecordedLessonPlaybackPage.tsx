import { useCallback, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { studentPaths } from '@/app/router/paths'
import PersonalAiQuestionPanel from '@/features/ai/PersonalAiQuestionPanel'
import { useAuth } from '@/features/auth/AuthContext'
import CaptionDock from '@/features/live-session/CaptionDock'
import LearningSidebar from '@/features/live-session/LearningSidebar'
import { normalizeCaption } from '@/features/live-session/captionAdapter'
import { attachGlossary } from '@/features/live-session/glossaryView'
import type { LearningPanel } from '@/features/live-session/liveLearningPreview'
import { getGlossary } from '@/features/live-session/liveSessionService'
import { useResizablePane } from '@/features/live-session/useResizablePane'
import { useWatchTracking } from '@/features/live-session/useWatchTracking'
import HlsMediaPlayer, {
  type HlsMediaSeekRequest,
  type HlsMediaState,
} from '@/features/media/HlsMediaPlayer'
import {
  askRecordedAi,
} from '@/features/recorded-lesson/recordedLessonService'
import { recordedPlaybackErrorMessage } from '@/features/recorded-lesson/recordedLessonProcessing'
import {
  useRecordedCaptionSegments,
  useRecordedPlayback,
} from '@/features/recorded-lesson/useRecordedLessonQueries'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import PageState from '@/shared/ui/PageState'
import { StatusBadge } from '@/shared/ui/WorkspaceUi'

const RECORDED_PANELS: readonly LearningPanel[] = ['ai', 'glossary']

function stateLabel(state: HlsMediaState) {
  if (state === 'playing') return '재생 중'
  if (state === 'ready') return '재생 준비됨'
  if (state === 'buffering') return '버퍼링 중'
  if (state === 'error') return '재생 오류'
  return '플레이어 준비 중'
}

/** 학생 녹화강의: HLS·정확한 후처리 자막과 라이브의 학습 사이드바를 같은 화면에 둔다. */
export default function RecordedLessonPlaybackPage() {
  const { lessonId = '' } = useParams()
  const { user } = useAuth()
  const isInstructor = user?.role === 'INSTRUCTOR'
  const [playerState, setPlayerState] = useState<HlsMediaState>('loading')
  const [reloadToken, setReloadToken] = useState(0)
  const [positionMs, setPositionMs] = useState(0)
  const positionRef = useRef(0)
  const [seekRequest, setSeekRequest] = useState<HlsMediaSeekRequest | null>(null)
  const [panel, setPanel] = useState<LearningPanel>('ai')
  const [selectedTermId, setSelectedTermId] = useState<string | null>(null)
  const playbackQuery = useRecordedPlayback(lessonId, Boolean(lessonId))
  const playback = playbackQuery.data
  const captionsQuery = useRecordedCaptionSegments(lessonId, Boolean(playback))
  const glossaryQuery = useQuery({
    queryKey: ['glossary', lessonId],
    queryFn: () => getGlossary(lessonId),
    enabled: Boolean(playback),
  })
  const sidebarPane = useResizablePane({
    storageKey: 'liveclass.recorded.sidebarWidth',
    defaultSize: 370, min: 260, max: 620, axis: 'inline', direction: -1,
    label: '사이드 패널 너비 조절',
  })
  const captionPane = useResizablePane({
    storageKey: 'liveclass.recorded.captionHeight',
    defaultSize: 152, min: 96, max: 420, axis: 'block', direction: -1,
    label: '자막 높이 조절',
  })
  usePageTitle('녹화강의')

  const captions = useMemo(
    () => (captionsQuery.data ?? []).map((segment, index) => normalizeCaption({
      segmentId: String(segment.segmentId),
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text,
    }, index)),
    [captionsQuery.data],
  )
  const glossary = attachGlossary(captions, glossaryQuery.data ?? [])

  /*
   * 시청 구간·학습 진도(ADR-0063·0033). 녹화강의도 커리큘럼 진도의 분모에 들어가므로
   * (CatalogService의 게시된 RECORDED 레슨), 여기서 세지 않으면 <b>이 강의만 영원히 미완료로
   * 남아 커리큘럼 진행률을 끌어내린다.</b> 다시보기 화면과 같은 훅·같은 규칙을 쓴다.
   *
   * 강사는 세지 않는다 — 검수하며 되감은 것이 학생 재시청으로 잡히면 그래프가 오염된다.
   */
  useWatchTracking(lessonId, positionMs, !isInstructor && Boolean(playback), playback?.durationMs ?? null)

  const retry = useCallback(() => {
    setPlayerState('loading')
    setReloadToken((current) => current + 1)
    void playbackQuery.refetch()
  }, [playbackQuery])

  const handleTimeChange = useCallback((mediaTimeMs: number) => {
    positionRef.current = mediaTimeMs
    setPositionMs(mediaTimeMs)
  }, [])

  const seekRecorded = useCallback((sessionMs: number) => {
    const nextMs = Math.max(0, sessionMs)
    positionRef.current = nextMs
    setPositionMs(nextMs)
    setSeekRequest((current) => ({
      mediaTimeSeconds: nextMs / 1_000,
      sequence: (current?.sequence ?? 0) + 1,
    }))
  }, [])

  const ask = useCallback(
    (question: string, options: Parameters<typeof askRecordedAi>[3]) => (
      askRecordedAi(lessonId, question, positionRef.current, options)
    ),
    [lessonId],
  )

  const openGlossaryTerm = useCallback((termId: string) => {
    setSelectedTermId(termId)
    setPanel('glossary')
  }, [])

  if (!lessonId) return <PageState title="잘못된 녹화강의 경로입니다" />
  if (playbackQuery.isPending) {
    return <PageState title="녹화강의를 불러오는 중입니다" description="영상과 자막 재생 정보를 확인하고 있습니다." />
  }
  if (playbackQuery.isError || !playback) {
    return (
      <PageState
        title="녹화강의를 재생할 수 없습니다"
        description={recordedPlaybackErrorMessage(playbackQuery.error)}
        action={<button className="button button--soft" type="button" onClick={retry}>다시 시도</button>}
      />
    )
  }

  const captionTracks = playback.captions.tracks.map((track) => ({
    trackId: track.trackId,
    src: track.url,
    kind: track.kind,
    label: track.label,
    language: track.language,
    // 공통 CaptionDock이 기본 자막이므로 native overlay는 opt-in으로 둬 이중 자막을 막는다.
    default: false,
    version: track.version,
  }))

  return (
    <div className="media-page media-page--live replay-page recorded-learning-page">
      <header className="media-page__title">
        <div>
          <StatusBadge tone="success">RECORDED</StatusBadge>
          <h1>녹화강의</h1>
          <small>{playback.captions.status === 'AVAILABLE' ? '한국어 자막·AI 질문 제공' : 'AI 자료 질문 제공'}</small>
        </div>
        <div className="media-page__status">
          <StatusBadge tone={playerState === 'error' ? 'danger' : playerState === 'buffering' || playerState === 'loading' ? 'warning' : 'success'}>
            {stateLabel(playerState)}
          </StatusBadge>
          <Link className="button button--soft button--small" to={studentPaths.curriculums}>내 커리큘럼</Link>
        </div>
      </header>

      <div
        className={`media-layout${sidebarPane.collapsed ? ' is-sidebar-collapsed' : ''}`}
        style={{ '--sidebar-width': `${sidebarPane.size}px` } as CSSProperties}
      >
        <section className="media-primary">
          <HlsMediaPlayer
            sourceUrl={playback.source.url}
            title="녹화강의"
            streamType="on-demand"
            durationMs={playback.durationMs}
            reloadToken={reloadToken}
            seekRequest={seekRequest}
            captionTracks={captionTracks}
            className="recorded-lesson-player"
            onStateChange={setPlayerState}
            onTimeChange={handleTimeChange}
          />
          {playerState === 'error' && (
            <div className="recorded-player-message recorded-player-message--error" role="alert">
              <strong>녹화강의를 재생하지 못했습니다.</strong>
              <button className="button button--soft" type="button" onClick={retry}>재생 정보 다시 받기</button>
            </div>
          )}

          <div {...captionPane.handleProps} />
          {!captionPane.collapsed && (
            <CaptionDock
              captions={glossary.captions}
              currentSessionMs={positionMs}
              heightPx={captionPane.size}
              label="자막"
              note={captionsQuery.isError ? '자막 목록을 불러오지 못했습니다.' : undefined}
              onSeek={seekRecorded}
              onSelectTerm={openGlossaryTerm}
            />
          )}
        </section>

        <div {...sidebarPane.handleProps} />
        <LearningSidebar
          panel={panel}
          onPanelChange={setPanel}
          selectedTermId={selectedTermId}
          onSelectedTermChange={setSelectedTermId}
          lectureNote={null}
          glossaryTerms={glossary.terms}
          messages={[]}
          myDisplayName={user?.displayName ?? ''}
          aiContent={(
            <PersonalAiQuestionPanel
              ask={ask}
              emptyDescription="현재 재생 구간의 자막과 이 강의의 PPTX 자료를 근거로 답변합니다."
            />
          )}
          noteContext="REPLAY"
          availablePanels={RECORDED_PANELS}
        />
      </div>
    </div>
  )
}
