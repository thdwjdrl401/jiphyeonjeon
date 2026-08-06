import { useRef, useState, type ChangeEvent } from 'react'
import CurriculumImageCropDialog from './CurriculumImageCropDialog'

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
  /*
    고른 파일은 곧바로 등록되지 않는다 — 16:9로 어디를 보여줄지 정하는 단계를 거친다. 원본과
    읽어 둔 data URL을 함께 들고 있는 이유는, 자르기 화면에서 파일을 다시 읽지 않게 하려는 것이다.
  */
  const [pending, setPending] = useState<{ file: File; sourceUrl: string } | null>(null)
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
        setPending({ file, sourceUrl: reader.result })
      } else {
        onChange(null)
      }
    }
    reader.onerror = () => setError('이미지를 읽지 못했습니다. 다시 선택해 주세요.')
    reader.readAsDataURL(file)
  }

  /**
   * 자르기를 마쳤다. <b>잘린 파일</b>을 등록하고 미리보기도 그것으로 바꾼다 — 미리보기에 원본을
   * 남기면 화면에서 본 범위와 저장되는 범위가 달라진다.
   */
  const confirmCrop = (cropped: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      setPending(null)
      if (typeof reader.result === 'string') {
        onChange({ file: cropped, previewUrl: reader.result })
      } else {
        setError('자른 이미지를 읽지 못했습니다. 다시 선택해 주세요.')
      }
    }
    reader.onerror = () => {
      setPending(null)
      setError('자른 이미지를 읽지 못했습니다. 다시 선택해 주세요.')
    }
    reader.readAsDataURL(cropped)
  }

  /** 자르기를 그만뒀다. 고른 파일도 버린다 — 자르지 않은 원본이 등록되면 범위를 정한 뜻이 없다. */
  const cancelCrop = () => {
    setPending(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="curriculum-image-field">
      {/*
        등록·변경은 <b>이 미리보기 한 곳</b>에서 한다. 예전에는 옆에 `이미지 등록` 버튼을 따로 두었는데,
        이 자리가 이미 같은 파일 선택을 열어서 같은 일을 하는 두 곳이 나란히 있었다.

        <p>대신 사진이 들어찬 뒤에도 "여기를 눌러 바꾼다"가 남아야 한다 — 미리보기가 사진으로 덮이면
        빈 상태의 안내 문구가 사라지므로, 그 자리에 겹쳐서 알린다.
      */}
      <label className="curriculum-image-preview" htmlFor={id}>
        {previewUrl
          ? (
            <>
              <img src={previewUrl} alt="대표 이미지 미리보기" />
              <span className="curriculum-image-preview__change">클릭해 이미지 변경</span>
            </>
          )
          : <div><span>IMAGE</span><strong>대표 이미지 등록</strong><small>클릭해 이미지 선택 · 16:9 권장</small></div>}
      </label>
      <div className="curriculum-image-field__actions">
        <input ref={inputRef} id={id} aria-label="대표 이미지 등록" type="file" accept="image/jpeg,image/png,image/webp" onChange={selectImage} />
        <button
          className="button button--outline button--danger"
          type="button"
          disabled={Boolean(removeReason)}
          title={removeReason}
          onClick={clearImage}
        >이미지 삭제</button>
      </div>
      <p>JPG, PNG, WebP · 최대 5MB · 고른 뒤 16:9로 보여줄 범위를 정합니다.</p>
      {error && <small role="alert">{error}</small>}

      {pending && (
        <CurriculumImageCropDialog
          file={pending.file}
          sourceUrl={pending.sourceUrl}
          onConfirm={confirmCrop}
          onCancel={cancelCrop}
        />
      )}
    </div>
  )
}
