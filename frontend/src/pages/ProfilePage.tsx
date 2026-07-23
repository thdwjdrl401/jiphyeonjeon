import { useCallback, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthContext'
import { getStudentDashboardSummary } from '@/features/curriculum/myCurriculumsService'
import ProfileAvatar from '@/features/profile/ProfileAvatar'
import ProfileEditModal from '@/features/profile/ProfileEditModal'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { InlineNotice, MetricCard, PageHeader, Panel, StatusBadge } from '@/shared/ui/WorkspaceUi'

export default function ProfilePage() {
  usePageTitle('내 프로필')
  const { user, updateProfileImage } = useAuth()
  const studentSummaryQuery = useQuery({
    queryKey: ['dashboard-summary', 'student', user?.userId],
    queryFn: () => getStudentDashboardSummary(user?.userId ?? ''),
    enabled: user?.role === 'STUDENT',
  })
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [saveNotice, setSaveNotice] = useState('')

  const closeEdit = useCallback(() => {
    setIsEditOpen(false)
    window.requestAnimationFrame(() => editButtonRef.current?.focus())
  }, [])
  const saveProfileImage = useCallback(async (file: File) => {
    await updateProfileImage(file)
    setSaveNotice('프로필 이미지가 변경되었습니다.')
  }, [updateProfileImage])

  if (!user) return null

  return (
    <div className="workspace-page">
      <PageHeader eyebrow="MY PROFILE" title="내 프로필" description="계정 정보와 서비스에 표시되는 프로필을 확인하세요." />

      {saveNotice && <InlineNotice tone="success">{saveNotice}</InlineNotice>}

      <div className="profile-grid">
        <Panel title="계정 정보" description="이메일과 가입 유형은 현재 변경할 수 없습니다.">
          <dl className="identity-list"><div><dt>이메일</dt><dd>{user.email}</dd></div><div><dt>가입 유형</dt><dd><StatusBadge tone={user.role === 'INSTRUCTOR' ? 'warning' : 'success'}>{user.role === 'INSTRUCTOR' ? '강사' : '학생'}</StatusBadge></dd></div></dl>
        </Panel>
        <Panel
          title="기본 프로필"
          description="서비스 전반에서 표시되는 프로필입니다."
          action={<button ref={editButtonRef} className="button button--primary button--small" type="button" onClick={() => { setSaveNotice(''); setIsEditOpen(true) }}>프로필 수정</button>}
        >
          <div className="profile-summary-card">
            <ProfileAvatar displayName={user.displayName} imageUrl={user.profileImageUrl} className="user-avatar--large" />
            <div><strong>{user.displayName}</strong><span>{user.email}</span><small>닉네임 변경 기능은 준비 중입니다.</small></div>
          </div>
        </Panel>
      </div>

      {user.role === 'INSTRUCTOR' ? (
        <Panel
          title="강사 공개 프로필"
          description="커리큘럼 상세에서 수강생에게 공개되는 정보입니다."
          action={<StatusBadge tone="warning">편집 준비 중</StatusBadge>}
        >
          <InlineNotice tone="warning">강사 소개와 전문 분야 편집은 서버 API가 준비된 뒤 제공됩니다.</InlineNotice>
        </Panel>
      ) : (
        <Panel title="나의 학습 요약" description="상세 진도는 내 커리큘럼에서 확인할 수 있어요.">
          {studentSummaryQuery.isError && <InlineNotice tone="danger">학습 요약을 불러오지 못했습니다.</InlineNotice>}
          <div className="metric-grid"><MetricCard label="수강 중인 커리큘럼" value={studentSummaryQuery.data?.inProgressCurriculumCount ?? '--'} /><MetricCard label="완료한 커리큘럼" value={studentSummaryQuery.data?.completedCurriculumCount ?? '--'} /><MetricCard label="평균 진행률" value={studentSummaryQuery.data ? `${studentSummaryQuery.data.averageProgress}%` : '--'} /><MetricCard label="완료한 강의" value={studentSummaryQuery.data?.completedLessonCount ?? '--'} /></div>
        </Panel>
      )}

      <Panel title="계정 보안" description="비밀번호 변경과 계정 탈퇴 정책은 서버 계약 확정 후 활성화됩니다.">
        <div className="settings-list"><div><div><strong>비밀번호</strong><p>별도 보안 폼과 다른 세션 종료 정책을 준비하고 있습니다.</p></div><button className="button button--ghost" type="button" disabled>변경 준비 중</button></div><div className="settings-list__danger"><div><strong>회원 탈퇴</strong><p>운영·학습 데이터 보존 정책이 확정되기 전에는 실행할 수 없습니다.</p></div><button className="button button--ghost" type="button" disabled>정책 준비 중</button></div></div>
      </Panel>

      {isEditOpen && (
        <ProfileEditModal
          user={user}
          onClose={closeEdit}
          onSaveImage={saveProfileImage}
        />
      )}
    </div>
  )
}
