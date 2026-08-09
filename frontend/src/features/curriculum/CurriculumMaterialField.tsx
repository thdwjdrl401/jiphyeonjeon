import { useState, type ChangeEvent, type DragEvent } from 'react'
import type { MaterialDownloadRequest } from '@/features/material/materialDownloadService'
import MaterialStatusBadges from '@/features/material/MaterialStatusBadges'
import { useMaterialDownload } from '@/features/material/useMaterialDownload'
import type { CurriculumMaterial } from './types'

interface CurriculumMaterialFieldProps {
  id: string
  value: CurriculumMaterial[]
  onChange: (value: CurriculumMaterial[]) => void
  /**
   * 이미 저장된(persisted) 자료의 다운로드 요청 정보. 주면 파일이 없는 자료에 다운로드 버튼을 붙인다(관리 화면).
   *
   * 링크가 아니라 버튼이다 — 객체 키가 `material/{UUID}`라(AssetService) presigned URL을 그대로 열면
   * 확장자도 없는 UUID로 저장된다. 바이트를 받아 원래 파일명을 붙인다(ADR-0082).
   */
  downloadRequest?: (material: CurriculumMaterial) => MaterialDownloadRequest
}

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

function formatFileSize(fileSize: number) {
  if (fileSize < 1024 * 1024) return `${Math.max(1, Math.round(fileSize / 1024))} KB`
  return `${(fileSize / 1024 / 1024).toFixed(1)} MB`
}

export default function CurriculumMaterialField({ id, value, onChange, downloadRequest }: CurriculumMaterialFieldProps) {
  const [error, setError] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const { download, downloadingMaterialId } = useMaterialDownload()

  const addFiles = (files: File[]) => {
    const validFiles = files.filter((file) => file.type === PPTX_MIME || file.name.toLowerCase().endsWith('.pptx'))
    setError(validFiles.length === files.length ? '' : 'PPTX 파일만 등록할 수 있습니다.')
    // 원본 File을 함께 들고 있어야 저장 시 presigned 업로드→attach로 실제 반영된다(ADR-0042).
    const selected: CurriculumMaterial[] = validFiles.map((file, index) => ({
      materialId: `curriculum-material-${file.lastModified}-${file.size}-${index}`,
      fileName: file.name,
      fileSize: file.size,
      file,
    }))
    const next = [...value]
    for (const material of selected) {
      const duplicate = next.some((item) => item.fileName === material.fileName && item.fileSize === material.fileSize)
      if (!duplicate) next.push(material)
    }
    onChange(next)
  }

  const selectFiles = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  const dropFiles = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setDragActive(false)
    addFiles(Array.from(event.dataTransfer.files))
  }

  return (
    <div className="curriculum-material-field">
      <label
        className={`material-dropzone lesson-form__dropzone curriculum-material-field__dropzone${dragActive ? ' is-drag-active' : ''}`}
        htmlFor={id}
        onDragEnter={(event) => { event.preventDefault(); setDragActive(true) }}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }}
        onDragLeave={() => setDragActive(false)}
        onDrop={dropFiles}
      >
        <input
          id={id}
          aria-label="커리큘럼 강의 자료 등록"
          type="file"
          accept={`.pptx,${PPTX_MIME}`}
          multiple
          onChange={selectFiles}
        />
        <span className="lesson-form__pptx-icon" aria-hidden="true"><span>PPTX</span></span>
        <span className="lesson-form__dropzone-copy">
          <strong>PPTX 파일을 드래그하거나 클릭해 선택</strong>
          <small>여러 파일 동시 등록 가능 · 등록하지 않아도 저장할 수 있습니다.</small>
        </span>
      </label>
      {value.length > 0 && (
        <ul className="material-list curriculum-material-field__list">
          {value.map((material) => (
            <li key={material.materialId}>
              <span className="file-icon">PPTX</span>
              <div><strong>{material.fileName}</strong><small>{formatFileSize(material.fileSize)}</small></div>
              {downloadRequest && !material.file && (
                <button
                  className="button button--soft button--small"
                  type="button"
                  disabled={downloadingMaterialId === material.materialId}
                  aria-label={`${material.fileName} 다운로드`}
                  onClick={() => void download(downloadRequest(material))}
                >
                  {downloadingMaterialId === material.materialId ? '받는 중…' : '다운로드'}
                </button>
              )}
              {/*
                예전엔 "추가 예정 / 등록됨" 두 값뿐이었다 — 저장이 끝나면 임베딩이 아직 돌고 있어도
                "등록됨"으로 굳어, 이 화면에서는 AI가 자료를 다 읽었는지 알 방법이 전혀 없었다.
              */}
              <MaterialStatusBadges material={material} audience="instructor" />
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
