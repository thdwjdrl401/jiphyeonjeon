import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MaterialDownloadRequest } from '@/features/material/materialDownloadService'
import MaterialStatusBadges from '@/features/material/MaterialStatusBadges'
import { useMaterialDownload } from '@/features/material/useMaterialDownload'
import type { CurriculumMaterial } from './types'

interface CurriculumMaterialsProps {
  materials: CurriculumMaterial[]
  /**
   * 자료 다운로드 요청 정보. 주면 모달 목록의 각 자료에 다운로드 버튼을 붙인다.
   *
   * 링크가 아니라 버튼이다. 서버는 presigned URL로 302를 주는데 그 URL에는 원본 파일명이 없고
   * (객체 키가 곧 이름) `download` 속성은 교차 출처 응답에서 무시된다. 게다가 링크로 열면
   * 권한 실패(401·403·404)가 수강생 화면에 전혀 드러나지 않아 "눌러도 아무 일이 없는" 상태가 된다.
   * 바이트를 받아 온 뒤 이름을 붙여 저장하고 실패는 토스트로 알린다.
   */
  downloadRequest?: (material: CurriculumMaterial) => MaterialDownloadRequest
}

function formatFileSize(fileSize: number) {
  if (fileSize < 1024 * 1024) return `${Math.max(1, Math.round(fileSize / 1024))} KB`
  return `${(fileSize / 1024 / 1024).toFixed(1)} MB`
}

export default function CurriculumMaterials({ materials, downloadRequest }: CurriculumMaterialsProps) {
  const [isOpen, setIsOpen] = useState(false)
  const { download, downloadingMaterialId } = useMaterialDownload()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const dialogTitleId = useId()
  const dialogDescriptionId = useId()

  useEffect(() => {
    if (!isOpen) return

    const previousOverflow = document.body.style.overflow
    const trigger = triggerRef.current
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
      trigger?.focus()
    }
  }, [isOpen])

  return (
    <section className="curriculum-materials" aria-labelledby="curriculum-materials-heading">
      <div className="curriculum-materials__body">
        <div className="curriculum-materials__header">
          <h2 id="curriculum-materials-heading">커리큘럼 강의 자료</h2>
          <div className="curriculum-materials__actions">
            <button
              ref={triggerRef}
              className="button button--primary curriculum-materials__open-button"
              type="button"
              aria-haspopup="dialog"
              onClick={() => setIsOpen(true)}
            >
              자료 목록
            </button>
          </div>
        </div>
        <p>
          {materials.length > 0
            ? '전체 강의에서 공통으로 사용하는 자료입니다.'
            : '아직 등록된 강의 자료가 없습니다.'}
        </p>
      </div>

      {isOpen && createPortal(
        <div
          className="curriculum-materials-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsOpen(false)
          }}
        >
          <section
            className="curriculum-materials curriculum-materials-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            aria-describedby={dialogDescriptionId}
          >
            <header className="curriculum-materials-modal__header">
              <div>
                <h2 id={dialogTitleId}>커리큘럼 강의 자료</h2>
                <p id={dialogDescriptionId}>
                  {materials.length > 0
                    ? `전체 강의에서 공통으로 사용하는 자료 ${materials.length}개입니다.`
                    : '아직 등록된 강의 자료가 없습니다.'}
                </p>
              </div>
              <button
                ref={closeButtonRef}
                className="curriculum-materials-modal__close"
                type="button"
                aria-label="강의 자료 목록 닫기"
                onClick={() => setIsOpen(false)}
              >
                ×
              </button>
            </header>
            {materials.length > 0 ? (
              <ul>
                {materials.map((material) => (
                  <li key={material.materialId}>
                    <span className="curriculum-materials__icon">PPTX</span>
                    <div><strong>{material.fileName}</strong><small>{formatFileSize(material.fileSize)}</small></div>
                    {/*
                      수강생에겐 파이프라인 내부 상태를 그대로 보이지 않는다 — PENDING과 PROCESSING을
                      구분해 봤자 할 수 있는 일이 같다. 준비가 끝나면 배지 자체가 사라진다.
                      다운로드는 임베딩과 무관하게 언제나 된다(원본 파일은 이미 올라가 있다).
                    */}
                    <MaterialStatusBadges material={material} audience="student" />
                    {downloadRequest && (
                      <button
                        className="button button--soft button--small curriculum-materials__download"
                        type="button"
                        disabled={downloadingMaterialId === material.materialId}
                        aria-label={`${material.fileName} 다운로드`}
                        onClick={() => void download(downloadRequest(material))}
                      >
                        {downloadingMaterialId === material.materialId ? '받는 중…' : '다운로드'}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="curriculum-materials-modal__empty">
                등록된 강의 자료가 없습니다. 자료가 등록되면 이곳에서 확인할 수 있습니다.
              </p>
            )}
          </section>
        </div>,
        document.body,
      )}
    </section>
  )
}
