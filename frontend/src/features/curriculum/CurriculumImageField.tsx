import { useRef, useState, type ChangeEvent } from 'react'

/**
 * 고른 이미지. 미리보기는 data URL로 즉시 보여 주고, 실제 업로드는 폼을 저장할 때 원본 파일로 한다 —
 * 등록만 하고 저장하지 않은 이미지가 스토리지에 남지 않도록.
 */
export interface CurriculumImageSelection {
  file: File
  previewUrl: string
}

interface CurriculumImageFieldProps {
  id: string
  /** 미리보기에 쓸 URL. 새로 고른 이미지의 data URL이거나, 이미 저장된 이미지의 서버 URL. */
  previewUrl: string | null
  onChange: (selection: CurriculumImageSelection | null) => void
  /**
   * 삭제를 지금 할 수 없는 이유. 주면 삭제 버튼을 <b>비활성으로 보여 주고</b> 이유를 붙인다.
   *
   * <p>이미 저장된 대표 이미지를 비우는 서버 계약이 아직 없다(PATCH의 thumbnailAssetId는
   * null=변경 안 함). 버튼을 아예 감추면 "삭제할 수 있나?"를 화면에서 알 수 없고, 그대로 두면
   * 눌러도 아무 일이 없는 거짓 동작이 된다 — 자리는 두고 이유를 말한다(ADR-0076).
   */
  removeDisabledReason?: string
}

const MAX_IMAGE_SIZE = 5 * 1024 * 1024

export default function CurriculumImageField({
  id,
  previewUrl,
  onChange,
  removeDisabledReason,
}: CurriculumImageFieldProps) {
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // 삭제 버튼은 이미지가 없어도 자리를 지킨다 — 등록 옆에 있어야 무엇을 할 수 있는 자리인지 읽힌다.
  const removeReason = removeDisabledReason ?? (previewUrl ? undefined : '삭제할 대표 이미지가 없습니다.')

  /**
   * 지울 때 input.value까지 비운다 — 안 비우면 브라우저가 "같은 값"으로 보고 change를 쏘지 않아
   * 방금 지운 그 파일을 다시 고를 수 없다.
   */
  const clearImage = () => {
    setError('')
    if (inputRef.current) inputRef.current.value = ''
    onChange(null)
  }

  const selectImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('JPG, PNG, WebP 이미지만 등록할 수 있습니다.')
      event.target.value = ''
      return
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setError('대표 이미지는 5MB 이하로 등록해 주세요.')
      event.target.value = ''
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      setError('')
      if (typeof reader.result === 'string') {
        onChange({ file, previewUrl: reader.result })
      } else {
        onChange(null)
      }
    }
    reader.onerror = () => setError('이미지를 읽지 못했습니다. 다시 선택해 주세요.')
    reader.readAsDataURL(file)
  }

  return (
    <div className="curriculum-image-field">
      <label className="curriculum-image-preview" htmlFor={id}>
        {previewUrl ? <img src={previewUrl} alt="대표 이미지 미리보기" /> : <div><span>IMAGE</span><strong>대표 이미지 등록</strong><small>클릭해 이미지 선택 · 16:9 권장</small></div>}
      </label>
      {/*
        등록·삭제는 눌러야 하는 것으로 보여야 한다. ghost는 배경·테두리가 모두 투명해 회색 글자만
        남아 버튼으로 읽히지 않았고, 등록은 버튼이 아예 없어 미리보기 클릭이 유일한 경로였다.
      */}
      <div className="curriculum-image-field__actions">
        <input ref={inputRef} id={id} aria-label="대표 이미지 등록" type="file" accept="image/jpeg,image/png,image/webp" onChange={selectImage} />
        <label className="button button--outline" htmlFor={id}>{previewUrl ? '이미지 변경' : '이미지 등록'}</label>
        <button
          className="button button--outline button--danger"
          type="button"
          disabled={Boolean(removeReason)}
          title={removeReason}
          onClick={clearImage}
        >이미지 삭제</button>
      </div>
      <p>JPG, PNG, WebP · 최대 5MB · 목록과 상세 카드에 사용됩니다.</p>
      {error && <small role="alert">{error}</small>}
    </div>
  )
}
