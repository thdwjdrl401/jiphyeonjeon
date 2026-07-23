import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { publicPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import { getStudentDashboardSummary } from '@/features/curriculum/myCurriculumsService'
import ProfileAvatar from '@/features/profile/ProfileAvatar'
import ProfileEditModal from '@/features/profile/ProfileEditModal'
import { profileService } from '@/features/profile/profileService'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { InlineNotice, MetricCard, PageHeader, Panel, StatusBadge } from '@/shared/ui/WorkspaceUi'

export default function ProfilePage() {
  usePageTitle('내 프로필')
  const navigate = useNavigate()
  const { user, updateDisplayName, updateProfileImage, logout } = useAuth()
  const studentSummaryQuery = useQuery({
    queryKey: ['dashboard-summary', 'student', user?.userId],
    queryFn: () => getStudentDashboardSummary(user?.userId ?? ''),
    enabled: user?.role === 'STUDENT',
  })
  const instructorProfileQuery = useQuery({
    queryKey: ['profile', 'instructor', user?.userId],
    queryFn: profileService.getInstructorProfile,
    enabled: user?.role === 'INSTRUCTOR',
  })
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [saveNotice, setSaveNotice] = useState('')
  const [bio, setBio] = useState('')
  const [expertise, setExpertise] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [withdrawConfirmed, setWithdrawConfirmed] = useState(false)

  useEffect(() => {
    if (!instructorProfileQuery.data) return
    setBio(instructorProfileQuery.data.bio)
    setExpertise(instructorProfileQuery.data.expertise.join(', '))
  }, [instructorProfileQuery.data])

  const instructorProfileMutation = useMutation({
    mutationFn: () => profileService.updateInstructorProfile({
      bio,
      expertise: expertise.split(',').map((item) => item.trim()).filter(Boolean),
    }),
    onSuccess: (profile) => {
      setBio(profile.bio)
      setExpertise(profile.expertise.join(', '))
      setSaveNotice('강사 공개 프로필이 저장되었습니다.')
    },
  })
  const passwordMutation = useMutation({
    mutationFn: () => profileService.changePassword({ currentPassword, newPassword }),
    onSuccess: () => {
      setCurrentPassword('')
      setNewPassword('')
      setSaveNotice('비밀번호가 변경되었습니다.')
    },
  })
  const withdrawMutation = useMutation({
    mutationFn: profileService.withdrawAccount,
    onSuccess: async () => {
      await logout()
      navigate(publicPaths.home, { replace: true })
    },
  })

  const closeEdit = useCallback(() => {
    setIsEditOpen(false)
    window.requestAnimationFrame(() => editButtonRef.current?.focus())
  }, [])

  const saveBasicProfile = useCallback(async (displayName: string, file: File | null) => {
    if (displayName !== user?.displayName) await updateDisplayName(displayName)
    if (file) await updateProfileImage(file)
    setSaveNotice('기본 프로필이 변경되었습니다.')
  }, [updateDisplayName, updateProfileImage, user?.displayName])

  const saveInstructorProfile = (event: FormEvent) => {
    event.preventDefault()
    instructorProfileMutation.mutate()
  }
  const changePassword = (event: FormEvent) => {
    event.preventDefault()
    passwordMutation.mutate()
  }

  if (!user) return null

  return (
    <div className="workspace-page">
      <PageHeader eyebrow="MY PROFILE" title="내 프로필" description="계정 정보와 서비스에 표시되는 프로필을 확인하세요." />

      {saveNotice && <InlineNotice tone="success">{saveNotice}</InlineNotice>}

      <div className="profile-grid">
        <Panel title="계정 정보" description="이메일과 가입 유형은 가입 계정의 기본 정보입니다.">
          <dl className="identity-list"><div><dt>이메일</dt><dd>{user.email}</dd></div><div><dt>가입 유형</dt><dd><StatusBadge tone={user.role === 'INSTRUCTOR' ? 'warning' : 'success'}>{user.role === 'INSTRUCTOR' ? '강사' : '학생'}</StatusBadge></dd></div></dl>
        </Panel>
        <Panel
          title="기본 프로필"
          description="서비스 전반에서 표시되는 프로필입니다."
          action={<button ref={editButtonRef} className="button button--primary button--small" type="button" onClick={() => { setSaveNotice(''); setIsEditOpen(true) }}>프로필 수정</button>}
        >
          <div className="profile-summary-card">
            <ProfileAvatar displayName={user.displayName} imageUrl={user.profileImageUrl} className="user-avatar--large" />
            <div><strong>{user.displayName}</strong><span>{user.email}</span><small>닉네임과 프로필 이미지를 변경할 수 있습니다.</small></div>
          </div>
        </Panel>
      </div>

      {user.role === 'INSTRUCTOR' ? (
        <Panel title="강사 공개 프로필" description="커리큘럼 상세에서 수강생에게 공개되는 정보입니다.">
          {instructorProfileQuery.isPending ? (
            <p>강사 프로필을 불러오는 중입니다.</p>
          ) : instructorProfileQuery.isError ? (
            <InlineNotice tone="danger">강사 프로필을 불러오지 못했습니다.</InlineNotice>
          ) : (
            <form className="workspace-form" onSubmit={saveInstructorProfile}>
              <label><span>강사 소개</span><textarea rows={4} value={bio} onChange={(event) => setBio(event.target.value)} /></label>
              <label><span>전문 분야</span><input value={expertise} placeholder="Spring, JPA, 분산 시스템" onChange={(event) => setExpertise(event.target.value)} /><small>쉼표로 구분해 최대 8개까지 저장합니다.</small></label>
              {instructorProfileMutation.isError && <InlineNotice tone="danger">{instructorProfileMutation.error.message}</InlineNotice>}
              <div className="form-actions"><button className="button button--primary" type="submit" disabled={!bio.trim() || instructorProfileMutation.isPending}>{instructorProfileMutation.isPending ? '저장 중' : '공개 프로필 저장'}</button></div>
            </form>
          )}
        </Panel>
      ) : (
        <Panel title="나의 학습 요약" description="상세 진도는 내 커리큘럼에서 확인할 수 있어요.">
          {studentSummaryQuery.isError && <InlineNotice tone="danger">학습 요약을 불러오지 못했습니다.</InlineNotice>}
          <div className="metric-grid"><MetricCard label="수강 중인 커리큘럼" value={studentSummaryQuery.data?.inProgressCurriculumCount ?? '--'} /><MetricCard label="완료한 커리큘럼" value={studentSummaryQuery.data?.completedCurriculumCount ?? '--'} /><MetricCard label="평균 진행률" value={studentSummaryQuery.data ? `${studentSummaryQuery.data.averageProgress}%` : '--'} /><MetricCard label="완료한 강의" value={studentSummaryQuery.data?.completedLessonCount ?? '--'} /></div>
        </Panel>
      )}

      <Panel title="계정 보안" description="비밀번호를 변경하거나 계정 탈퇴를 진행할 수 있습니다.">
        <form className="workspace-form" onSubmit={changePassword}>
          <div className="form-grid">
            <label><span>현재 비밀번호</span><input type="password" value={currentPassword} autoComplete="current-password" onChange={(event) => setCurrentPassword(event.target.value)} /></label>
            <label><span>새 비밀번호</span><input type="password" value={newPassword} minLength={8} autoComplete="new-password" onChange={(event) => setNewPassword(event.target.value)} /></label>
          </div>
          {passwordMutation.isError && <InlineNotice tone="danger">{passwordMutation.error.message}</InlineNotice>}
          <div className="form-actions"><button className="button button--soft" type="submit" disabled={!currentPassword || newPassword.length < 8 || passwordMutation.isPending}>{passwordMutation.isPending ? '변경 중' : '비밀번호 변경'}</button></div>
        </form>
        <div className="settings-list settings-list__danger">
          <div><div><strong>회원 탈퇴</strong><p>탈퇴하면 현재 세션이 종료되고 로그인 화면으로 돌아갑니다.</p></div><label className="choice-row"><input type="checkbox" checked={withdrawConfirmed} onChange={(event) => setWithdrawConfirmed(event.target.checked)} /><span>계정 탈퇴에 동의합니다.</span></label><button className="button button--ghost" type="button" disabled={!withdrawConfirmed || withdrawMutation.isPending} onClick={() => withdrawMutation.mutate()}>{withdrawMutation.isPending ? '처리 중' : '회원 탈퇴'}</button></div>
        </div>
        {withdrawMutation.isError && <InlineNotice tone="danger">{withdrawMutation.error.message}</InlineNotice>}
      </Panel>

      {isEditOpen && (
        <ProfileEditModal user={user} onClose={closeEdit} onSave={saveBasicProfile} />
      )}
    </div>
  )
}
