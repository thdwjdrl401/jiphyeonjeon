import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { instructorPaths } from '@/app/router/paths'
import { demoSession, getDemoLiveSession } from '@/features/demo/demoData'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { InlineNotice, PageHeader, Panel, StatusBadge } from '@/shared/ui/WorkspaceUi'

const serverChecks = [
  ['LESSON_PUBLISHED', '레슨 게시', 'PUBLISHED'],
  ['MATERIAL_READY', 'PPTX 자료', '2개 준비'],
  ['AI_READY', 'AI 준비', 'READY'],
  ['LIVEKIT_READY', 'LiveKit', '연결 가능'],
  ['EGRESS_READY', 'Egress 녹화', '저장 경로 준비'],
  ['STT_READY', '실시간 자막', '처리 가능'],
]

export default function InstructorPreflightPage() {
  const { sessionId = demoSession.sessionId } = useParams()
  const session = getDemoLiveSession(sessionId)
  const [devices, setDevices] = useState({ camera: false, microphone: false, network: false })
  const [checked, setChecked] = useState(false)
  const ready = Object.values(devices).every(Boolean) && checked
  usePageTitle('강사 사전 점검')
  const toggle = (key: keyof typeof devices) => setDevices((current) => ({ ...current, [key]: !current[key] }))
  return <div className="workspace-page"><PageHeader eyebrow="INSTRUCTOR PREFLIGHT" title="라이브 시작 전 최종 점검" description={`${session.lessonTitle} · 모든 필수 조건을 통과해야 강의를 시작할 수 있습니다.`} action={<StatusBadge tone={ready ? 'success' : 'warning'}>{ready ? '시작 가능' : '점검 필요'}</StatusBadge>} />
    <div className="preflight-grid"><Panel title="카메라 미리보기" description="실제 장치 연결 전 UI 동작을 확인하는 초기 화면입니다."><div className="camera-preview"><div className="camera-avatar">이</div><span>{devices.camera ? '카메라 미리보기 준비됨' : '카메라가 꺼져 있습니다'}</span></div><div className="media-control-row"><button className={`media-toggle${devices.camera ? ' is-on' : ''}`} type="button" onClick={() => toggle('camera')}>카메라 {devices.camera ? '켜짐' : '켜기'}</button><button className={`media-toggle${devices.microphone ? ' is-on' : ''}`} type="button" onClick={() => toggle('microphone')}>마이크 {devices.microphone ? '켜짐' : '켜기'}</button><button className={`media-toggle${devices.network ? ' is-on' : ''}`} type="button" onClick={() => toggle('network')}>네트워크 {devices.network ? '양호' : '측정'}</button></div></Panel>
      <Panel title="서버 시작 조건" description="결과는 짧은 유효 시간을 가지며 시작 요청에서 다시 검증됩니다."><ul className="readiness-list">{serverChecks.map(([code, label, value]) => <li key={code}><span>{label}<small>{code}</small></span><StatusBadge tone="success">✓ {value}</StatusBadge></li>)}</ul><button className="button button--soft button--full" type="button" onClick={() => setChecked(true)}>{checked ? '서버 점검 완료' : '최신 상태 점검'}</button></Panel></div>
    <InlineNotice tone={ready ? 'success' : 'warning'}>{ready ? '모든 필수 항목이 준비되었습니다. 시작 요청 후 STARTING 상태를 거쳐 강의실로 이동합니다.' : '카메라·마이크·네트워크와 서버 상태를 모두 확인해 주세요.'}</InlineNotice>
    <div className="sticky-form-actions"><Link className="button button--ghost" to={instructorPaths.liveSession(sessionId)}>강의 상세</Link><Link aria-disabled={!ready} className={`button button--primary button--large${ready ? '' : ' is-disabled'}`} to={ready ? instructorPaths.classroom(sessionId) : '#'}>라이브 시작</Link></div>
  </div>
}
