import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { instructorPaths } from '@/app/router/paths'
import { demoSession, getDemoLesson, getDemoLiveSession } from '@/features/demo/demoData'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { InlineNotice, PageHeader, Panel, StatusBadge } from '@/shared/ui/WorkspaceUi'

const steps = ['녹화 종료 요청', 'HLS 세그먼트 정리', '재생 가능성 검증', '다시보기 검수 준비']

export default function LiveSessionProcessingPage() {
  const { sessionId = demoSession.sessionId } = useParams()
  const session = getDemoLiveSession(sessionId)
  const lesson = getDemoLesson(session.lessonId)
  const [completedSteps, setCompletedSteps] = useState(3)
  const ready = completedSteps === steps.length
  usePageTitle('녹화 처리 현황')
  return <div className="workspace-page workspace-page--narrow"><PageHeader eyebrow="RECORDING PIPELINE" title="녹화 처리 현황" description={`${lesson.title}의 Egress HLS와 AI 후처리를 확인합니다.`} action={<StatusBadge tone={ready ? 'success' : 'warning'}>{ready ? 'READY' : 'VERIFYING'}</StatusBadge>} />
    <Panel title="강의 종료 요약"><dl className="summary-grid"><div><dt>강의</dt><dd>{session.sessionId}</dd></div><div><dt>라이브 상태</dt><dd>{session.status}</dd></div><div><dt>진행 시간</dt><dd>1시간 32분</dd></div><div><dt>종료 시각</dt><dd>2026.08.01 11:32</dd></div></dl></Panel>
    <Panel title="영상 처리 단계" description="라이브 종료와 녹화 자산 준비는 별도 상태로 추적합니다."><ol className="processing-steps">{steps.map((step, index) => <li className={index < completedSteps ? 'is-complete' : index === completedSteps ? 'is-current' : ''} key={step}><span>{index < completedSteps ? '✓' : index + 1}</span><div><strong>{step}</strong><small>{index < completedSteps ? '완료' : index === completedSteps ? '처리 중' : '대기'}</small></div></li>)}</ol>{!ready && <button className="button button--soft button--full" type="button" onClick={() => setCompletedSteps((current) => Math.min(current + 1, steps.length))}>최신 처리 상태 확인</button>}</Panel>
    <Panel title="AI 후처리"><div className="notice-grid"><div><StatusBadge tone="success">READY</StatusBadge><strong>교정 자막 후보</strong><p>검수할 자막 초안이 준비되었습니다.</p></div><div><StatusBadge tone="warning">PROCESSING</StatusBadge><strong>구조 요약</strong><p>학습 구간을 정리하고 있습니다.</p></div><div><StatusBadge>NOT STARTED</StatusBadge><strong>퀴즈 후보</strong><p>요약이 준비되면 생성합니다.</p></div></div></Panel>
    <InlineNotice tone={ready ? 'success' : 'info'}>{ready ? '영상이 재생 가능한 상태입니다. 수강생 공개 전 미리보기와 게시본 검수를 진행하세요.' : '처리가 지연되어도 원본 영상을 다시 업로드하지 않습니다.'}</InlineNotice>
    <div className="sticky-form-actions"><Link className="button button--ghost" to={instructorPaths.lesson(lesson.curriculumId, lesson.sectionId, lesson.lessonId)}>강의 상세</Link><Link aria-disabled={!ready} className={`button button--primary button--large${ready ? '' : ' is-disabled'}`} to={ready ? instructorPaths.replay(lesson.lessonId) : '#'}>VOD 미리보기·검수</Link></div>
  </div>
}
