import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthContext'
import { demoLesson, demoSession } from '@/features/demo/demoData'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { InlineNotice, PageHeader, Panel, StatusBadge } from '@/shared/ui/WorkspaceUi'

export default function StudentPrejoinPage() {
  const { sessionId = demoSession.sessionId } = useParams()
  const { user } = useAuth()
  const [checks, setChecks] = useState({ speaker: false, autoplay: false, network: false, consent: false })
  const ready = Object.values(checks).every(Boolean)
  usePageTitle('입장 전 점검')
  const toggle = (key: keyof typeof checks) => setChecks((current) => ({ ...current, [key]: !current[key] }))
  return <div className="workspace-page workspace-page--narrow"><PageHeader eyebrow="PREJOIN CHECK" title="입장 전 점검" description={`${demoLesson.title} · 수강생은 카메라와 마이크 권한을 요청하지 않습니다.`} action={<StatusBadge tone="live">OPEN</StatusBadge>} />
    <Panel title="재생 환경 확인" description="각 항목을 직접 확인한 뒤 입장해 주세요."><div className="precheck-list"><button className={checks.speaker ? 'is-pass' : ''} type="button" onClick={() => toggle('speaker')}><span>{checks.speaker ? '✓' : '1'}</span><div><strong>스피커 테스트</strong><small>테스트 소리가 선명하게 들립니다.</small></div><b>{checks.speaker ? '완료' : '테스트'}</b></button><button className={checks.autoplay ? 'is-pass' : ''} type="button" onClick={() => toggle('autoplay')}><span>{checks.autoplay ? '✓' : '2'}</span><div><strong>자동 재생 확인</strong><small>브라우저에서 영상과 음성 재생을 허용합니다.</small></div><b>{checks.autoplay ? '완료' : '확인'}</b></button><button className={checks.network ? 'is-pass' : ''} type="button" onClick={() => toggle('network')}><span>{checks.network ? '✓' : '3'}</span><div><strong>네트워크 상태</strong><small>현재 연결은 라이브 수신에 안정적입니다.</small></div><b>{checks.network ? '양호' : '측정'}</b></button></div></Panel>
    <Panel title="표시 이름과 녹화 고지"><dl className="identity-list"><div><dt>표시 이름</dt><dd>{user?.displayName}</dd></div><div><dt>미디어 권한</dt><dd>수신 전용</dd></div></dl><label className="choice-row"><input type="checkbox" checked={checks.consent} onChange={() => toggle('consent')} /><span><strong>녹화·자막·채팅·AI 사용 안내를 확인했습니다.</strong><small>개인 AI 질문 기록은 본인에게만 표시되고 익명 통계에 반영될 수 있습니다.</small></span></label></Panel>
    {!ready && <InlineNotice tone="warning">모든 필수 점검과 고지를 확인해야 입장할 수 있습니다.</InlineNotice>}
    <div className="sticky-form-actions"><Link className="button button--ghost" to={`/live-sessions/${sessionId}`}>세션 상세</Link>{ready ? <Link className="button button--primary button--large" state={{ prejoinSessionId: sessionId }} to={`/live-sessions/${sessionId}/classroom`}>라이브 입장</Link> : <button className="button button--primary button--large is-disabled" type="button" disabled>라이브 입장</button>}</div>
  </div>
}
