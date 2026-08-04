import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { instructorPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import { getLesson } from '@/features/lesson/lessonService'
import HlsMediaPlayer, { type HlsMediaState } from '@/features/media/HlsMediaPlayer'
import {
  RECORDED_PROCESSING_STAGES,
  recordedCaptionFailureMessage,
  recordedPlaybackErrorMessage,
  recordedProcessingFailureMessage,
  recordedProcessingStageIndex,
} from '@/features/recorded-lesson/recordedLessonProcessing'
import {
  useRetryRecordedCaptions,
  useRetryRecordedProcessing,
} from '@/features/recorded-lesson/useRecordedLessonMutations'
import {
  useRecordedPlayback,
  useRecordedProcessing,
} from '@/features/recorded-lesson/useRecordedLessonQueries'
import { ApiError } from '@/shared/api/client'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import PageState from '@/shared/ui/PageState'
import { useToast } from '@/shared/ui/Toast'
import { InlineNotice, PageHeader, Panel, StatusBadge } from '@/shared/ui/WorkspaceUi'

function formatDuration(durationMs: number | null) {
  if (!durationMs) return null
  const totalSeconds = Math.round(durationMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return hours > 0
    ? `${hours}시간 ${minutes}분 ${seconds}초`
    : `${minutes}분 ${seconds}초`
}

function formatBytes(bytes: number | null) {
  if (bytes === null) return null
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function playbackStateLabel(state: HlsMediaState) {
  if (state === 'playing') return '재생 중'
  if (state === 'ready') return '재생 준비됨'
  if (state === 'buffering') return '버퍼링 중'
  if (state === 'error') return '재생 오류'
  return '플레이어 준비 중'
}

const ACTIVE_MATERIAL_STATUSES = new Set(['PENDING', 'PROCESSING'])

function materialStatusTone(status: string) {
  if (status === 'READY' || status === 'EMPTY' || status === 'NOT_REQUESTED') return 'success' as const
  if (status === 'FAILED') return 'danger' as const
  return 'warning' as const
}

function keyTermStatusLabel(status: string) {
  if (status === 'READY') return '용어 준비 완료'
  if (status === 'EMPTY') return '추출 용어 없음'
  if (status === 'FAILED') return '용어 추출 실패'
  if (status === 'NOT_REQUESTED') return '용어 추출 안 함'
  if (status === 'PROCESSING') return '용어 추출 중'
  return '용어 추출 대기'
}

export default function RecordedLessonDetailPage() {
  const { curriculumId = '', sectionId = '', lessonId = '' } = useParams()
  const { user } = useAuth()
  const toast = useToast()
  const [reloadToken, setReloadToken] = useState(0)
  const [playbackState, setPlaybackState] = useState<HlsMediaState>('loading')

  const lessonQuery = useQuery({
    queryKey: ['recorded-lesson', lessonId, curriculumId, sectionId],
    queryFn: () => getLesson({
      lessonId,
      role: user?.role,
      userId: user?.userId,
      curriculumId,
      sectionId,
    }),
    enabled: Boolean(lessonId && curriculumId && sectionId),
    refetchInterval: (query) => {
      const materials = query.state.data?.materials ?? []
      return materials.some((material) => (
        ACTIVE_MATERIAL_STATUSES.has(material.embeddingStatus ?? material.status)
        || ACTIVE_MATERIAL_STATUSES.has(material.keyTermStatus ?? 'NOT_REQUESTED')
      )) ? 3_000 : false
    },
    refetchIntervalInBackground: false,
  })
  const isRecordedLesson = lessonQuery.data?.deliveryType === 'RECORDED'
  const processingQuery = useRecordedProcessing(lessonId, isRecordedLesson)
  const refetchProcessing = processingQuery.refetch
  const processing = processingQuery.data ?? null
  const playbackQuery = useRecordedPlayback(
    lessonId,
    processing?.recordedPublicationStatus === 'PUBLISHED',
  )
  const retryMutation = useRetryRecordedProcessing(lessonId)
  const retryCaptionsMutation = useRetryRecordedCaptions(lessonId)
  const lesson = lessonQuery.data

  usePageTitle(`녹화강의 · ${lesson?.title ?? ''}`)

  const playbackNotReady = playbackQuery.error instanceof ApiError
    && (
      playbackQuery.error.code === 'RECORDED_VIDEO_NOT_READY'
      || playbackQuery.error.code === 'RECORDED_VIDEO_NOT_PUBLISHED'
    )
  useEffect(() => {
    if (playbackNotReady) void refetchProcessing()
  }, [playbackNotReady, refetchProcessing])

  if (!lessonId || !curriculumId || !sectionId) {
    return <PageState title="잘못된 녹화강의 경로입니다" description="강의 식별자를 확인해 주세요." />
  }
  if (lessonQuery.isPending) {
    return <PageState title="녹화강의를 불러오는 중입니다" description="잠시만 기다려 주세요." />
  }
  if (lessonQuery.isError || !lesson) {
    return <PageState title="녹화강의를 불러오지 못했습니다" description="잠시 후 다시 시도해 주세요." />
  }
  if (!isRecordedLesson) {
    return <PageState title="녹화강의가 아닙니다" description="커리큘럼 관리 화면에서 강의 유형을 확인해 주세요." />
  }

  const managePath = instructorPaths.curriculumManage(curriculumId)
  const activeStageIndex = processing ? recordedProcessingStageIndex(processing.status) : -1
  const duration = formatDuration(processing?.durationMs ?? null)
  const size = formatBytes(processing?.sizeBytes ?? null)
  const readyAt = processing?.readyAt ? new Date(processing.readyAt).toLocaleString('ko-KR') : null
  const publishedAt = processing?.publishedAt ? new Date(processing.publishedAt).toLocaleString('ko-KR') : null

  const retryProcessing = () => {
    retryMutation.mutate(undefined, {
      onSuccess: () => toast.success('영상 처리를 다시 시작했습니다.'),
      onError: () => toast.error('영상 처리를 다시 시작하지 못했습니다.'),
    })
  }

  const retryPlayback = () => {
    setPlaybackState('loading')
    setReloadToken((token) => token + 1)
    void playbackQuery.refetch()
  }

  const retryCaptions = () => {
    retryCaptionsMutation.mutate(undefined, {
      onSuccess: () => toast.success('AI 자막 생성을 다시 시작했습니다.'),
      onError: () => toast.error('AI 자막 생성을 다시 시작하지 못했습니다.'),
    })
  }

  return (
    <div className="workspace-page recorded-lesson-detail-page">
      <div className="breadcrumbs">
        <Link to={managePath}>{lesson.curriculumTitle}</Link>
        <span>/</span>
        <span>{lesson.sectionTitle}</span>
        <span>/</span>
        <strong>{lesson.title}</strong>
      </div>
      <PageHeader
        title={lesson.title}
        description={lesson.description || '등록된 강의 설명이 없습니다.'}
        action={<div className="header-action-group"><StatusBadge>녹화강의</StatusBadge><Link className="button button--soft" to={managePath}>구성으로 돌아가기</Link></div>}
      />

      <div className="recorded-lesson-detail-grid">
        <Panel
          className="recorded-lesson-media-panel"
          title={processing?.recordedPublicationStatus === 'PUBLISHED' ? '녹화강의 미리보기' : '게시 준비 현황'}
          description={processing?.recordedPublicationStatus === 'PUBLISHED'
            ? '수강생에게 제공되는 HLS 영상과 WebVTT 자막을 함께 확인합니다.'
            : 'HLS 재생본과 AI 자막이 모두 완료되면 녹화강의가 자동 게시됩니다.'}
          action={processing ? <StatusBadge tone={processing.status === 'FAILED' || processing.captionStatus === 'FAILED' ? 'danger' : processing.recordedPublicationStatus === 'PUBLISHED' ? 'success' : 'warning'}>{processing.recordedPublicationStatus}</StatusBadge> : undefined}
        >
          {processingQuery.isPending ? (
            <div className="recorded-processing-state" role="status"><strong>영상 처리 상태를 확인하고 있습니다.</strong><p>잠시만 기다려 주세요.</p></div>
          ) : processingQuery.isError || !processing ? (
            <div className="recorded-processing-state recorded-processing-state--error" role="alert">
              <strong>영상 처리 상태를 불러오지 못했습니다.</strong>
              <p>녹화강의 정보는 저장되어 있습니다. 상태 조회를 다시 시도해 주세요.</p>
              <button className="button button--soft" type="button" onClick={() => void refetchProcessing()}>상태 다시 확인</button>
            </div>
          ) : processing.status === 'AWAITING_UPLOAD' ? (
            <InlineNotice tone="warning">영상 업로드가 완료되지 않아 처리를 시작하지 못했습니다.</InlineNotice>
          ) : processing.status === 'FAILED' ? (
            <div className="recorded-processing-state recorded-processing-state--error" role="alert">
              <StatusBadge tone="danger">처리 실패</StatusBadge>
              <strong>{recordedProcessingFailureMessage(processing.failureCode)}</strong>
              {processing.failureCode && <code>{processing.failureCode}</code>}
              <p>기존 MP4 원본으로 새 변환 작업을 시작할 수 있습니다.</p>
              <button className="button button--primary" type="button" disabled={retryMutation.isPending} onClick={retryProcessing}>
                {retryMutation.isPending ? '다시 처리 중…' : '다시 처리'}
              </button>
            </div>
          ) : processing.captionStatus === 'FAILED' ? (
            <div className="recorded-processing-state recorded-processing-state--error" role="alert">
              <StatusBadge tone="danger">자막 생성 실패</StatusBadge>
              <strong>{recordedCaptionFailureMessage(processing.captionFailureCode)}</strong>
              {processing.captionFailureCode && <code>{processing.captionFailureCode}</code>}
              <p>성공한 HLS 재생본은 유지하고 기존 MP4 원본으로 자막만 다시 생성합니다.</p>
              <button className="button button--primary" type="button" disabled={retryCaptionsMutation.isPending} onClick={retryCaptions}>
                {retryCaptionsMutation.isPending ? '자막 다시 처리 중…' : '자막 다시 처리'}
              </button>
            </div>
          ) : processing.recordedPublicationStatus === 'PUBLISHED' ? (
            <div className="recorded-player-stage" aria-label="녹화강의 영상" role="region">
              {playbackQuery.isPending ? (
                <div className="recorded-player-message" role="status"><strong>재생 정보를 불러오고 있습니다.</strong></div>
              ) : playbackQuery.isError || !playbackQuery.data ? (
                <div className="recorded-player-message recorded-player-message--error" role="alert">
                  <strong>{recordedPlaybackErrorMessage(playbackQuery.error)}</strong>
                  <button className="button button--soft" type="button" onClick={retryPlayback}>재생 정보 다시 받기</button>
                </div>
              ) : (
                <>
                  <HlsMediaPlayer
                    sourceUrl={playbackQuery.data.source.url}
                    title={lesson.title}
                    streamType="on-demand"
                    durationMs={playbackQuery.data.durationMs}
                    captionTracks={playbackQuery.data.captions.tracks.map((track) => ({
                      trackId: track.trackId,
                      src: track.url,
                      kind: track.kind,
                      label: track.label,
                      language: track.language,
                      default: track.default,
                      version: track.version,
                    }))}
                    reloadToken={reloadToken}
                    className="recorded-lesson-player"
                    onStateChange={setPlaybackState}
                  />
                  {playbackState === 'error' && (
                    <div className="recorded-player-message recorded-player-message--error" role="alert">
                      <strong>HLS 영상을 재생하지 못했습니다.</strong>
                      <button className="button button--soft" type="button" onClick={retryPlayback}>재생 주소 다시 받기</button>
                    </div>
                  )}
                  <div className="recorded-player-status" aria-label="재생 상태">
                    <StatusBadge tone={playbackState === 'error' ? 'danger' : playbackState === 'buffering' || playbackState === 'loading' ? 'warning' : 'success'}>{playbackStateLabel(playbackState)}</StatusBadge>
                    <span>{lesson.title}</span>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="recorded-processing-state" role="status">
              <div className="recorded-player-status" aria-label="병렬 처리 상태">
                <StatusBadge tone={processing.status === 'READY' ? 'success' : 'warning'}>HLS {processing.status}</StatusBadge>
                <StatusBadge tone={processing.captionStatus === 'READY' || processing.captionStatus === 'EMPTY' ? 'success' : 'warning'}>자막 {processing.captionStatus}</StatusBadge>
                <StatusBadge tone="warning">게시 {processing.recordedPublicationStatus}</StatusBadge>
              </div>
              <ol className="recorded-processing-steps" aria-label="영상 처리 단계">
                {RECORDED_PROCESSING_STAGES.map((stage, index) => {
                  const state = index < activeStageIndex ? 'complete' : index === activeStageIndex ? 'current' : 'upcoming'
                  return (
                    <li className={`is-${state}`} key={stage.status} aria-current={state === 'current' ? 'step' : undefined}>
                      <span>{state === 'complete' ? '✓' : index + 1}</span>
                      <div><strong>{stage.title}</strong><small>{stage.description}</small></div>
                    </li>
                  )
                })}
              </ol>
              <p className="recorded-processing-note">영상과 자막이 모두 끝나 자동 게시되면 별도 이동 없이 플레이어가 열립니다.</p>
            </div>
          )}
        </Panel>

        <Panel className="recorded-lesson-info-panel" title="강의 및 영상 정보">
          <dl className="recorded-lesson-metadata">
            <div><dt>커리큘럼</dt><dd>{lesson.curriculumTitle}</dd></div>
            <div><dt>섹션</dt><dd>{lesson.sectionTitle}</dd></div>
            <div><dt>영상 길이</dt><dd>{duration ?? '처리 후 표시'}</dd></div>
            <div><dt>재생본 용량</dt><dd>{size ?? '처리 후 표시'}</dd></div>
            <div><dt>준비 완료</dt><dd>{readyAt ?? '처리 중'}</dd></div>
            <div><dt>AI 자막</dt><dd>{processing?.captionStatus ?? '확인 중'}</dd></div>
            <div><dt>게시 완료</dt><dd>{publishedAt ?? '게시 준비 중'}</dd></div>
            <div><dt>강의 자료</dt><dd>{lesson.materials.length}개</dd></div>
          </dl>
        </Panel>

        <Panel
          className="recorded-lesson-info-panel"
          title="강의 자료 처리"
          description="PPTX 임베딩과 주요 용어 추출은 영상 변환과 독립적으로 처리됩니다."
        >
          {lesson.materials.length === 0 ? (
            <InlineNotice tone="info">등록된 PPTX 강의 자료가 없습니다.</InlineNotice>
          ) : (
            <ul className="material-list material-list--compact">
              {lesson.materials.map((material) => {
                const embeddingStatus = material.embeddingStatus ?? material.status
                const keyTermStatus = material.keyTermStatus ?? 'NOT_REQUESTED'
                return (
                  <li key={material.id}>
                    <span className="file-icon">PPTX</span>
                    <div><strong>{material.name}</strong><small>{material.size}</small></div>
                    <StatusBadge tone={materialStatusTone(embeddingStatus)}>
                      임베딩 {embeddingStatus}
                    </StatusBadge>
                    <StatusBadge tone={materialStatusTone(keyTermStatus)}>
                      {keyTermStatusLabel(keyTermStatus)}
                    </StatusBadge>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}
