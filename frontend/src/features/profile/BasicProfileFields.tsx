import type { AuthUser } from '@/features/auth/types'
import ProfileAvatar from './ProfileAvatar'
import type { BasicProfileDraft } from './useBasicProfileDraft'

interface BasicProfileFieldsProps {
  user: AuthUser
  draft: BasicProfileDraft
  /**
   * `id` 충돌을 막는 접두사. 같은 화면에 이 필드가 두 벌 뜨는 경우는 없지만, id를 고정하면
   * 나중에 한 화면에 둘이 놓이는 순간 `htmlFor`가 엉뚱한 입력을 가리킨다.
   */
  idPrefix: string
}

/**
 * 닉네임·프로필 이미지 입력 필드. 상태는 {@link BasicProfileDraft}가 갖고 이 컴포넌트는 그리기만
 * 한다 — 학생의 프로필 수정 카드와 강사의 프로필 수정 모달이 같은 필드를 쓴다(ADR-0011).
 */
export default function BasicProfileFields({ user, draft, idPrefix }: BasicProfileFieldsProps) {
  const imageInputId = `${idPrefix}-profile-image-input`
  const labelId = `${idPrefix}-display-name-label`
  const helpId = `${idPrefix}-display-name-help`

  return (
    <>
      <div className="profile-image-editor">
        <ProfileAvatar displayName={user.displayName} imageUrl={draft.previewUrl} className="user-avatar--large" />
        <div>
          <strong>프로필 이미지</strong>
          <p>JPG, PNG, WEBP · 최대 5MB</p>
          <label className="button button--soft button--small" htmlFor={imageInputId}>이미지 선택</label>
          <input
            id={imageInputId}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label="프로필 이미지 선택"
            disabled={draft.isSaving}
            onChange={draft.selectImage}
          />
          {draft.selectedFile && <small>{draft.selectedFile.name}</small>}
        </div>
      </div>

      <label>
        {/*
          감싸는 label이 도움말 `small`까지 품는 구조라, 그대로 두면 접근성 이름이
          "닉네임 1자 이상 100자 이하로…"가 된다. 이름은 라벨 텍스트로 고정하고 도움말은
          aria-describedby로만 연결한다(ADR-0010에서 비밀번호 필드에 세운 규칙과 같다).
        */}
        <span id={labelId}>닉네임</span>
        <input
          value={draft.displayName}
          maxLength={100}
          aria-labelledby={labelId}
          aria-describedby={helpId}
          disabled={draft.isSaving}
          onChange={(event) => draft.setDisplayName(event.target.value)}
        />
        <small id={helpId}>1자 이상 100자 이하로 입력해 주세요.</small>
      </label>

      {draft.error && <p className="profile-modal__error" role="alert">{draft.error}</p>}
    </>
  )
}
