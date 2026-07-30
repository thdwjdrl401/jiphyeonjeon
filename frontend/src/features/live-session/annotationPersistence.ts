import { resolveCsrfHeader } from '@/shared/api/client'
import { applyAnnotationOp, emptyAnnotationDocument, type AnnotationDocument, type AnnotationOp } from './annotation'

/**
 * 판서 영속화 클라이언트(ADR-0051, CONTRACT §3-6b).
 *
 * <p><b>라이브 경로가 아니다.</b> 판서가 수강생에게 닿는 길은 LiveKit 데이터 채널 → Egress이고,
 * 여기는 그와 나란히 서버에 기록만 남긴다. 그래서 이 모듈의 어떤 실패도 강사 화면이나 수강생 화면을
 * 막지 않는다 — 획을 그을 때마다 HTTP 왕복을 기다리면 그리는 동작이 끊긴다.
 *
 * <p>얻는 것은 둘이다. 강사가 새로고침해도 판서가 남고, 각 op에 시각이 붙어 나중에 "강사가 이걸
 * 강조한 순간"으로 다시보기를 이동할 수 있다.
 */

/** 서버가 돌려주는 판서 문서(원문). */
interface ApiAnnotationDocument {
  revision: number
  nextRevision: number
  snapshotPayload: string | null
  ops: { revision: number; opType: string; payload: string }[]
}

/** 복원된 판서. `nextRevision`은 강사가 이어서 채번할 번호다. */
export interface RestoredAnnotation {
  document: AnnotationDocument
  nextRevision: number
}

/** 아무것도 저장돼 있지 않은(또는 복원에 실패한) 상태. 강사는 1번부터 채번한다. */
export function emptyRestoredAnnotation(): RestoredAnnotation {
  return { document: emptyAnnotationDocument(), nextRevision: 1 }
}

/**
 * 저장된 op 하나를 전송 형태로 바꾼다.
 *
 * <p>서버는 payload를 해석하지 않는다 — 문자열로 받아 그대로 돌려준다. 판서 요소의 스키마를 서버에
 * 박아 두면 Excalidraw가 필드를 하나 늘릴 때마다 마이그레이션이 따라와야 하기 때문이다.
 */
export function toApiOp(op: AnnotationOp, occurredAt: string): {
  revision: number
  opType: string
  payload: string
  occurredAt: string
} {
  const { type, revision, ...rest } = op as AnnotationOp & Record<string, unknown>
  return { revision, opType: type, payload: JSON.stringify(rest), occurredAt }
}

/** 전송 형태를 다시 op로. 복원할 때 쓴다. 해석할 수 없으면 null(그 op만 건너뛴다). */
export function fromApiOp(stored: { revision: number; opType: string; payload: string }): AnnotationOp | null {
  let body: Record<string, unknown>
  try {
    body = JSON.parse(stored.payload) as Record<string, unknown>
  } catch {
    return null
  }
  const type = stored.opType
  if (type !== 'snapshot' && type !== 'upsert' && type !== 'delete' && type !== 'clear') return null
  return { ...body, type, revision: stored.revision } as AnnotationOp
}

/**
 * 서버 응답을 판서 문서로 접는다.
 *
 * <p>마지막 스냅샷에서 시작해 그 이후 op만 얹는다 — 스냅샷 자체가 전체 상태라 그 이전은 볼 필요가
 * 없고, 세션 전체를 접으면 강의가 길어질수록 복원이 느려진다.
 *
 * <p><b>nextRevision은 서버 값을 그대로 쓴다.</b> 접힌 문서의 revision으로 대신하면 안 된다 — 저장에
 * 실패한 op가 있으면 그 번호가 비어, 강사가 이미 쓴 번호를 다시 쓰게 된다.
 */
export function foldStoredDocument(api: ApiAnnotationDocument): RestoredAnnotation {
  let document = emptyAnnotationDocument()

  if (api.snapshotPayload !== null) {
    const snapshot = fromApiOp({ revision: 0, opType: 'snapshot', payload: api.snapshotPayload })
    if (snapshot) document = applyAnnotationOp(document, snapshot).document
  }

  // 번호를 1씩 이어 붙여 얹는다. applyAnnotationOp의 유실 감지(revision이 건너뛰면 버리고 스냅샷을
  // 기다린다)는 데이터 채널용이고, 여기서는 반대로 해가 된다 — 저장된 행은 "전송 중 유실"이 아니라
  // 실제로 남은 전부다. 번호가 띄엄한 것은 그 사이 op가 저장에 실패했다는 뜻이고, 그렇다고 뒤따르는
  // 획까지 버리면 복원된 판서에서 그 이후가 통째로 사라진다. 최종 번호는 아래에서 서버 값으로 덮는다.
  for (const stored of api.ops) {
    const op = fromApiOp(stored)
    if (!op) continue
    document = applyAnnotationOp(document, { ...op, revision: document.revision + 1 }).document
  }

  return {
    document: { revision: api.revision, elements: document.elements },
    nextRevision: Math.max(1, api.nextRevision),
  }
}

