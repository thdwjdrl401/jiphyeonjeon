import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { instructorPaths } from '@/app/router/paths'
import { useInstructorLiveKit } from '@/features/live-session/useInstructorLiveKit'
import {
  getLiveSession,
  getLiveStartStatus,
  getPreflightReadiness,
  startLiveSession,
  type LiveSessionView,
} from '@/features/live-session/liveSessionService'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import PageState from '@/shared/ui/PageState'
import { useToast } from '@/shared/ui/Toast'
import { InlineNotice, PageHeader, Panel, StatusBadge } from '@/shared/ui/WorkspaceUi'

function connectionLabel(state: ReturnType<typeof useInstructorLiveKit>['connectionState']) {
  if (state === 'mock') return 'Mock 연결'
  if (state === 'connected') return '연결됨'
  if (state === 'preparing') return '방 준비 중'
  if (state === 'connecting') return '연결 중'
  if (state === 'reconnecting') return '재연결 중'
  if (state === 'error') return '연결 실패'
  if (state === 'disconnected') return '연결 끊김'
  return '대기'
}

export default function InstructorPreflightPage() {
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const queryClient = useQueryClient()
  const publisher = useInstructorLiveKit()
  const [operationId, setOperationId] = useState<string | undefined>()
  const sessionQuery = useQuery({
    queryKey: ['live-session', sessionId],
    queryFn: () => getLiveSession(sessionId),
    enabled: Boolean(sessionId),
  })
  const localPublisherReady = (
    publisher.connectionState === 'connected' || publisher.connectionState === 'mock'
  ) && publisher.microphoneEnabled
  const readinessQuery = useQuery({
    queryKey: ['live-session-preflight-readiness', sessionId, publisher.mediaRevision],
    queryFn: () => getPreflightReadiness(sessionId),
    enabled: Boolean(sessionId) && localPublisherReady,
    refetchInterval: (query) => query.state.data?.ready ? 3_000 : 1_000,
  })
  const session = sessionQuery.data
  const shouldRecoverStart = session?.status === 'STARTING'
  const startStatusQuery = useQuery({
    queryKey: ['live-session-start-status', sessionId, operationId ?? 'latest'],
    queryFn: () => getLiveStartStatus(sessionId, operationId),
    enabled: Boolean(sessionId) && (Boolean(operationId) || shouldRecoverStart),
    refetchInterval: (query) => query.state.data?.attemptStatus === 'IN_PROGRESS' ? 1_000 : false,
  })
  const startMutation = useMutation({
    mutationFn: () => startLiveSession(sessionId),
    onSuccess: (operation) => {
      if (operation.status === 'LIVE') {
        navigate(instructorPaths.classroom(sessionId))
        return
      }
      setOperationId(operation.operationId ?? undefined)
    },
    // 요청 자체 실패는 한 번 읽고 지나가는 알림으로, 비동기 시작 실패는 아래 상태 안내로 보여준다.
    onError: () => toast.error('라이브 시작 요청에 실패했습니다. 점검 상태를 다시 확인해 주세요.'),
  })

  useEffect(() => {
    const result = startStatusQuery.data
    if (!result) return
    queryClient.setQueryData<LiveSessionView>(['live-session', sessionId], result.session)
    if (result.attemptStatus === 'SUCCEEDED' && result.session.status === 'LIVE') {
      navigate(instructorPaths.classroom(sessionId))
    }
  }, [navigate, queryClient, sessionId, startStatusQuery.data])

  const serverReady = readinessQuery.data?.ready === true
  const starting = startMutation.isPending || startStatusQuery.data?.attemptStatus === 'IN_PROGRESS'
  const ready = localPublisherReady && serverReady && !starting
  const startFailure = startStatusQuery.data?.attemptStatus === 'FAILED'
    ? startStatusQuery.data
    : null
  usePageTitle('강사 사전 점검')

  if (!sessionId) return <PageState title="잘못된 라이브 세션 경로입니다" />
  if (sessionQuery.isPending) return <PageState title="라이브 세션을 불러오는 중입니다" />
  if (sessionQuery.isError || !session) return <PageState title="라이브 세션을 불러오지 못했습니다" />

  return (
    <div className="workspace-page">
      <PageHeader
        title="라이브 시작 전 최종 점검"
        description={`${session.lessonTitle} · 실제 마이크 송출과 서버 확인을 통과해야 시작할 수 있습니다.`}
        action={<StatusBadge tone={ready ? 'success' : starting ? 'warning' : 'warning'}>{ready ? '시작 가능' : starting ? '시작 준비 중' : '점검 필요'}</StatusBadge>}
      />

      <div className="preflight-grid">
        <Panel title="실제 송출 장치" description="이 연결과 트랙은 LIVE 전환 뒤 강의실에서도 그대로 사용합니다.">
          <div className="camera-preview">
            <div className="camera-avatar">이</div>
            <span>{publisher.cameraEnabled ? '카메라 미리보기 송출 중' : '카메라는 선택 사항입니다'}</span>
          </div>
          <div className="media-control-row">
            <button
              className={`media-toggle${publisher.cameraEnabled ? ' is-on' : ''}`}
              disabled={!publisher.canControl || Boolean(publisher.pendingControl)}
              type="button"
              onClick={publisher.toggleCamera}
            >
              카메라 {publisher.cameraEnabled ? '켜짐' : '켜기'}
            </button>
            <button
              className={`media-toggle${publisher.microphoneEnabled ? ' is-on' : ''}`}
              disabled={!publisher.canControl || Boolean(publisher.pendingControl)}
              type="button"
              onClick={publisher.toggleMicrophone}
            >
              마이크 {publisher.microphoneEnabled ? '송출 중' : '켜기'}
            </button>
          </div>
          {publisher.errorMessage && (
            <InlineNotice tone="danger">
              {publisher.errorMessage}{' '}
              <button className="button button--soft button--small" type="button" onClick={publisher.retry}>다시 연결</button>
            </InlineNotice>
          )}
        </Panel>

        <Panel title="서버 시작 조건" description="브라우저 표시가 아니라 LiveKit 서버에서 participant와 track을 다시 조회합니다.">
          <ul className="readiness-list">
            <li>
              <span>LiveKit 연결<small>ROOM_CONNECTION</small></span>
              <StatusBadge tone={localPublisherReady ? 'success' : 'warning'}>{connectionLabel(publisher.connectionState)}</StatusBadge>
            </li>
            <li>
              <span>강사 participant<small>INSTRUCTOR_PRESENT</small></span>
              <StatusBadge tone={readinessQuery.data?.instructorPresent ? 'success' : 'warning'}>
                {readinessQuery.data?.instructorPresent ? '확인됨' : '대기'}
              </StatusBadge>
            </li>
            <li>
              <span>마이크 track<small>MICROPHONE_PUBLISHED</small></span>
              <StatusBadge tone={readinessQuery.data?.microphonePublished && !readinessQuery.data?.microphoneMuted ? 'success' : 'warning'}>
                {readinessQuery.data?.microphonePublished
                  ? readinessQuery.data.microphoneMuted ? '음소거됨' : `${readinessQuery.data.instructorMicrophoneTrackCount}개 송출`
                  : '대기'}
              </StatusBadge>
            </li>
            <li>
              <span>다른 마이크 publisher<small>UNEXPECTED_PUBLISHER</small></span>
              <StatusBadge tone={readinessQuery.data?.unexpectedMicrophonePublishers === 0 ? 'success' : 'warning'}>
                {readinessQuery.data ? `${readinessQuery.data.unexpectedMicrophonePublishers}명` : '대기'}
              </StatusBadge>
            </li>
          </ul>
          <button
            className="button button--soft button--full"
            type="button"
            disabled={!localPublisherReady || readinessQuery.isFetching}
            onClick={() => { void readinessQuery.refetch() }}
          >
            {serverReady ? '서버 점검 완료' : readinessQuery.isFetching ? '점검 중...' : '최신 상태 점검'}
          </button>
        </Panel>
      </div>

      <InlineNotice tone={ready ? 'success' : starting ? 'warning' : 'warning'}>
        {ready
          ? '실제 마이크 송출이 확인되었습니다. 시작 요청 뒤 Egress 준비와 강사 연결 재검증을 진행합니다.'
          : starting
            ? `STARTING · ${startStatusQuery.data?.step ?? 'ACCEPTED'} — 이 화면을 닫거나 마이크를 끄지 마세요.`
            : '마이크를 publish하고 서버 점검이 완료될 때까지 기다려 주세요.'}
      </InlineNotice>
      {startStatusQuery.isError && <InlineNotice tone="danger">시작 상태를 확인하지 못했습니다. 자동으로 다시 확인해 주세요.</InlineNotice>}
      {startFailure && (
        <InlineNotice tone="danger">
          {startFailure.failureMessage ?? '라이브 시작 준비에 실패했습니다.'}
          {startFailure.failureCode ? ` (${startFailure.failureCode})` : ''}
        </InlineNotice>
      )}
      <div className="sticky-form-actions">
        <button
          disabled={!ready || startMutation.isPending}
          className={`button button--primary button--large${ready ? '' : ' is-disabled'}`}
          type="button"
          onClick={() => startMutation.mutate()}
        >
          {starting ? '라이브 준비 중...' : startFailure ? '다시 시작' : '라이브 시작'}
        </button>
      </div>
    </div>
  )
}
