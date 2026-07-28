import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { instructorPaths } from '@/app/router/paths'
import { getLiveSession, getPreflightChecks, startLiveSession } from '@/features/live-session/liveSessionService'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import PageState from '@/shared/ui/PageState'
import { useToast } from '@/shared/ui/Toast'
import { InlineNotice, PageHeader, Panel, StatusBadge } from '@/shared/ui/WorkspaceUi'

export default function InstructorPreflightPage() {
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const sessionQuery = useQuery({ queryKey: ['live-session', sessionId], queryFn: () => getLiveSession(sessionId), enabled: Boolean(sessionId) })
  const checksQuery = useQuery({ queryKey: ['live-session-preflight', sessionId], queryFn: () => getPreflightChecks(sessionId), enabled: false })
  const startMutation = useMutation({
    mutationFn: () => startLiveSession(sessionId),
    onSuccess: () => navigate(instructorPaths.classroom(sessionId)),
    // 시작 실패는 한 번 읽고 지나가는 알림 — 점검 상태 안내(위 InlineNotice)와 섞지 않는다.
    onError: () => toast.error('라이브 시작 요청에 실패했습니다. 점검 상태를 다시 확인해 주세요.'),
  })
  const session = sessionQuery.data
  const [devices, setDevices] = useState({ camera: false, microphone: false, network: false })
  const checked = checksQuery.isSuccess && checksQuery.data.every((check) => check.ready)
  const ready = Object.values(devices).every(Boolean) && checked
  usePageTitle('강사 사전 점검')
  const toggle = (key: keyof typeof devices) => setDevices((current) => ({ ...current, [key]: !current[key] }))
  if (!sessionId) return <PageState title="잘못된 라이브 세션 경로입니다" />
  if (sessionQuery.isPending) return <PageState title="라이브 세션을 불러오는 중입니다" />
  if (sessionQuery.isError || !session) return <PageState title="라이브 세션을 불러오지 못했습니다" />
  return <div className="workspace-page"><PageHeader title="라이브 시작 전 최종 점검" description={`${session.lessonTitle} · 모든 필수 조건을 통과해야 강의를 시작할 수 있습니다.`} action={<StatusBadge tone={ready ? 'success' : 'warning'}>{ready ? '시작 가능' : '점검 필요'}</StatusBadge>} />
    <div className="preflight-grid"><Panel title="카메라 미리보기" description="실제 장치 연결 전 UI 동작을 확인하는 초기 화면입니다."><div className="camera-preview"><div className="camera-avatar">이</div><span>{devices.camera ? '카메라 미리보기 준비됨' : '카메라가 꺼져 있습니다'}</span></div><div className="media-control-row"><button className={`media-toggle${devices.camera ? ' is-on' : ''}`} type="button" onClick={() => toggle('camera')}>카메라 {devices.camera ? '켜짐' : '켜기'}</button><button className={`media-toggle${devices.microphone ? ' is-on' : ''}`} type="button" onClick={() => toggle('microphone')}>마이크 {devices.microphone ? '켜짐' : '켜기'}</button><button className={`media-toggle${devices.network ? ' is-on' : ''}`} type="button" onClick={() => toggle('network')}>네트워크 {devices.network ? '양호' : '측정'}</button></div></Panel>
      <Panel title="서버 시작 조건" description="결과는 짧은 유효 시간을 가지며 시작 요청에서 다시 검증됩니다."><ul className="readiness-list">{(checksQuery.data ?? []).map((check) => <li key={check.code}><span>{check.label}<small>{check.code}</small></span><StatusBadge tone={check.ready ? 'success' : 'warning'}>{check.value}</StatusBadge></li>)}</ul><button className="button button--soft button--full" type="button" disabled={checksQuery.isFetching} onClick={() => checksQuery.refetch()}>{checked ? '서버 점검 완료' : checksQuery.isFetching ? '점검 중...' : '최신 상태 점검'}</button></Panel></div>
    <InlineNotice tone={ready ? 'success' : 'warning'}>{ready ? '모든 필수 항목이 준비되었습니다. 시작 요청 후 STARTING 상태를 거쳐 강의실로 이동합니다.' : '카메라·마이크·네트워크와 서버 상태를 모두 확인해 주세요.'}</InlineNotice>
    <div className="sticky-form-actions"><button disabled={!ready || startMutation.isPending} className={`button button--primary button--large${ready ? '' : ' is-disabled'}`} type="button" onClick={() => startMutation.mutate()}>라이브 시작</button></div>
  </div>
}
