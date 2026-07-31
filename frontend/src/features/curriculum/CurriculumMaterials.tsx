import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CurriculumMaterial } from './types'

interface CurriculumMaterialsProps {
  materials: CurriculumMaterial[]
}

function formatFileSize(fileSize: number) {
  if (fileSize < 1024 * 1024) return `${Math.max(1, Math.round(fileSize / 1024))} KB`
  return `${(fileSize / 1024 / 1024).toFixed(1)} MB`
}

export default function CurriculumMaterials({ materials }: CurriculumMaterialsProps) {
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
        <p>전체 강의에서 공통으로 사용하는 자료입니다.</p>
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
                <p id={dialogDescriptionId}>전체 강의에서 공통으로 사용하는 자료 {materials.length}개입니다.</p>
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
            <ul>
              {materials.map((material) => (
                <li key={material.materialId}>
                  <span className="curriculum-materials__icon">PPTX</span>
                  <div><strong>{material.fileName}</strong><small>{formatFileSize(material.fileSize)}</small></div>
                </li>
              ))}
            </ul>
          </section>
        </div>,
        document.body,
      )}
    </section>
  )
}
