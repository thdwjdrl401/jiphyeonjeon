import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react'

export type ToastTone = 'info' | 'success' | 'warning' | 'danger'

interface ToastItem {
  id: number
  message: string
  tone: ToastTone
  duration: number
}

interface ToastOptions {
  tone?: ToastTone
  /** 자동으로 사라지기까지의 시간(ms). 0 이하면 자동으로 닫히지 않는다. */
  duration?: number
}

/**
 * 띄우기·닫기.
 *
 * <p>모두 <b>토스트 id</b>를 돌려준다. 자동으로 닫히지 않는 토스트(`duration: 0`)를 상황이 풀렸을
 * 때 치우려면 부른 쪽이 id를 쥐고 있어야 한다 — 예: 자동 저장이 실패했다가 다시 성공했을 때.
 */
interface ToastApi {
  show: (message: string, options?: ToastOptions) => number
  success: (message: string, duration?: number) => number
  error: (message: string, duration?: number) => number
  warning: (message: string, duration?: number) => number
  info: (message: string, duration?: number) => number
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastApi | null>(null)
const DEFAULT_DURATION = 3200

/** 화면 어디서든 토스트를 띄운다. 반드시 <ToastProvider> 하위에서 호출해야 한다. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast는 <ToastProvider> 안에서만 사용할 수 있습니다.')
  return api
}

export function ToastProvider({ children }: PropsWithChildren) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const show = useCallback((message: string, options?: ToastOptions) => {
    const id = nextId.current++
    setToasts((current) => [
      ...current,
      { id, message, tone: options?.tone ?? 'info', duration: options?.duration ?? DEFAULT_DURATION },
    ])
    return id
  }, [])

  const api = useMemo<ToastApi>(() => ({
    show,
    success: (message, duration) => show(message, { tone: 'success', duration }),
    error: (message, duration) => show(message, { tone: 'danger', duration }),
    warning: (message, duration) => show(message, { tone: 'warning', duration }),
    info: (message, duration) => show(message, { tone: 'info', duration }),
    dismiss,
  }), [show, dismiss])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-viewport" role="region" aria-label="알림" aria-live="polite">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  useEffect(() => {
    if (toast.duration <= 0) return
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.duration)
    return () => window.clearTimeout(timer)
  }, [toast.id, toast.duration, onDismiss])

  return (
    <div className={`toast toast--${toast.tone}`} role="status">
      <span className="toast__message">{toast.message}</span>
      <button type="button" className="toast__close" aria-label="알림 닫기" onClick={() => onDismiss(toast.id)}>
        ×
      </button>
    </div>
  )
}
