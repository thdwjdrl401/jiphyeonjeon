import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { instructorPaths } from '@/app/router/paths'
import { getLesson } from '@/features/lesson/lessonService'
import { getLiveSession, getProcessingStatus } from '@/features/live-session/liveSessionService'
import type { ProcessingStatus, VideoAssetStatus } from '@/features/live-session/liveSessionService.interface'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import PageState from '@/shared/ui/PageState'
import { InlineNotice, PageHeader, Panel, StatusBadge } from '@/shared/ui/WorkspaceUi'

/**
 * 종료 후 녹화 처리 현황.
 *
 * 라이브를 끝냈다고 영상이 곧바로 볼 수 있는 게 아니다 — 세션이 `ENDED`가 된 뒤에도 녹화 자산은
 * `FINALIZING → VERIFYING → READY`를 따로 지나가고, 그 전이는 Egress 완료 webhook이 나중에 몰고 온다.
 * 이 화면은 그 두 축을 나눠 보여주고, 자산이 `READY`가 됐을 때만 검수·게시로 가는 문을 연다.
 *
 * 표시 문구는 서버가 아니라 여기서 만든다(CONTRACT §2-2). 서버는 상태만 준다.
 */

/** 자산이 지나는 순서. 화면의 진행 막대는 이 순서 위에서 현재 위치를 계산한다. */
const PIPELINE: Array<{ status: VideoAssetStatus; label: string; detail: string }> = [
  { status: 'RECORDING', label: '녹화', detail: '라이브를 녹화하는 중입니다.' },
  { status: 'FINALIZING', label: 'HLS 마무리', detail: '마지막 세그먼트와 재생목록을 씁니다.' },
  { status: 'VERIFYING', label: '재생 가능성 확인', detail: '저장소에 영상이 실제로 있는지 확인합니다.' },
  { status: 'READY', label: '재생 준비 완료', detail: '다시보기로 재생할 수 있습니다.' },
]

/** 아직 파이프라인에 오르기 전. 진행 막대에서는 첫 단계 앞으로 본다. */
const BEFORE_PIPELINE: VideoAssetStatus[] = ['REQUESTED', 'STARTING']

const dateTimeFormatter = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })

