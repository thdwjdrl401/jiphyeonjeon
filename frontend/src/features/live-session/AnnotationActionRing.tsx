import type { ReactNode } from 'react'

/**
 * 선택한 판서 주변에 뜨는 <b>방사형 액션 링</b>(ADR-0054).
 *
 * <p><b>왜 링인가.</b> 강사는 지금 펜을 들고 화면 한가운데를 보고 있다. 화면 구석의 툴바로
 * 시선과 손을 옮기게 하면 그리던 흐름이 끊긴다. 선택한 자리에 바로 떠서 <b>가까운 거리에 모든
 * 항목이 같은 거리로</b> 놓이는 편이 빠르다(피츠의 법칙). 항목이 서너 개인 지금 규모에 맞다.
 *
 * <p><b>선택을 가리지 않는다.</b> 링 안쪽은 비워 두고 바깥 원주에만 버튼을 둔다 — 정리 대상이
 * 보이지 않으면 무엇을 정리하는지 확인할 수 없다.
 */

export interface AnnotationAction {
  id: string
  label: string
  hint: string
  icon: ReactNode
  /** 모델을 부르는 항목. 왕복이 있으므로 강사에게 미리 알린다. */
  usesModel?: boolean
}

interface AnnotationActionRingProps {
  /** 링 중심. 판서 레이어(컨테이너) 기준 px. */
  center: { x: number; y: number }
  actions: readonly AnnotationAction[]
  /** 진행 중인 항목 id. 그 동안 링 전체를 잠근다 — 같은 선택에 두 번 요청하면 결과가 겹친다. */
  busyActionId?: string | null
  onPick: (actionId: string) => void
  onDismiss: () => void
}

/** 링 반지름(px). 선택 위에 겹치지 않을 만큼 띄우되, 손이 멀리 가지 않을 만큼만. */
const RADIUS = 84

/**
 * 12시 방향에서 시작해 시계방향. 위쪽이 가장 자연스러운 첫 자리다.
 *
 * <p>정수로 반올림한다. `cos(-π/2)`는 정확히 0이 아니라 5e-15라, 그대로 두면 소수점 좌표가 되어
 * 버튼이 반 픽셀에 걸쳐 흐릿하게 그려진다.
 */
function positionOf(index: number, total: number): { x: number; y: number } {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / total
  return { x: Math.round(Math.cos(angle) * RADIUS), y: Math.round(Math.sin(angle) * RADIUS) }
}

export default function AnnotationActionRing({
  center,
  actions,
  busyActionId,
  onPick,
  onDismiss,
}: AnnotationActionRingProps) {
  if (actions.length === 0) return null
  const busy = Boolean(busyActionId)

  return (
    <div
      className="annotation-action-ring"
      style={{ left: `${center.x}px`, top: `${center.y}px` }}
      role="group"
      aria-label="선택한 판서 정리"
    >
      {actions.map((action, index) => {
        const offset = positionOf(index, actions.length)
        const running = busyActionId === action.id
        return (
          <button
            key={action.id}
            type="button"
            className={`annotation-action-ring__item${running ? ' is-running' : ''}`}
            style={{ transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))` }}
            disabled={busy}
            aria-busy={running}
            title={action.hint}
            onClick={() => onPick(action.id)}
          >
            <span className="annotation-action-ring__icon" aria-hidden="true">{action.icon}</span>
            <span className="annotation-action-ring__label">{action.label}</span>
          </button>
        )
      })}
      <button
        type="button"
        className="annotation-action-ring__close"
        style={{ transform: 'translate(-50%, -50%)' }}
        disabled={busy}
        onClick={onDismiss}
        aria-label="정리 메뉴 닫기"
      >
        ✕
      </button>
    </div>
  )
}