/**
 * 저장된 판서를 불러온다.
 *
 * <p>실패하면 빈 문서를 돌려준다 — 복원 실패가 강의 시작을 막을 이유가 없다. 다만 nextRevision이
 * 1로 돌아가므로, 호출자는 이 값으로 Egress에 <b>스냅샷</b>을 보내 양쪽 번호를 맞춰야 한다.
 */
export async function fetchAnnotationDocument(sessionId: string): Promise<RestoredAnnotation> {
  try {
    const response = await fetch(`/api/live-sessions/${sessionId}/annotation`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return emptyRestoredAnnotation()
    return foldStoredDocument((await response.json()) as ApiAnnotationDocument)
  } catch {
    return emptyRestoredAnnotation()
  }
}

/** 한 번에 보낼 최대 op 수. 커질수록 요청은 줄지만 실패 한 번에 잃는 양이 늘어난다. */
const MAX_BATCH = 100

/**
 * 밀린 op의 상한. 서버가 계속 실패하면 여기서 멈춘다 — 저장은 부가 기능이고, 두 시간짜리 강의의
 * 메모리를 잡아먹으면서까지 붙들 이유가 없다.
 */
const MAX_PENDING = 2000

/** 묶어 보내는 주기(ms). 획 하나마다 왕복하면 그리는 동안 요청이 폭주한다. */
const FLUSH_INTERVAL_MS = 1500

export interface AnnotationOpSink {
  /** op를 기록 대기열에 넣는다. 보내는 것은 나중이고, 호출자는 기다리지 않는다. */
  push(op: AnnotationOp): void
  /** 지금 밀린 것을 즉시 보낸다. 페이지를 떠날 때 쓴다. */
  flush(): void
  /** 타이머를 정리하고 남은 것을 한 번 보낸다. */
  stop(): void
  /** 대기 중인 op 수(테스트·진단용). */
  pending(): number
}

interface SinkOptions {
  /** 실제 전송. 테스트에서 갈아 끼운다. */
  send?: (sessionId: string, ops: ReturnType<typeof toApiOp>[]) => Promise<void>
  now?: () => Date
  flushIntervalMs?: number
}

async function postOps(sessionId: string, ops: ReturnType<typeof toApiOp>[]): Promise<void> {
  const response = await fetch(`/api/live-sessions/${sessionId}/annotation/ops`, {
    method: 'POST',
    credentials: 'include',
    // 새로고침으로 페이지가 사라져도 이 요청은 끝까지 간다. 마지막 몇 획이 저장되지 않으면
    // 복원했을 때 강사가 방금 그린 것만 빠져 보인다.
    keepalive: true,
    headers: { 'Content-Type': 'application/json', ...(await resolveCsrfHeader()) },
    body: JSON.stringify(ops),
  })
  if (!response.ok) throw new Error(`판서 op 적재 실패: ${response.status}`)
}

/**
 * op를 모아 주기적으로 서버에 넘기는 대기열.
 *
 * <p>실패한 묶음은 <b>버리지 않고 다시 앞에 넣는다</b>. 같은 revision을 다시 보내도 서버가 중복
 * 적재하지 않으므로(멱등) 재시도가 안전하고, 중간의 upsert 하나가 사라지면 복원했을 때 그 획만
 * 빠진 판서가 나온다.
 */
export function createAnnotationOpSink(sessionId: string, options: SinkOptions = {}): AnnotationOpSink {
  const send = options.send ?? postOps
  const now = options.now ?? (() => new Date())
  const interval = options.flushIntervalMs ?? FLUSH_INTERVAL_MS

  let queue: ReturnType<typeof toApiOp>[] = []
  let inFlight = false
  let stopped = false
  let droppedLogged = false

  const drain = () => {
    if (inFlight || stopped || queue.length === 0) return
    const batch = queue.slice(0, MAX_BATCH)
    queue = queue.slice(batch.length)
    inFlight = true
    void send(sessionId, batch)
      .catch((error) => {
        queue = [...batch, ...queue]
        console.warn('판서 기록을 서버에 남기지 못했습니다(재시도합니다)', error)
      })
      .finally(() => {
        inFlight = false
      })
  }

  const timer = setInterval(drain, interval)

  return {
    push(op) {
      if (stopped) return
      if (queue.length >= MAX_PENDING) {
        if (!droppedLogged) {
          console.warn('판서 기록이 계속 밀려 오래된 op를 버립니다. 라이브 전달에는 영향이 없습니다.')
          droppedLogged = true
        }
        queue.shift()
      }
      queue.push(toApiOp(op, now().toISOString()))
    },
    flush: drain,
    stop() {
      clearInterval(timer)
      drain()
      stopped = true
    },
    pending: () => queue.length,
  }
}
