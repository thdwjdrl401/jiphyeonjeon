import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '@/features/auth/AuthContext'
import { getDemoStudentLearningSummary } from '@/features/demo/demoData'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { InlineNotice, MetricCard, PageHeader, Panel, StatusBadge } from '@/shared/ui/WorkspaceUi'

export default function ProfilePage() {
  usePageTitle('내 프로필')
  const { user } = useAuth()
  const studentSummary = getDemoStudentLearningSummary(user?.userId ?? '')
  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [bio, setBio] = useState('복잡한 백엔드 개념을 실제 요청 흐름으로 쉽게 설명합니다.')
  const [expertise, setExpertise] = useState('Spring, JPA, 분산 시스템')
  const [savedArea, setSavedArea] = useState<'account' | 'instructor' | null>(null)

  useEffect(() => setDisplayName(user?.displayName ?? ''), [user?.displayName])

  const save = (event: FormEvent, area: 'account' | 'instructor') => {
    event.preventDefault()
    setSavedArea(area)
  }

  return (
    <div className="workspace-page">
      <PageHeader eyebrow="MY PROFILE" title="내 프로필" description="계정 정보와 서비스에 표시되는 프로필을 관리하세요." />

      <div className="profile-grid">
        <Panel title="계정 정보" description="이메일과 가입 유형은 현재 변경할 수 없습니다.">
          <dl className="identity-list"><div><dt>이메일</dt><dd>{user?.email}</dd></div><div><dt>가입 유형</dt><dd><StatusBadge tone={user?.role === 'INSTRUCTOR' ? 'warning' : 'success'}>{user?.role === 'INSTRUCTOR' ? '강사' : '학생'}</StatusBadge></dd></div></dl>
        </Panel>
        <Panel title="기본 프로필" description="서비스 전반에서 사용할 표시 이름입니다.">
          <form className="workspace-form" onSubmit={(event) => save(event, 'account')}>
            <label><span>표시 이름</span><input value={displayName} maxLength={100} onChange={(event) => { setDisplayName(event.target.value); setSavedArea(null) }} /></label>
            {savedArea === 'account' && <InlineNotice tone="success">기본 프로필 초안이 저장되었습니다.</InlineNotice>}
            <div className="form-actions"><button className="button button--primary" disabled={!displayName.trim()} type="submit">변경 저장</button></div>
          </form>
        </Panel>
      </div>

      {user?.role === 'INSTRUCTOR' ? (
        <Panel title="강사 공개 프로필" description="커리큘럼 상세에서 수강생에게 공개되는 정보입니다.">
          <form className="workspace-form" onSubmit={(event) => save(event, 'instructor')}>
            <label><span>소개</span><textarea rows={4} value={bio} onChange={(event) => { setBio(event.target.value); setSavedArea(null) }} /></label>
            <label><span>전문 분야</span><input value={expertise} onChange={(event) => { setExpertise(event.target.value); setSavedArea(null) }} /><small>쉼표로 구분해 주세요.</small></label>
            <div className="profile-preview"><span className="user-avatar">{displayName.slice(0, 1)}</span><div><strong>{displayName}</strong><p>{bio}</p><small>{expertise}</small></div></div>
            {savedArea === 'instructor' && <InlineNotice tone="success">공개 프로필 초안이 저장되었습니다.</InlineNotice>}
            <div className="form-actions"><button className="button button--primary" type="submit">공개 프로필 저장</button></div>
          </form>
        </Panel>
      ) : (
        <Panel title="나의 학습 요약" description="상세 진도는 내 커리큘럼에서 확인할 수 있어요.">
          <div className="metric-grid"><MetricCard label="수강 중인 커리큘럼" value={studentSummary.inProgressCurriculumCount} /><MetricCard label="완료한 커리큘럼" value={studentSummary.completedCurriculumCount} /><MetricCard label="평균 진행률" value={`${studentSummary.averageProgress}%`} /><MetricCard label="완료한 레슨" value={studentSummary.completedLessonCount} /></div>
        </Panel>
      )}

      <Panel title="계정 보안" description="비밀번호 변경과 계정 탈퇴 정책은 서버 계약 확정 후 활성화됩니다.">
        <div className="settings-list"><div><div><strong>비밀번호</strong><p>별도 보안 폼과 다른 세션 종료 정책을 준비하고 있습니다.</p></div><button className="button button--ghost" type="button" disabled>변경 준비 중</button></div><div className="settings-list__danger"><div><strong>회원 탈퇴</strong><p>운영·학습 데이터 보존 정책이 확정되기 전에는 실행할 수 없습니다.</p></div><button className="button button--ghost" type="button" disabled>정책 준비 중</button></div></div>
      </Panel>
    </div>
  )
}
