import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthContext'
import AccountWithdrawPanel from '@/features/profile/AccountWithdrawPanel'
import PasswordChangePanel from '@/features/profile/PasswordChangePanel'
import ProfileEditModal from '@/features/profile/ProfileEditModal'
import ProfileEditPanel from '@/features/profile/ProfileEditPanel'
import ProfileIdentityCard from '@/features/profile/ProfileIdentityCard'
import { profileService } from '@/features/profile/profileService'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { useToast } from '@/shared/ui/Toast'
import { InlineNotice, PageHeader, Panel } from '@/shared/ui/WorkspaceUi'

export default function ProfilePage() {
  usePageTitle('내 프로필')
  const { user, updateDisplayName, updateProfileImage } = useAuth()
  const isInstructor = user?.role === 'INSTRUCTOR'
  const instructorProfileQuery = useQuery({
    queryKey: ['profile', 'instructor', user?.userId],
    queryFn: profileService.getInstructorProfile,
    enabled: isInstructor,
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
      <PageHeader title="내 프로필" />

      {/*
        수정 버튼(→ 모달)은 강사에게만 준다. 학생은 왼쪽 열의 프로필 수정 카드에서 닉네임·이미지를
        바로 고치므로 같은 일을 하는 진입점이 둘이 될 이유가 없다(ADR-0011).
      */}
      <ProfileIdentityCard
        user={user}
        editButtonRef={isInstructor ? editButtonRef : undefined}
        onEdit={isInstructor ? () => setIsEditOpen(true) : undefined}
      />

      {/*
        두 역할 모두 두 열이다 — 왼쪽은 강사 공개 프로필(소개·전문 분야) 또는 학생 프로필 수정
        (닉네임·이미지), 오른쪽은 계정 설정. 어느 쪽도 빈 칸이 남지 않는다(ADR-0011).
      */}
      <div className="profile-page__columns">
        {isInstructor ? (
          <Panel title="강사 공개 프로필" description="커리큘럼 상세에서 수강생에게 공개됩니다.">
            {instructorProfileQuery.isPending ? (
              <p>강사 프로필을 불러오는 중입니다.</p>
            ) : instructorProfileQuery.isError ? (
              <InlineNotice tone="danger">강사 프로필을 불러오지 못했습니다.</InlineNotice>
            ) : (
              <form className="workspace-form" onSubmit={saveInstructorProfile}>
                <label><span>강사 소개</span><textarea rows={5} value={bio} onChange={(event) => setBio(event.target.value)} /></label>
                <label><span>전문 분야</span><input value={expertise} placeholder="Spring, JPA, 분산 시스템" onChange={(event) => setExpertise(event.target.value)} /><small>쉼표로 구분해 최대 8개까지 저장합니다.</small></label>
                <div className="form-actions"><button className="button button--primary" type="submit" disabled={!bio.trim() || instructorProfileMutation.isPending}>{instructorProfileMutation.isPending ? '저장 중' : '공개 프로필 저장'}</button></div>
              </form>
            )}
          </Panel>
        ) : (
          /*
            학생 카드는 "공개 프로필"이 아니다 — 닉네임·이미지는 강사 소개처럼 커리큘럼 상세에
            공개되는 값이 아니라 자기 계정의 표시 정보다.
          */
          <Panel title="프로필 수정" description="서비스에 표시할 닉네임과 프로필 이미지를 변경할 수 있습니다.">
            <ProfileEditPanel user={user} onSave={saveBasicProfile} />
          </Panel>
        )}

        {/*
          비밀번호 변경과 회원 탈퇴는 카드 한 장에 함께 둔다 — 둘 다 "이 계정을 어떻게 할 것인가"이고,
          가르면 카드가 늘어나 한 페이지에 담기지 않는다. 탈퇴는 진입 행만 두고 안내는 모달이 갖는다.
          카드 설명("비밀번호 변경과 회원 탈퇴")은 두지 않는다 — 안쪽 두 소제목이 같은 말을 한다.
        */}
        <Panel title="계정 설정">
          <div className="account-settings">
            <PasswordChangePanel />
            <AccountWithdrawPanel role={user.role} />
          </div>
        </Panel>
      </div>

      {isEditOpen && (
        <ProfileEditModal user={user} onClose={closeEdit} onSave={saveBasicProfile} />
      )}
    </div>
  )
}
