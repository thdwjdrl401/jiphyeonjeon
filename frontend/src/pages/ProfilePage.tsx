import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthContext'
import { getStudentDashboardSummary } from '@/features/curriculum/myCurriculumsService'
import AccountWithdrawPanel from '@/features/profile/AccountWithdrawPanel'
import PasswordChangePanel from '@/features/profile/PasswordChangePanel'
import ProfileEditModal from '@/features/profile/ProfileEditModal'
import ProfileIdentityCard from '@/features/profile/ProfileIdentityCard'
import { profileService } from '@/features/profile/profileService'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { useToast } from '@/shared/ui/Toast'
import { InlineNotice, PageHeader, Panel } from '@/shared/ui/WorkspaceUi'

export default function ProfilePage() {
  usePageTitle('내 프로필')
  const { user, updateDisplayName, updateProfileImage } = useAuth()
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
  const toast = useToast()
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [bio, setBio] = useState('')
  const [expertise, setExpertise] = useState('')

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
      toast.success('강사 공개 프로필이 저장되었습니다.')
    },
    onError: (error) => toast.error(error.message || '공개 프로필을 저장하지 못했습니다.'),
  })

  const closeEdit = useCallback(() => {
    setIsEditOpen(false)
    window.requestAnimationFrame(() => editButtonRef.current?.focus())
  }, [])

  const saveBasicProfile = useCallback(async (displayName: string, file: File | null) => {
    if (displayName !== user?.displayName) await updateDisplayName(displayName)
    if (file) await updateProfileImage(file)
    toast.success('기본 프로필이 변경되었습니다.')
  }, [updateDisplayName, updateProfileImage, user?.displayName, toast])

  const saveInstructorProfile = (event: FormEvent) => {
    event.preventDefault()
    instructorProfileMutation.mutate()
  }

  if (!user) return null

  return (
    <div className="workspace-page profile-page">
      {/* 설명 문구를 두지 않는다 — 바로 아래 프로필 카드가 그 내용을 그대로 보여 준다. */}
      <PageHeader title="내 프로필" />

      <ProfileIdentityCard
        user={user}
        editButtonRef={editButtonRef}
        onEdit={() => setIsEditOpen(true)}
      />

      {user.role === 'INSTRUCTOR' ? (
        <Panel title="강사 공개 프로필" description="커리큘럼 상세에서 수강생에게 공개됩니다.">
          {instructorProfileQuery.isPending ? (
            <p>강사 프로필을 불러오는 중입니다.</p>
          ) : instructorProfileQuery.isError ? (
            <InlineNotice tone="danger">강사 프로필을 불러오지 못했습니다.</InlineNotice>
          ) : (
            <form className="workspace-form" onSubmit={saveInstructorProfile}>
              <label><span>강사 소개</span><textarea rows={4} value={bio} onChange={(event) => setBio(event.target.value)} /></label>
              <label><span>전문 분야</span><input value={expertise} placeholder="Spring, JPA, 분산 시스템" onChange={(event) => setExpertise(event.target.value)} /><small>쉼표로 구분해 최대 8개까지 저장합니다.</small></label>
              <div className="form-actions"><button className="button button--primary" type="submit" disabled={!bio.trim() || instructorProfileMutation.isPending}>{instructorProfileMutation.isPending ? '저장 중' : '공개 프로필 저장'}</button></div>
            </form>
          )}
        </Panel>
      ) : (
        <Panel title="나의 학습 요약" description="상세 진도는 내 커리큘럼에서 확인할 수 있어요.">
          {studentSummaryQuery.isError && <InlineNotice tone="danger">학습 요약을 불러오지 못했습니다.</InlineNotice>}
          {/*
            예전에는 MetricCard 4개(각 min-height 140px)를 썼다. 숫자 4개를 보여 주는 데 화면
            절반을 쓰고 있어서, 같은 정보를 한 줄짜리 통계 행으로 바꿨다.
          */}
          <dl className="profile-stats">
            <div><dt>수강 중인 커리큘럼</dt><dd>{studentSummaryQuery.data?.inProgressCurriculumCount ?? '--'}</dd></div>
            <div><dt>완료한 커리큘럼</dt><dd>{studentSummaryQuery.data?.completedCurriculumCount ?? '--'}</dd></div>
            <div><dt>평균 진행률</dt><dd>{studentSummaryQuery.data ? `${studentSummaryQuery.data.averageProgress}%` : '--'}</dd></div>
            <div><dt>완료한 강의</dt><dd>{studentSummaryQuery.data?.completedLessonCount ?? '--'}</dd></div>
          </dl>
        </Panel>
      )}

      {/*
        비밀번호 변경과 회원 탈퇴는 예전처럼 "계정 보안" 카드 한 장에 함께 둔다. 다만 각각을 패널
        컴포넌트로 떼어 냈다(ADR-0010) — 탈퇴는 안내 항목과 동의 절차를, 비밀번호 변경은 확인
        필드와 재설정 링크를 갖게 되어, 페이지가 두 폼의 상태를 직접 들고 있을 이유가 없어졌다.
        구분선을 두는 이유는 탈퇴 안내가 길어져 두 기능이 한 덩어리로 읽히기 때문이다.
      */}
      <Panel title="계정 보안" description="비밀번호 변경과 회원 탈퇴.">
        <PasswordChangePanel />

        <section className="settings-section">
          <h3>회원 탈퇴</h3>
          <AccountWithdrawPanel role={user.role} />
        </section>
      </Panel>

      {isEditOpen && (
        <ProfileEditModal user={user} onClose={closeEdit} onSave={saveBasicProfile} />
      )}
    </div>
  )
}
