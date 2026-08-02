import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { instructorPaths } from '@/app/router/paths'
import { getLesson } from '@/features/lesson/lessonService'
import {
  buildProcessingSteps,
  isProcessingTerminal,
  isReplayReady,
  processingPollInterval,
} from '@/features/live-session/liveSessionProcessing'
import { getLiveSession, getProcessingStatus } from '@/features/live-session/liveSessionService'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import PageState from '@/shared/ui/PageState'
import { InlineNotice, PageHeader, Panel, StatusBadge } from '@/shared/ui/WorkspaceUi'

const DELAY_NOTICE_MS = 120_000

function formatDuration(durationMs: number | null | undefined) {
  if (durationMs === null || durationMs === undefined) return '처리 후 표시됩니다'
  const totalMinutes = Math.floor(durationMs / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}시간 ${minutes}분` : `${minutes}분`
}

function formatEndedAt(value: string | null | undefined) {
  if (!value) return '확인 중'
  const endedAt = new Date(value)
  if (Number.isNaN(endedAt.getTime())) return value
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(endedAt)
}

function stepLabel(status: 'COMPLETE' | 'PROCESSING' | 'PENDING' | 'FAILED') {
  if (status === 'COMPLETE') return '완료'
  if (status === 'PROCESSING') return '처리 중'
  if (status === 'FAILED') return '실패'
  return '대기'
}

export default function LiveSessionProcessingPage() {
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const mountedAt = useRef(Date.now())
  const redirected = useRef(false)
  const [delayed, setDelayed] = useState(false)
  const sessionQuery = useQuery({
    queryKey: ['live-session', sessionId],
    queryFn: () => getLiveSession(sessionId),
    enabled: Boolean(sessionId),
  })
  const processingQuery = useQuery({
    queryKey: ['live-session-processing', sessionId],
    queryFn: () => getProcessingStatus(sessionId),
    enabled: Boolean(sessionId),
    retry: 2,
    refetchInterval: (query) => processingPollInterval(
      query.state.data,
      Date.now() - mountedAt.current,
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })
  const session = sessionQuery.data
  const processing = processingQuery.data
  const lessonQuery = useQuery({
    queryKey: ['processing-lesson', session?.lessonId],
    queryFn: () => getLesson({ lessonId: session!.lessonId, role: 'INSTRUCTOR' }),
    enabled: Boolean(session?.lessonId),
  })
  const lesson = lessonQuery.data

  useEffect(() => {
    mountedAt.current = Date.now()
    redirected.current = false
    setDelayed(false)
    const timeout = window.setTimeout(() => setDelayed(true), DELAY_NOTICE_MS)
    return () => window.clearTimeout(timeout)
  }, [sessionId])

  useEffect(() => {
    if (!session || !processing || redirected.current || !isReplayReady(processing)) return
    redirected.current = true
    navigate(instructorPaths.replay(session.lessonId), { replace: true })
  }, [navigate, processing, session])

  usePageTitle('녹화 처리 현황')

  if (!sessionId) return <PageState title="잘못된 라이브 세션 경로입니다" />
  if (sessionQuery.isPending || processingQuery.isPending) {
    return <PageState title="녹화 처리 현황을 불러오는 중입니다" description="종료된 녹화 상태를 확인하고 있습니다." />
  }
  if (sessionQuery.isError || processingQuery.isError || !session || !processing) {
    return (
      <PageState
        title="녹화 처리 현황을 불러오지 못했습니다"
        description="네트워크 연결을 확인한 뒤 다시 시도해 주세요. 녹화 실패를 뜻하지는 않습니다."
        action={<button className="button button--primary" type="button" onClick={() => processingQuery.refetch()}>다시 시도</button>}
      />
    )
  }

  const asset = processing.videoAsset
  const failed = asset?.status === 'FAILED'
  const ready = isReplayReady(processing)
  const terminal = isProcessingTerminal(processing)
  const steps = buildProcessingSteps(processing)
  const badgeTone = failed ? 'danger' : ready ? 'success' : 'warning'
  const badgeText = asset?.status ?? 'NO RECORDING'

  return (
    <div className="workspace-page workspace-page--narrow">
      <PageHeader
        title="녹화 처리 현황"
        description={`${lesson?.title ?? '종료된 강의'}의 HLS 녹화를 재생 가능한 다시보기로 준비합니다.`}
        action={<StatusBadge tone={badgeTone}>{badgeText}</StatusBadge>}
      />

      <Panel title="강의 종료 요약">
        <dl className="summary-grid">
          <div><dt>강의</dt><dd>{lesson?.title ?? '확인 중'}</dd></div>
          <div><dt>라이브 상태</dt><dd>{processing.liveSessionStatus}</dd></div>
          <div><dt>녹화 길이</dt><dd>{formatDuration(asset?.durationMs)}</dd></div>
          <div><dt>강의 종료 시각</dt><dd>{formatEndedAt(processing.endedAt)}</dd></div>
        </dl>
      </Panel>

      <Panel title="영상 처리 단계" description="화면은 서버에 저장된 두 상태축만 확인하며 LiveKit과 저장소를 다시 호출하지 않습니다.">
        <ol className="processing-steps">
          {steps.map((step, index) => (
            <li
              className={step.status === 'COMPLETE' ? 'is-complete' : step.status === 'PROCESSING' ? 'is-current' : step.status === 'FAILED' ? 'is-failed' : ''}
              key={step.label}
            >
              <span>{step.status === 'COMPLETE' ? '✓' : step.status === 'FAILED' ? '!' : index + 1}</span>
              <div><strong>{step.label}</strong><small>{stepLabel(step.status)}</small></div>
            </li>
          ))}
        </ol>
        {!terminal && (
          <button
            className="button button--soft button--full"
            type="button"
            disabled={processingQuery.isFetching}
            onClick={() => processingQuery.refetch()}
          >
            최신 처리 상태 확인
          </button>
        )}
      </Panel>

      {failed ? (
        <InlineNotice tone="danger">
          녹화 처리에 실패했습니다{asset.failureCode ? ` (${asset.failureCode})` : ''}. 관리자에게 세션 ID를 전달해 주세요.
        </InlineNotice>
      ) : !asset && !processing.recordingEnabled ? (
        <InlineNotice tone="warning">이 세션은 녹화를 켜지 않고 진행해 다시보기가 만들어지지 않습니다.</InlineNotice>
      ) : !asset ? (
        <InlineNotice tone="info">아직 녹화 자산이 만들어지지 않았습니다. 라이브가 시작되면 생성됩니다.</InlineNotice>
      ) : asset.status === 'READY' && asset.replayStatus !== 'PUBLISHED' ? (
        <InlineNotice tone="warning">영상은 재생할 수 있지만 아직 수강생에게 공개하지 않았습니다. 검수 후 게시하세요.</InlineNotice>
      ) : delayed ? (
        <InlineNotice tone="warning">처리가 평소보다 오래 걸리고 있습니다. 이 화면을 열어 둬도 되고 나중에 다시 확인해도 됩니다.</InlineNotice>
      ) : (
        <InlineNotice tone="info">녹화 파일을 마무리하고 있습니다. 준비가 끝나면 다시보기 화면으로 자동 이동합니다.</InlineNotice>
      )}

      <div className="sticky-form-actions">
        <Link className="button button--ghost" to={instructorPaths.curriculums}>내 커리큘럼</Link>
        {asset?.status === 'READY' && asset.replayStatus !== 'PUBLISHED'
          ? <Link className="button button--primary button--large" to={instructorPaths.replay(session.lessonId)}>VOD 미리보기·검수</Link>
          : !ready && <span aria-disabled className="button button--primary button--large is-disabled">VOD 미리보기·검수</span>}
      </div>
    </div>
  )
}
