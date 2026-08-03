import { useCallback, useRef, useState } from 'react'
import type { UserRole } from '@/features/auth/types'
import AccountWithdrawModal from './AccountWithdrawModal'

interface AccountWithdrawPanelProps {
  role: UserRole
}

/**
 * "계정 설정" 카드 안의 회원 탈퇴 진입 행.
 *
 * <p>안내 항목·동의 절차를 카드에 펼쳐 두면 그것만으로 카드가 300px 가까이 되어 한 페이지에 담기지
 * 않는다(ADR-0011). 그래서 카드에는 무엇을 하는 곳인지만 한 줄로 남기고, 안내 전문과 동의는
 * 모달로 옮겼다 — <b>안내를 줄인 것이 아니라 위치를 옮긴 것이다.</b>
 *
 * <p>모달을 닫으면 포커스를 이 버튼으로 되돌린다. 키보드 사용자가 모달을 벗어난 뒤 페이지 맨
 * 위에서 다시 내려오게 되면 안 된다.
 */
export default function AccountWithdrawPanel({ role }: AccountWithdrawPanelProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const closeModal = useCallback(() => {
    setIsModalOpen(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  return (
    <section className="withdraw-trigger" aria-labelledby="withdraw-trigger-title">
      <div>
        <h3 id="withdraw-trigger-title">회원 탈퇴</h3>
        <p>계정을 비활성화합니다. 안내를 확인한 뒤 진행할 수 있습니다.</p>
      </div>
      <button
        ref={triggerRef}
        className="button button--danger button--small"
        type="button"
        onClick={() => setIsModalOpen(true)}
      >
        회원 탈퇴
      </button>

      {isModalOpen && <AccountWithdrawModal role={role} onClose={closeModal} />}
    </section>
  )
}
