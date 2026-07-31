import type { AuthUser } from '@/features/auth/types'
import BasicProfileFields from './BasicProfileFields'
import { useBasicProfileDraft } from './useBasicProfileDraft'

interface ProfileEditPanelProps {
  user: AuthUser
  onSave: (displayName: string, file: File | null) => Promise<void>
}

/**
 * 학생의 프로필 수정 카드 — 닉네임·프로필 이미지를 화면에서 바로 고친다.
 *
 * <p>학생에게는 강사 공개 프로필(소개·전문 분야)이 없어 왼쪽 열이 비어 있었다(ADR-0011). 그 자리에
 * 이 카드를 두고, 상단 프로필 카드의 "프로필 수정" 버튼과 모달을 학생 화면에서 걷어냈다 — 한 페이지에
 * 다 보이는 것이 목표인 화면에서, 이미 자리가 있는 편집을 클릭 뒤로 감출 이유가 없다.
 *
 * <p><b>"공개 프로필"이라 부르지 않는다.</b> 학생의 닉네임·이미지는 강사 소개처럼 커리큘럼 상세에
 * 공개되는 값이 아니라 자기 계정의 표시 정보다.
 *
 * <p>강사는 계속 모달을 쓴다(`ProfileEditModal`). 상태·검증·필드는 두 화면이 공유한다
 * (`useBasicProfileDraft` · `BasicProfileFields`).
 */
export default function ProfileEditPanel({ user, onSave }: ProfileEditPanelProps) {
  const draft = useBasicProfileDraft({ user, onSave })

  return (
    <form className="workspace-form" aria-label="프로필 수정" onSubmit={draft.submit}>
      <BasicProfileFields user={user} draft={draft} idPrefix="profile-edit" />

      <div className="form-actions">
        <button className="button button--primary" type="submit" disabled={!draft.isDirty || draft.isSaving}>
          {draft.isSaving ? '저장 중' : '변경사항 저장'}
        </button>
      </div>
    </form>
  )
}
