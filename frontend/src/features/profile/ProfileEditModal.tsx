import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import type { AuthUser } from '@/features/auth/types'
import { getProfileImageValidationError } from './profileService'
import ProfileAvatar from './ProfileAvatar'

interface ProfileEditModalProps {
  user: AuthUser
  onClose: () => void
  onSaveImage: (file: File) => Promise<void>
}

export default function ProfileEditModal({ user, onClose, onSaveImage }: ProfileEditModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(user.profileImageUrl)
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

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

  const selectImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const validationError = getProfileImageValidationError(file)
    if (validationError) {
      setSelectedFile(null)
      setError(validationError)
      event.target.value = ''
      return
    }

    setSelectedFile(file)
    setError('')
    const reader = new FileReader()
    reader.addEventListener('load', () => setPreviewUrl(String(reader.result)))
    reader.addEventListener('error', () => setError('이미지 미리보기를 만들지 못했습니다.'))
    reader.readAsDataURL(file)
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedFile || isSaving) return

    setIsSaving(true)
    setError('')
    try {
      await onSaveImage(selectedFile)
      onClose()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '프로필 이미지를 변경하지 못했습니다.')
    } finally {
      setIsSaving(false)
    }
  }

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
            <p id="profile-edit-description">서비스에 표시할 프로필 이미지를 변경할 수 있습니다.</p>
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

        <form className="workspace-form" onSubmit={save}>
          <div className="profile-image-editor">
            <ProfileAvatar displayName={user.displayName} imageUrl={previewUrl} className="user-avatar--large" />
            <div>
              <strong>프로필 이미지</strong>
              <p>JPG, PNG, WEBP · 최대 5MB</p>
              <label className="button button--soft button--small" htmlFor="profile-image-input">이미지 선택</label>
              <input
                id="profile-image-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label="프로필 이미지 선택"
                disabled={isSaving}
                onChange={selectImage}
              />
              {selectedFile && <small>{selectedFile.name}</small>}
            </div>
          </div>

          <label>
            <span>닉네임</span>
            <input value={user.displayName} readOnly aria-describedby="display-name-help" />
            <small id="display-name-help">닉네임 변경 기능은 준비 중입니다.</small>
          </label>

          {error && <p className="profile-modal__error" role="alert">{error}</p>}

          <div className="form-actions profile-modal__actions">
            <button className="button button--ghost" type="button" disabled={isSaving} onClick={onClose}>취소</button>
            <button className="button button--primary" type="submit" disabled={!selectedFile || isSaving}>
              {isSaving ? '저장 중' : '변경사항 저장'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
