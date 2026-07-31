import { useState, type ChangeEvent, type FormEvent } from 'react'
import type { AuthUser } from '@/features/auth/types'
import { getProfileImageValidationError } from './profileService'

const MAX_DISPLAY_NAME_LENGTH = 100

interface UseBasicProfileDraftOptions {
  user: AuthUser
  onSave: (displayName: string, file: File | null) => Promise<void>
  /** 저장에 성공한 뒤 부른다. 모달은 닫고, 인라인 카드는 그대로 머문다(넘길 것이 없다). */
  onSaved?: () => void
}

export interface BasicProfileDraft {
  displayName: string
  setDisplayName: (value: string) => void
  /** 선택한 파일의 data URL. 아직 고르지 않았으면 저장된 이미지 URL. */
  previewUrl: string | null
  selectedFile: File | null
  error: string
  isSaving: boolean
  /** 바뀐 것이 없으면 저장할 것도 없다. */
  isDirty: boolean
  selectImage: (event: ChangeEvent<HTMLInputElement>) => void
  submit: (event: FormEvent) => void
}

/**
 * 닉네임·프로필 이미지 편집의 상태와 검증.
 *
 * <p>학생은 이 편집을 <b>화면 안 카드</b>에서 하고(프로필 수정 카드), 강사는 <b>모달</b>에서 한다
 * (ADR-0011) — 강사 화면의 왼쪽 카드는 이미 강사 공개 프로필(소개·전문 분야)이 쓰고 있어서 닉네임·
 * 이미지를 놓을 자리가 없다. 두 화면이 검증과 미리보기 로직을 각자 들고 있으면 한쪽만 고쳐질 수
 * 있으므로, 상태는 이 훅이 갖고 겉모습(모달 크롬 / 카드)만 각자 갖는다.
 *
 * <p>미리보기를 `FileReader`로 만드는 이유: 업로드는 저장을 눌러야 일어나므로 그전까지 서버에는
 * 이 이미지가 없다. 사용자가 고른 파일이 맞는지 눌러 보기 전에 확인할 방법이 이것뿐이다.
 */
export function useBasicProfileDraft({ user, onSave, onSaved }: UseBasicProfileDraftOptions): BasicProfileDraft {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(user.profileImageUrl)
  const [displayName, setDisplayName] = useState(user.displayName)
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const isDirty = Boolean(selectedFile) || displayName.trim() !== user.displayName

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

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const trimmedDisplayName = displayName.trim()
    if (!isDirty || isSaving) return
    if (!trimmedDisplayName || trimmedDisplayName.length > MAX_DISPLAY_NAME_LENGTH) {
      setError(`닉네임은 1자 이상 ${MAX_DISPLAY_NAME_LENGTH}자 이하로 입력해 주세요.`)
      return
    }

    setIsSaving(true)
    setError('')
    try {
      await onSave(trimmedDisplayName, selectedFile)
      // 저장이 끝나면 고른 파일을 비운다 — 남겨 두면 같은 이미지를 다시 올릴 수 있는 상태로 보인다.
      setSelectedFile(null)
      onSaved?.()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '프로필 이미지를 변경하지 못했습니다.')
    } finally {
      setIsSaving(false)
    }
  }

  return {
    displayName,
    setDisplayName,
    previewUrl,
    selectedFile,
    error,
    isSaving,
    isDirty,
    selectImage,
    submit,
  }
}
