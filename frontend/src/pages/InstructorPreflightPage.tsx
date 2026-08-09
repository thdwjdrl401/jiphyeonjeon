import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { instructorPaths, publicPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import LessonBreadcrumbs from '@/features/lesson/LessonBreadcrumbs'
import { getLesson } from '@/features/lesson/lessonService'
import { isMaterialInProgress, materialRefetchInterval } from '@/features/material/materialStatus'
import DemoPublishControl from '@/features/live-session/DemoPublishControl'
import InstructorLocalTrackVideo from '@/features/live-session/InstructorLocalTrackVideo'
import MediaFailureNotice from '@/features/live-session/MediaFailureNotice'
import MicrophoneLevelMeter from '@/features/live-session/MicrophoneLevelMeter'
import { useInstructorLiveKit } from '@/features/live-session/useInstructorLiveKit'
import type { MediaPermissionState } from '@/features/live-session/mediaFailure'
import {
  CAMERA_QUALITIES,
  SCREEN_QUALITIES,
  megabits,
} from '@/features/live-session/publishQuality'
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

/**
 * 브라우저에 저장된 마이크 권한을 점검 항목으로 보여 준다.
 *
 * <p>차단은 <b>강사가 브라우저 설정에서 직접 풀어야</b> 넘어가는 상태라, 다른 항목들처럼 기다린다고
 * 해결되지 않는다. 그래서 대기(warning)가 아니라 실패(danger)로 그린다.
 */
function permissionBadge(permission: MediaPermissionState): { tone: 'success' | 'warning' | 'danger'; label: string } {
  if (permission === 'granted') return { tone: 'success', label: '허용됨' }
  if (permission === 'denied') return { tone: 'danger', label: '차단됨' }
  if (permission === 'prompt') return { tone: 'warning', label: '확인 필요' }
  return { tone: 'warning', label: '확인 불가' }
}

export default function InstructorPreflightPage() {
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const publisher = useInstructorLiveKit()
  const [operationId, setOperationId] = useState<string | undefined>()
  const sessionQuery = useQuery({
    queryKey: ['live-session', sessionId],
    queryFn: () => getLiveSession(sessionId),
    enabled: Boolean(sessionId),
  })
  /**
   * 서버 점검을 시작할 조건. <b>마이크는 넣지 않는다</b>(ADR-0099) — 없으면 무음일 뿐이고, 여기 넣으면
   * 마이크가 없는 강사는 서버 점검이 영원히 시작되지 않아 화면이 멈춘 것처럼 보인다.
   */
  const localPublisherReady = publisher.connectionState === 'connected' || publisher.connectionState === 'mock'
  const cameraTrack = publisher.cameraEnabled ? publisher.cameraTrack : undefined
  const readinessQuery = useQuery({
    queryKey: ['live-session-preflight-readiness', sessionId, publisher.mediaRevision],
    queryFn: () => getPreflightReadiness(sessionId),
    enabled: Boolean(sessionId) && localPublisherReady,
    refetchInterval: (query) => query.state.data?.ready ? 3_000 : 1_000,
  })
  const session = sessionQuery.data
  /*
   * 자료 AI 준비 상태. 시작을 <b>막지 않는다</b> — 마이크와 같은 판단이다(ADR-0099). 임베딩이 FAILED로
   * 끝나거나 AI 워커·큐가 죽으면 PENDING에 영구히 머무는데, 그 때문에 수업 자체를 못 열면 안 된다.
   * 대신 지금 시작하면 무엇을 잃는지 말한다 — 초반 AI 답변이 이 자료를 못 쓴다.
   */
  const lessonQuery = useQuery({
    queryKey: ['live-preflight-lesson', session?.lessonId, user?.role],
    queryFn: () => getLesson({ lessonId: session!.lessonId, role: user?.role, userId: user?.userId }),
    enabled: Boolean(session?.lessonId),
    refetchInterval: (query) => materialRefetchInterval(query.state.data?.materials),
    refetchIntervalInBackground: false,
  })
  const pendingMaterials = (lessonQuery.data?.materials ?? []).filter(isMaterialInProgress)
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
  const serverCheckTone = readinessQuery.isError
    ? 'danger'
    // 장치 문제는 시작을 막지 않으므로(ADR-0099) 실패가 아니라 경고다.
    : publisher.mediaFailure
      ? 'warning'
      : serverReady
        ? 'success'
        : 'info'
  const serverCheckMessage = publisher.mediaFailure
    ? `${publisher.mediaFailure.title} — 이대로도 시작할 수 있고, 위 안내대로 해결하면 소리가 함께 나갑니다.`
    : !localPublisherReady
      ? 'LiveKit 연결이 확인되면 서버 점검을 자동으로 시작합니다.'
      : readinessQuery.isError
        ? '서버 상태를 확인하지 못했습니다. 잠시 후 자동으로 다시 확인합니다.'
        : serverReady
          ? '서버 점검 완료 · 강사 연결이 정상입니다.'
          : 'LiveKit 서버에서 강사 연결 상태를 확인하고 있습니다.'
  const micPermission = permissionBadge(publisher.microphonePermission)
  /**
   * 소리가 나갈 것인가. <b>시작을 막지는 않지만</b>(ADR-0099) 강사가 알고 눌러야 한다 — 무음은
   * 조용히 실패해서, 알려 주지 않으면 강의가 끝난 뒤에야 드러난다(ADR-0048).
   *
   * <p>서버 판정이 있으면 그쪽을 쓴다. 로컬 토글은 트랙이 실제로 올라갔는지까지는 모른다.
   */
  const audioSilent = readinessQuery.data
    ? !readinessQuery.data.microphonePublished || readinessQuery.data.microphoneMuted
    : !publisher.microphoneEnabled
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
    <div className="workspace-page instructor-preflight-page">
      <LessonBreadcrumbs
        curriculumPath={session.curriculumId ? publicPaths.curriculum(session.curriculumId) : undefined}
        curriculumTitle={session.curriculumTitle}
        lessonPath={session.curriculumId && session.sectionId
          ? instructorPaths.lesson(session.curriculumId, session.sectionId, session.lessonId)
          : undefined}
        lessonTitle={session.lessonTitle}
        sectionTitle={session.sectionTitle}
      />
      <PageHeader title="라이브 시작 전 최종 점검" />

      <div className="instructor-preflight__layout">
        <Panel
          className="instructor-preflight__device-panel"
          title="실제 송출 장치"
          description={`${session.lessonTitle} · LIVE 전환 후에도 현재 장치를 그대로 사용합니다.`}
          action={<StatusBadge tone={localPublisherReady ? 'success' : 'warning'}>{connectionLabel(publisher.connectionState)}</StatusBadge>}
        >
          <div className={`camera-preview${cameraTrack ? ' camera-preview--active' : ''}`}>
            {cameraTrack ? (
              <>
                <InstructorLocalTrackVideo
                  className="camera-preview__video"
                  fit="contain"
                  label="사전 점검 카메라 미리보기"
                  // 웹캠은 거울, 데모 파일은 그대로 — 실제로 나가는 화면과 같아야 확인이 된다.
                  mirrored={publisher.cameraOverlay.mirrored}
                  track={cameraTrack}
                />
                <span className="camera-preview__status">카메라 미리보기 송출 중</span>
              </>
            ) : (
              <div className="instructor-preflight__camera-empty">
                <span className="instructor-preflight__camera-icon" aria-hidden="true">
                  <svg fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24">
                    <rect height="12" rx="2" width="13" x="3" y="6" />
                    <path d="m16 10 5-3v10l-5-3z" />
                    {!publisher.cameraEnabled && <path d="M3 3 21 21" />}
                  </svg>
                </span>
                <strong>
                  {publisher.connectionState === 'mock'
                    ? '카메라 미리보기 없음'
                    : publisher.cameraEnabled
                      ? '카메라 연결 중'
                      : '카메라 미리보기 꺼짐'}
                </strong>
                <p>
                  {publisher.connectionState === 'mock'
                    ? 'Mock 모드에서는 실제 카메라 화면을 표시하지 않습니다.'
                    : publisher.cameraEnabled
                      ? '카메라 트랙을 준비하고 있습니다. 잠시만 기다려 주세요.'
                      : '카메라는 선택 사항입니다. 필요하면 아래 버튼으로 켤 수 있어요.'}
                </p>
              </div>
            )}
          </div>
          <div className="media-control-row">
            <button
              className={`button button--soft button--small media-toggle${publisher.cameraEnabled ? ' is-on' : ''}`}
              disabled={!publisher.canControl || Boolean(publisher.pendingControl)}
              type="button"
              aria-pressed={publisher.cameraEnabled}
              onClick={publisher.toggleCamera}
            >
              <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24">
                <rect height="12" rx="2" width="13" x="3" y="6" />
                <path d="m16 10 5-3v10l-5-3z" />
              </svg>
              <span>카메라 {publisher.cameraEnabled ? '켜짐' : '켜기'}</span>
            </button>
            <button
              className={`button button--soft button--small media-toggle${publisher.microphoneEnabled ? ' is-on' : ''}`}
              disabled={!publisher.canControl || Boolean(publisher.pendingControl)}
              type="button"
              aria-pressed={publisher.microphoneEnabled}
              onClick={publisher.toggleMicrophone}
            >
              <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24">
                <rect height="10" rx="3" width="6" x="9" y="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" />
              </svg>
              <span>마이크 {publisher.microphoneEnabled ? '송출 중' : '켜기'}</span>
            </button>
          </div>
          {/*
            서버는 "마이크 1개 송출"까지만 확인해 준다. 그 트랙에 <b>소리가 실려 있는지</b>는 아무도
            모른다 — 운영체제 음소거·엉뚱한 입력 장치·죽은 마이크는 전부 publish에 성공한다.
            강사가 한마디 해서 게이지가 오르는 것이 그 마지막 한 칸이다(ADR-0099 §5).
          */}
          <MicrophoneLevelMeter track={publisher.microphoneTrack} />
          {/*
            시연 스위치는 <b>이 패널</b>에 둔다. 하는 일이 "무엇을 송출할지 고르는 것"이라 미리보기
            바로 아래가 제자리다 — 고른 결과가 위 화면에 그대로 보인다.

            시작 바에는 둘 수 없다. 그 바는 `grid-template-columns: auto minmax(0,1fr) auto`로 칸이
            셋인 그리드이고 바탕이 --ink-950(거의 검정)이라, 네 번째 자식을 넣으면 배치가 깨지고
            잉크색 글자는 보이지 않는다.
          */}
          <DemoPublishControl />
          {/*
            연결 실패와 장치 실패를 갈라 놓는다. 예전에는 한 칸이라, 마이크가 없는 컴퓨터에서
            "Requested device not found"가 연결 오류 자리에 떴다 — 방에는 이미 들어와 있었는데도.
          */}
          {publisher.errorMessage && (
            <InlineNotice tone="danger">
              {publisher.errorMessage}{' '}
              <button className="button button--soft button--small" type="button" onClick={publisher.retry}>다시 연결</button>
            </InlineNotice>
          )}
          {publisher.mediaFailure && (
            <MediaFailureNotice
              failure={publisher.mediaFailure}
              pending={Boolean(publisher.pendingControl)}
              onRetry={publisher.retryMedia}
            />
          )}
        </Panel>

        <div className="instructor-preflight__side-column">
          <Panel
            className="instructor-preflight__quality-panel"
            title="송출 품질"
            description="수강생에게 전달할 최대 화질을 설정합니다."
            action={publisher.applyingQuality ? <StatusBadge tone="warning">적용 중</StatusBadge> : undefined}
          >
            <fieldset className="quality-group" disabled={!publisher.canControl || publisher.applyingQuality}>
              <legend>카메라</legend>
              <div className="quality-options">
                {CAMERA_QUALITIES.map((option) => (
                  <label
                    key={option.id}
                    className={`quality-option${publisher.quality.camera === option.id ? ' is-selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="camera-quality"
                      value={option.id}
                      checked={publisher.quality.camera === option.id}
                      onChange={() => publisher.changeQuality({ camera: option.id })}
                    />
                    <span className="quality-option__label">{option.label}</span>
                    <span className="quality-option__rate">업로드 {megabits(option.preset)} Mbps</span>
                    <span className="quality-option__hint">{option.hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="quality-group" disabled={!publisher.canControl || publisher.applyingQuality}>
              <legend>화면 공유</legend>
              <div className="quality-options">
                {SCREEN_QUALITIES.map((option) => (
                  <label
                    key={option.id}
                    className={`quality-option${publisher.quality.screenShare === option.id ? ' is-selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="screen-quality"
                      value={option.id}
                      checked={publisher.quality.screenShare === option.id}
                      onChange={() => publisher.changeQuality({ screenShare: option.id })}
                    />
                    <span className="quality-option__label">{option.label}</span>
                    <span className="quality-option__rate">업로드 {megabits(option.preset)} Mbps</span>
                    <span className="quality-option__hint">{option.hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <InlineNotice tone="info">
              {publisher.applyingQuality
                ? '새 화질로 다시 송출하는 중입니다.'
                : '선택한 품질은 이 브라우저의 다음 강의에도 적용됩니다.'}
            </InlineNotice>
          </Panel>

          <Panel
            className="instructor-preflight__readiness-panel"
            title="서버 시작 조건"
            description="강사 연결과 마이크 트랙을 서버 기준으로 자동 확인합니다."
            action={<StatusBadge tone={serverReady ? 'success' : serverCheckTone === 'danger' ? 'danger' : 'warning'}>{serverReady ? '확인 완료' : '점검 중'}</StatusBadge>}
          >
            <ul className="readiness-list">
              <li>
                <span>LiveKit 연결<small>송출 방 연결 상태</small></span>
                <StatusBadge tone={localPublisherReady ? 'success' : 'warning'}>{connectionLabel(publisher.connectionState)}</StatusBadge>
              </li>
              {/*
                권한을 항목으로 세운다. 이것이 없으면 "마이크 송출 대기"만 계속 보여, 기다리면
                되는 상태인지 강사가 손대야 하는 상태인지 구분되지 않는다.
              */}
              <li>
                <span>마이크 권한<small>브라우저에 저장된 허용 상태</small></span>
                <StatusBadge tone={micPermission.tone}>{micPermission.label}</StatusBadge>
              </li>
              <li>
                <span>강사 연결<small>강사 입장 확인</small></span>
                <StatusBadge tone={readinessQuery.data?.instructorPresent ? 'success' : 'warning'}>
                  {readinessQuery.data?.instructorPresent ? '확인됨' : '대기'}
                </StatusBadge>
              </li>
              {/* 시작을 막는 항목이 아니다(ADR-0099). "대기"라고 쓰면 기다리면 풀리는 줄 안다. */}
              <li>
                <span>마이크 송출<small>없어도 시작할 수 있습니다</small></span>
                <StatusBadge tone={readinessQuery.data && !audioSilent ? 'success' : 'warning'}>
                  {!readinessQuery.data
                    ? '확인 중'
                    : readinessQuery.data.microphonePublished
                      ? readinessQuery.data.microphoneMuted ? '음소거됨' : `${readinessQuery.data.instructorMicrophoneTrackCount}개 송출`
                      : '소리 없음'}
                </StatusBadge>
              </li>
              <li>
                <span>중복 송출<small>다른 마이크 연결 감지</small></span>
                <StatusBadge tone={readinessQuery.data?.unexpectedMicrophonePublishers === 0 ? 'success' : 'warning'}>
                  {readinessQuery.data ? `${readinessQuery.data.unexpectedMicrophonePublishers}명` : '대기'}
                </StatusBadge>
              </li>
            </ul>
            <InlineNotice tone={serverCheckTone}>{serverCheckMessage}</InlineNotice>
          </Panel>
        </div>
      </div>

      {pendingMaterials.length > 0 && (
        <div className="instructor-preflight__feedback">
          <InlineNotice tone="warning">
            강의 자료 {pendingMaterials.length}개가 아직 AI 준비 중입니다. 지금 시작해도 되지만,
            준비가 끝나기 전에는 AI 답변이 이 자료를 참고하지 못합니다.
          </InlineNotice>
        </div>
      )}
      {(startStatusQuery.isError || startFailure) && (
        <div className="instructor-preflight__feedback">
          {startStatusQuery.isError && <InlineNotice tone="danger">시작 상태를 확인하지 못했습니다. 자동으로 다시 확인해 주세요.</InlineNotice>}
          {startFailure && (
            <InlineNotice tone="danger">
              {startFailure.failureMessage ?? '라이브 시작 준비에 실패했습니다.'}
              {startFailure.failureCode ? ` (${startFailure.failureCode})` : ''}
            </InlineNotice>
          )}
        </div>
      )}
      {/*
        마이크가 없어도 시작 버튼은 열려 있다(ADR-0099). 대신 무엇을 잃는지 이 자리에서 말한다 —
        무음은 조용히 실패해서, 여기서 말하지 않으면 강의가 끝난 뒤에야 드러난다.
      */}
      <div className={`sticky-form-actions instructor-preflight__actions${ready ? (audioSilent ? ' is-ready is-silent' : ' is-ready') : startFailure ? ' is-error' : ''}`}>
        <span className="instructor-preflight__start-icon" aria-hidden="true">
          {ready ? (audioSilent ? '!' : '✓') : startFailure ? '!' : starting ? '···' : '•'}
        </span>
        <div className="instructor-preflight__start-state" role="status" aria-live="polite">
          <strong>
            {ready
              ? audioSilent ? '마이크 없이 시작 준비됨' : '라이브 시작 준비 완료'
              : starting ? '라이브 시작 준비 중' : startFailure ? '라이브 시작 실패' : '필수 점검 진행 중'}
          </strong>
          <small>
            {ready
              ? audioSilent
                ? '소리 없이 송출됩니다 — 녹화와 자막에도 소리가 남지 않습니다.'
                : '실제 마이크 송출과 서버 조건을 모두 확인했습니다.'
              : starting
                ? `STARTING · ${startStatusQuery.data?.step ?? 'ACCEPTED'} — 마이크를 끄지 마세요.`
                : startFailure
                  ? '문제를 확인한 뒤 다시 시작해 주세요.'
                  : publisher.mediaFailure
                    // 장치가 막혀 있으면 기다려서 풀리지 않는다. 할 일을 그대로 옮겨 적는다.
                    ? publisher.mediaFailure.action
                    : '마이크를 켜고 서버 점검이 완료될 때까지 기다려 주세요.'}
          </small>
        </div>
        <button
          disabled={!ready || startMutation.isPending}
          className={`button button--primary${ready ? '' : ' is-disabled'}`}
          type="button"
          onClick={() => startMutation.mutate()}
        >
          {starting ? '라이브 준비 중...' : startFailure ? '다시 시작' : '라이브 시작'}
        </button>
      </div>
    </div>
  )
}
