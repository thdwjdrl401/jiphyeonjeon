import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CurriculumMaterial } from './types'

interface CurriculumMaterialsProps {
  materials: CurriculumMaterial[]
  /**
   * 자료 다운로드 링크. 주면 모달 목록의 각 자료에 다운로드 버튼을 붙인다.
   *
   * 링크에는 `download={fileName}`을 함께 건다 — 서버가 presigned URL로 302를 주는데 그 URL에는
   * 원본 파일명이 없어서(객체키가 곧 파일명이 된다) 이름을 여기서 되돌려 준다. 다만 이 속성은
   * 최종 응답이 same-origin일 때만 먹는다(운영은 nginx가 MinIO를 같은 도메인으로 프록시해 유효,
   * 로컬은 MinIO가 다른 포트라 무시된다). 근본 수정은 서버가 presign에 Content-Disposition을
   * 실어 주는 것이다.
   */
  downloadHref?: (material: CurriculumMaterial) => string
}

function formatFileSize(fileSize: number) {
  if (fileSize < 1024 * 1024) return `${Math.max(1, Math.round(fileSize / 1024))} KB`
  return `${(fileSize / 1024 / 1024).toFixed(1)} MB`
}

export default function CurriculumMaterials({ materials, downloadHref }: CurriculumMaterialsProps) {
  const [isOpen, setIsOpen] = useState(false)
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
                    {downloadHref && (
                      <a
                        className="button button--soft button--small curriculum-materials__download"
                        href={downloadHref(material)}
                        download={material.fileName}
                        aria-label={`${material.fileName} 다운로드`}
                      >
                        다운로드
                      </a>
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
