import { useEffect, useRef } from 'react'
import type { AuthUser } from '@/features/auth/types'
import BasicProfileFields from './BasicProfileFields'
import { useBasicProfileDraft } from './useBasicProfileDraft'

interface ProfileEditModalProps {
  user: AuthUser
  onClose: () => void
  onSave: (displayName: string, file: File | null) => Promise<void>
}

/**
 * 강사의 닉네임·프로필 이미지 수정 모달.
 *
 * <p>강사만 이 모달을 쓴다(ADR-0011) — 강사 화면의 왼쪽 카드는 강사 공개 프로필(소개·전문 분야)이
 * 차지하고 있어 닉네임·이미지를 놓을 자리가 없다. 학생은 같은 필드를 화면 안 프로필 수정 카드에서
 * 학생과 강사 모두 프로필 정보는 먼저 읽기 전용으로 보고, 이 모달에서 기본 정보를 고친다.
 *
 * <p>상태·검증은 `useBasicProfileDraft`가, 필드는 `BasicProfileFields`가 갖는다. 이 파일은 모달
 * 크롬만 갖는다 — 배경, `role="dialog"`, Esc, 바깥 스크롤 잠금, 저장 중 닫기 차단.
 */
export default function ProfileEditModal({ user, onClose, onSave }: ProfileEditModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const draft = useBasicProfileDraft({ user, onSave, onSaved: onClose })
  const { isSaving } = draft

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSaving) onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isSaving, onClose])

  return (
    <div
      className="profile-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSaving) onClose()
      }}
    >
      <section
        className="profile-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-edit-title"
        aria-describedby="profile-edit-description"
      >
        <header className="profile-modal__header">
          <div>
            <span className="eyebrow">PROFILE</span>
            <h2 id="profile-edit-title">프로필 수정</h2>
            <p id="profile-edit-description">서비스에 표시할 닉네임과 프로필 이미지를 변경할 수 있습니다.</p>
          </div>
          <button
            ref={closeButtonRef}
            className="profile-modal__close"
            type="button"
            aria-label="프로필 수정 닫기"
            disabled={isSaving}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <form className="workspace-form" onSubmit={draft.submit}>
          <BasicProfileFields user={user} draft={draft} idPrefix="profile-modal" />

          <div className="form-actions profile-modal__actions">
            <button className="button button--ghost" type="button" disabled={isSaving} onClick={onClose}>취소</button>
            <button className="button button--primary" type="submit" disabled={!draft.isDirty || isSaving}>
              {isSaving ? '저장 중' : '변경사항 저장'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
