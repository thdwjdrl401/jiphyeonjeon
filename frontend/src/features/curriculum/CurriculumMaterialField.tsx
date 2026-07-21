import { useState, type ChangeEvent } from 'react'
import type { CurriculumMaterial } from './types'

interface CurriculumMaterialFieldProps {
  id: string
  value: CurriculumMaterial[]
  onChange: (value: CurriculumMaterial[]) => void
}

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

function formatFileSize(fileSize: number) {
  if (fileSize < 1024 * 1024) return `${Math.max(1, Math.round(fileSize / 1024))} KB`
  return `${(fileSize / 1024 / 1024).toFixed(1)} MB`
}

export default function CurriculumMaterialField({ id, value, onChange }: CurriculumMaterialFieldProps) {
  const [error, setError] = useState('')

  const selectFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    const invalidFile = files.find((file) => file.type !== PPTX_MIME && !file.name.toLowerCase().endsWith('.pptx'))
    if (invalidFile) {
      setError('PPTX 파일만 등록할 수 있습니다.')
      event.target.value = ''
      return
    }

    const selected = files.map((file, index) => ({
      materialId: `curriculum-material-${file.lastModified}-${file.size}-${index}`,
      fileName: file.name,
      fileSize: file.size,
    }))
    const next = [...value]
    for (const material of selected) {
      const duplicate = next.some((item) => item.fileName === material.fileName && item.fileSize === material.fileSize)
      if (!duplicate) next.push(material)
    }
    setError('')
    onChange(next)
    event.target.value = ''
  }

  return (
    <div className="curriculum-material-field">
      <label className="material-dropzone" htmlFor={id}>
        <input
          id={id}
          aria-label="커리큘럼 강의 자료 등록"
          type="file"
          accept={`.pptx,${PPTX_MIME}`}
          multiple
          onChange={selectFiles}
        />
        <span className="material-dropzone__icon">P</span>
        <strong>PPTX 파일 선택</strong>
        <small>여러 파일을 등록할 수 있으며 등록하지 않아도 저장할 수 있습니다.</small>
      </label>
      {value.length > 0 && (
        <ul className="material-list">
          {value.map((material) => (
            <li key={material.materialId}>
              <span className="file-icon">PPTX</span>
              <div><strong>{material.fileName}</strong><small>{formatFileSize(material.fileSize)}</small></div>
              <button
                type="button"
                aria-label={`${material.fileName} 제거`}
                onClick={() => onChange(value.filter((item) => item.materialId !== material.materialId))}
              >×</button>
            </li>
          ))}
        </ul>
      )}
      {error && <small role="alert">{error}</small>}
    </div>
  )
}