function formatDuration(ms: number | null): string | null {
  if (ms === null || ms <= 0) return null
  const totalMinutes = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}시간 ${minutes}분` : `${minutes}분`
}

function formatDateTime(iso: string | null): string | null {
  if (!iso) return null
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime()) ? null : dateTimeFormatter.format(parsed)
}

/** 종료 시각과 녹화 종료 시각이 다를 수 있다 — 강사가 보는 "강의가 끝난 시각"은 세션 쪽이다. */
function stepState(current: VideoAssetStatus | null, index: number): 'COMPLETE' | 'PROCESSING' | 'PENDING' {
  if (current === null || BEFORE_PIPELINE.includes(current)) return 'PENDING'
  const currentIndex = PIPELINE.findIndex((step) => step.status === current)
  if (currentIndex < 0) return 'PENDING'   // FAILED — 진행 표시는 멈춘다
  if (index < currentIndex) return 'COMPLETE'
  if (index === currentIndex) return current === 'READY' ? 'COMPLETE' : 'PROCESSING'
  return 'PENDING'
}

/** 아직 움직일 상태면 계속 물어본다. webhook이 나중에 도착하므로 한 번 읽고 멈추면 변화를 놓친다. */
function pollInterval(processing: ProcessingStatus | undefined): number | false {
  if (!processing) return 4_000
  const status = processing.videoAsset?.status ?? null
  if (status === 'READY' || status === 'FAILED') return false
  // 녹화를 켜지 않은 세션은 자산이 영원히 생기지 않는다. 계속 물어볼 이유가 없다.
  if (status === null && !processing.recordingEnabled) return false
  return 4_000
}

export default function LiveSessionProcessingPage() {
  const { sessionId = '' } = useParams()
  const sessionQuery = useQuery({ queryKey: ['live-session', sessionId], queryFn: () => getLiveSession(sessionId), enabled: Boolean(sessionId) })
  const lessonQuery = useQuery({
    queryKey: ['processing-lesson', sessionQuery.data?.lessonId],
    queryFn: () => getLesson({ lessonId: sessionQuery.data!.lessonId, role: 'INSTRUCTOR' }),
    enabled: Boolean(sessionQuery.data?.lessonId),
  })
  const processingQuery = useQuery({
    queryKey: ['live-session-processing', sessionId],
    queryFn: () => getProcessingStatus(sessionId),
    enabled: Boolean(sessionId),
    refetchInterval: (query) => pollInterval(query.state.data),
  })
  usePageTitle('녹화 처리 현황')

  const session = sessionQuery.data
  const lesson = lessonQuery.data
  const processing = processingQuery.data
  const asset = processing?.videoAsset ?? null
  const assetStatus = asset?.status ?? null
  const ready = assetStatus === 'READY'
  const failed = assetStatus === 'FAILED'
  // 자산이 준비된 것과 수강생에게 공개한 것은 다른 사실이다. 배지가 둘을 섞으면 안 된다.
  const published = asset?.replayStatus === 'PUBLISHED'

  if (!sessionId) return <PageState title="잘못된 라이브 세션 경로입니다" />
  if (sessionQuery.isPending || lessonQuery.isPending || processingQuery.isPending) {
    return <PageState title="녹화 처리 현황을 불러오는 중입니다" />
  }
  if (sessionQuery.isError || lessonQuery.isError || processingQuery.isError || !session || !lesson || !processing) {
    return <PageState title="녹화 처리 현황을 불러오지 못했습니다" />
  }

  const duration = formatDuration(asset?.durationMs ?? null)
  const endedAt = formatDateTime(processing.endedAt)

  return <div className="workspace-page workspace-page--narrow"><PageHeader title="녹화 처리 현황" description={`${lesson.title}의 녹화 자산이 어디까지 왔는지 확인합니다.`} action={<StatusBadge tone={failed ? 'danger' : ready ? 'success' : 'warning'}>{assetStatus ?? '녹화 없음'}</StatusBadge>} />
    <Panel title="강의 종료 요약"><dl className="summary-grid">
      <div><dt>강의</dt><dd>{lesson.title}</dd></div>
      <div><dt>라이브 상태</dt><dd>{processing.liveSessionStatus}</dd></div>
      <div><dt>녹화 길이</dt><dd>{duration ?? '집계 전'}</dd></div>
      <div><dt>종료 시각</dt><dd>{endedAt ?? '기록 없음'}</dd></div>
    </dl></Panel>

    <Panel title="영상 처리 단계" description="라이브 종료와 녹화 자산 준비는 별도 상태로 진행합니다.">
      {asset === null
        ? <InlineNotice tone={processing.recordingEnabled ? 'info' : 'warning'}>
            {processing.recordingEnabled
              ? '아직 녹화 자산이 만들어지지 않았습니다. 라이브가 시작되면 생성됩니다.'
              : '이 세션은 녹화를 켜지 않고 진행해 다시보기가 만들어지지 않습니다.'}
          </InlineNotice>
        : <ol className="processing-steps">{PIPELINE.map((step, index) => {
            const state = stepState(assetStatus, index)
            return <li className={state === 'COMPLETE' ? 'is-complete' : state === 'PROCESSING' ? 'is-current' : ''} key={step.status}>
              <span>{state === 'COMPLETE' ? '✓' : index + 1}</span>
              <div><strong>{step.label}</strong><small>{state === 'COMPLETE' ? '완료' : state === 'PROCESSING' ? step.detail : '대기'}</small></div>
            </li>
          })}</ol>}
      {failed && <InlineNotice tone="danger">녹화가 실패했습니다{asset?.failureCode ? ` (${asset.failureCode})` : ''}. 이 강의의 다시보기는 만들어지지 않습니다.</InlineNotice>}
      {!ready && !failed && asset !== null && <button className="button button--soft button--full" type="button" disabled={processingQuery.isFetching} onClick={() => processingQuery.refetch()}>지금 다시 확인</button>}
    </Panel>

    {ready && <Panel title="다시보기 게시"><InlineNotice tone={published ? 'success' : 'info'}>
      {published
        ? '수강생에게 공개된 상태입니다.'
        : '영상은 재생할 수 있지만 아직 수강생에게 공개하지 않았습니다. 검수 후 게시하세요.'}
    </InlineNotice></Panel>}

    <div className="sticky-form-actions">
      <Link className="button button--ghost" to={instructorPaths.lesson(lesson.curriculumId, lesson.sectionId, lesson.lessonId)}>강의 상세</Link>
      {/* 준비 전에는 링크를 아예 만들지 않는다. `to="#"`는 현재 경로로 풀려 "잠긴" 링크가 실제로는
          같은 화면으로 이동하는 링크가 된다 — 보조기술에도 이동 가능한 링크로 읽힌다. */}
      {ready
        ? <Link className="button button--primary button--large" to={instructorPaths.replay(lesson.lessonId)}>VOD 미리보기·검수</Link>
        : <span aria-disabled className="button button--primary button--large is-disabled">VOD 미리보기·검수</span>}
    </div>
  </div>
}
