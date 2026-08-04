import { useEffect, useId, useRef, useState } from 'react'
import type { CurriculumInstructorProfile } from './types'

interface InstructorProfileDisclosureProps {
  instructor: CurriculumInstructorProfile
}

/**
 * 강사 이름 옆의 버튼으로 소개·전문 분야를 펼쳐 보여주는 드롭다운.
 * 히어로의 메타데이터 줄은 한 줄로 유지해야 해서 상세 정보는 눌렀을 때만 내려온다.
 */
export default function InstructorProfileDisclosure({ instructor }: InstructorProfileDisclosureProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelId = useId()

  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setIsOpen(false)
      triggerRef.current?.focus()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  // 표시 전용 컴포넌트라 여기서 던지면 상세 페이지 전체가 빈 화면이 된다.
  // HTTP 경계가 이미 채워 주지만, 값이 비어 오더라도 이름은 남도록 한 번 더 막는다.
  const bio = instructor.bio?.trim() ?? ''
  // 저장 경로에 따라 한 항목에 "Spring, JPA"처럼 쉼표로 묶여 들어온 값이 섞여 있다.
  // 태그 하나에 여러 분야가 뭉쳐 보이지 않게 표시 직전에 쉼표로 한 번 더 나눈다.
  const expertise = [
    ...new Set(
      (instructor.expertise ?? [])
        .flatMap((item) => item.split(','))
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  ]

  // 소개도 전문 분야도 없으면 토글을 두지 않는다 — 눌러도 빈 패널만 나오는 버튼은 잡음이다.
  if (!bio && expertise.length === 0) {
    return <>{instructor.displayName}</>
  }

  return (
    <div className="instructor-profile" ref={containerRef}>
      <span className="instructor-profile__name">{instructor.displayName}</span>
      <button
        ref={triggerRef}
        className="instructor-profile__trigger"
        type="button"
        aria-label={`${instructor.displayName} 강사 정보`}
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setIsOpen((current) => !current)}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.7" />
          <path
            d="M12 11v5.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
          <circle cx="12" cy="7.75" r="1.05" fill="currentColor" />
        </svg>
      </button>

      {/* 접혀도 DOM에 남긴다 — aria-controls가 가리키는 대상이 사라지면 참조가 끊긴다. */}
      <div className="instructor-profile__panel" hidden={!isOpen} id={panelId}>
        {bio && (
          <section className="instructor-profile__section">
            <h3>강사 소개</h3>
            <p className="instructor-profile__bio">{bio}</p>
          </section>
        )}
        {expertise.length > 0 && (
          <section className="instructor-profile__section">
            <h3>전문 분야</h3>
            <ul className="instructor-profile__tags">
              {expertise.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
