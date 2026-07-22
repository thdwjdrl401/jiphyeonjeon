import { useState, type ChangeEvent } from 'react'

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
}

const MAX_IMAGE_SIZE = 5 * 1024 * 1024

export default function CurriculumImageField({ id, previewUrl, onChange }: CurriculumImageFieldProps) {
  const [error, setError] = useState('')

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
      <div className="curriculum-image-preview">
        {previewUrl ? <img src={previewUrl} alt="대표 이미지 미리보기" /> : <div><span>IMAGE</span><strong>대표 이미지 미리보기</strong><small>16:9 비율을 권장합니다.</small></div>}
      </div>
      <div className="curriculum-image-field__actions">
        <label className="button button--soft" htmlFor={id}>{previewUrl ? '이미지 변경' : '이미지 등록'}</label>
        <input id={id} type="file" accept="image/jpeg,image/png,image/webp" onChange={selectImage} />
        {previewUrl && <button className="button button--ghost" type="button" onClick={() => { setError(''); onChange(null) }}>삭제</button>}
      </div>
      <p>JPG, PNG, WebP · 최대 5MB · 목록과 상세 카드에 사용됩니다.</p>
      {error && <small role="alert">{error}</small>}
    </div>
  )
}
