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
  /** 판서를 표시 중인가(ADR-0056). op가 아니라 세션의 표시 상태다 — fold에 끼어들지 않는다. */
  visible?: boolean
}

/** 복원된 판서. `nextRevision`은 강사가 이어서 채번할 번호다. */
export interface RestoredAnnotation {
  document: AnnotationDocument
  nextRevision: number
  /**
   * 새로고침 직전의 표시 상태(ADR-0056). 이 값으로 판서를 켤지 정하고, <b>그 상태를 수신 측에도
   * 알린다</b> — 그러지 않으면 강사 화면은 비었는데 Egress는 자기 문서를 계속 그려서 수강생에게만
   * 판서가 남는다.
   */
  visible: boolean
}

/** 아무것도 저장돼 있지 않은(또는 복원에 실패한) 상태. 강사는 1번부터 채번한다. */
export function emptyRestoredAnnotation(): RestoredAnnotation {
  return { document: emptyAnnotationDocument(), nextRevision: 1, visible: false }
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
    document: { revision: api.revision, elements: document.elements, files: document.files },
    nextRevision: Math.max(1, api.nextRevision),
    visible: api.visible === true,
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

/**
 * 페이지를 떠나며 보내는 요청의 본문 상한(byte).
 *
 * <p>`keepalive` 요청은 <b>브라우저가 64KB로 제한</b>한다(Fetch 표준). 넘기면 요청이 아예 나가지
 * 않고 실패하는데, 페이지가 사라지는 중이라 재시도할 기회도 없다. 여유를 두고 자른다.
 */
const KEEPALIVE_BODY_LIMIT = 50_000

/**
 * 평소 요청의 본문 상한(byte). `keepalive`가 아니므로 64KB 제한을 받지 않지만, 한 번에 너무 크게
 * 보내면 실패했을 때 되돌릴 양이 커진다.
 */
const BODY_LIMIT = 1_000_000

/**
 * 밀린 op의 상한. 서버가 계속 실패하면 여기서 멈춘다 — 저장은 부가 기능이고, 두 시간짜리 강의의
 * 메모리를 잡아먹으면서까지 붙들 이유가 없다.
 */
const MAX_PENDING = 2000

/** 묶어 보내는 주기(ms). 획 하나마다 왕복하면 그리는 동안 요청이 폭주한다. */
const FLUSH_INTERVAL_MS = 1500

type ApiOp = ReturnType<typeof toApiOp>

/**
 * 대기열 항목. `key`는 <b>합칠 수 있는지</b> 판단하는 값이다 — 같은 요소 하나만 담은 upsert끼리만
 * 합친다(아래 `push` 참조).
 */
interface QueuedOp {
  api: ApiOp
  key: string
}

/**
 * 합칠 수 있는 op인지 나타내는 키. 요소 <b>하나</b>짜리 upsert만 대상이다. 여러 요소를 담은 upsert나
 * delete·snapshot·clear는 합치면 의미가 달라지므로 빈 키(합치지 않음)를 준다.
 */
function coalesceKey(op: AnnotationOp): string {
  if (op.type !== 'upsert' || op.elements.length !== 1) return ''
  return `upsert:${op.elements[0].id}`
}

/** JSON으로 실었을 때의 크기(byte). 묶음을 자르는 기준이다. */
function opBytes(op: ApiOp): number {
  return new TextEncoder().encode(JSON.stringify(op)).length
}

/**
 * 본문 크기가 상한을 넘지 않도록 앞에서부터 잘라 낸다.
 *
 * <p>op 하나가 혼자 상한을 넘어도 그것만은 보낸다 — 아니면 그 op가 대기열을 영원히 막는다.
 */
function takeBatch(queue: QueuedOp[], limit: number): { batch: QueuedOp[]; rest: QueuedOp[] } {
  const batch: QueuedOp[] = []
  let bytes = 2   // 배열 괄호
  for (const item of queue) {
    const size = opBytes(item.api) + 1
    if (batch.length > 0 && bytes + size > limit) break
    batch.push(item)
    bytes += size
  }
  return { batch, rest: queue.slice(batch.length) }
}

export interface AnnotationOpSink {
  /** op를 기록 대기열에 넣는다. 보내는 것은 나중이고, 호출자는 기다리지 않는다. */
  push(op: AnnotationOp): void
  /**
   * 지금 밀린 것을 즉시 보낸다. `unloading`이면 페이지가 사라져도 요청이 살아남도록 `keepalive`로
   * 보내고, 그 대신 본문을 브라우저 한도(64KB) 아래로 자른다.
   */
  flush(unloading?: boolean): void
  /**
   * 대기열이 <b>빌 때까지</b> 보내고, 지금까지 push한 것이 모두 서버에 남았는지 알려준다.
   *
   * <p>포인터를 내기 전에 쓴다(ADR-0055). 포인터는 "여기까지의 상태는 서버에 있다"는 약속이라,
   * 밀린 저장이 남은 채로 내면 수신 측이 받은 문서와 이후 델타 사이에 구멍이 생긴다 — 그 구멍은
   * 수강생 화면에서만 보이므로 강사가 알아챌 수 없다. 거짓말을 하느니 <b>false</b>를 돌려주고
   * 호출자가 스냅샷으로 물러서게 한다.
   *
   * <p>`flush`와 달리 한 묶음만 보내고 끝나지 않는다 — 한 번의 `flush`는 크기 상한에 걸려 앞부분만
   * 보낼 수 있다.
   *
   * <p>대기열이 넘쳐 op를 버린 적이 있으면 <b>대기열이 비어도 false</b>다. 그 구멍은 서버가 영영
   * 메우지 못하므로, 비었다는 사실만으로 "서버가 강사를 따라잡았다"고 말하면 거짓이 된다.
   */
  flushAll(): Promise<boolean>
  /** 타이머를 정리하고 남은 것을 한 번 보낸다. */
  stop(): void
  /** 대기 중인 op 수(테스트·진단용). */
  pending(): number
}

interface SinkOptions {
  /** 실제 전송. 테스트에서 갈아 끼운다. */
  send?: (sessionId: string, ops: ApiOp[], keepalive: boolean) => Promise<void>
  now?: () => Date
  flushIntervalMs?: number
}

/**
 * op 묶음을 서버에 넘긴다.
 *
 * <p>`keepalive`는 <b>페이지를 떠날 때만</b> 켠다. 페이지가 사라져도 요청이 끝까지 가야 마지막 몇
 * 획이 저장되기 때문인데, 대신 브라우저가 본문을 64KB로 제한한다. 평소 요청까지 켜 두면 판서가
 * 조금만 쌓여도 묶음이 그 한도를 넘어 <b>전송이 통째로 실패하고, 실패한 묶음이 대기열 맨 앞에
 * 다시 들어가 그 뒤로 아무것도 저장되지 않는다</b> — 라이브 전달은 멀쩡하므로 강사는 알 수 없다.
 */
async function postOps(sessionId: string, ops: ApiOp[], keepalive: boolean): Promise<void> {
  const response = await fetch(`/api/live-sessions/${sessionId}/annotation/ops`, {
    method: 'POST',
    credentials: 'include',
    keepalive,
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

  let queue: QueuedOp[] = []
  /** 지금 날아가고 있는 묶음. 성공 여부로 resolve한다(reject하지 않는다). */
  let inFlight: Promise<boolean> | null = null
  let stopped = false
  /**
   * 대기열이 넘쳐 op를 버린 적이 있는가. 한 번이라도 버렸다면 <b>이 페이지에서는 서버가 강사의
   * 문서를 다시 따라잡을 수 없다</b> — 그래서 이 값은 되돌아가지 않고, 포인터(ADR-0055)를 내는
   * 자격을 영구히 잃는다.
   */
  let dropped = false

  const drain = (unloading = false): Promise<boolean> => {
    // 이미 나간 묶음이 있으면 그것을 기다린다. 겹쳐 보내면 실패한 묶음을 앞에 다시 넣을 때 순서가
    // 뒤집힌다.
    if (inFlight) return inFlight
    if (stopped || queue.length === 0) return Promise.resolve(true)
    const { batch, rest } = takeBatch(queue, unloading ? KEEPALIVE_BODY_LIMIT : BODY_LIMIT)
    queue = rest
    // 성공·실패를 <b>한 then에서</b> 받는다. `.catch().finally()`로 늘리면 그만큼 마이크로태스크가
    // 더 걸려, 실패 직후 곧바로 다시 flush하는 호출자가 "아직 날아가는 중"으로 막힌다.
    const attempt = send(sessionId, batch.map((item) => item.api), unloading).then(
      () => {
        inFlight = null
        return true
      },
      (error: unknown) => {
        queue = [...batch, ...queue]
        inFlight = null
        console.warn('판서 기록을 서버에 남기지 못했습니다(재시도합니다)', error)
        return false
      },
    )
    inFlight = attempt
    return attempt
  }

  const timer = setInterval(() => { void drain() }, interval)

  return {
    /**
     * <p><b>같은 요소를 이어서 고치는 upsert는 합친다.</b> Excalidraw는 획을 긋는 동안 점이 하나
     * 늘 때마다 `onChange`를 부르므로, 획 하나가 수십 개의 op가 되고 뒤로 갈수록 요소 전체가 실려
     * 커진다(실측: 획 하나에 40건, 합쳐서 61KB). 마지막 것만 두어도 복원 결과는 같다 — upsert는
     * 같은 id를 덮어쓰기 때문이다. 다만 <b>시각은 처음 것을 남긴다</b>: 앵커는 "강사가 이걸 그리기
     * 시작한 순간"을 가리켜야 한다.
     */
    push(op) {
      if (stopped) return
      const api = toApiOp(op, now().toISOString())
      const key = coalesceKey(op)
      const last = queue[queue.length - 1]
      if (key !== '' && last && last.key === key) {
        queue[queue.length - 1] = { key, api: { ...api, occurredAt: last.api.occurredAt } }
        return
      }
      if (queue.length >= MAX_PENDING) {
        if (!dropped) {
          console.warn('판서 기록이 계속 밀려 오래된 op를 버립니다. 라이브 전달에는 영향이 없습니다.')
          dropped = true
        }
        queue.shift()
      }
      queue.push({ api, key })
    },
    flush: (unloading = false) => { void drain(unloading) },
    /**
     * 대기열이 빌 때까지 반복해 보낸다. 한 번이라도 실패하면 <b>거기서 멈추고 false</b>다 — 같은
     * 요청을 곧바로 다시 던져 봐야 결과가 같고, 주기 타이머가 어차피 계속 재시도한다.
     */
    async flushAll() {
      // 묶음 수의 상한. 대기열은 MAX_PENDING(2000)개까지 쌓이고 묶음 하나가 최소 한 건은 가져가므로
      // 정상 경로에서는 여기 닿지 않는다. 큐가 줄지 않는 상황에서 영원히 도는 것만 막는다.
      // 버린 적이 있어도 <b>보내기는 계속한다.</b> 답은 false지만 남은 기록은 여전히 남길 값어치가
      // 있다 — 강사 새로고침 복원은 구멍 난 문서라도 없는 것보다 낫다.
      for (let round = 0; round < MAX_PENDING; round += 1) {
        if (stopped || queue.length === 0) break
        if (!(await drain())) return false
      }
      return queue.length === 0 && !dropped
    },
    stop() {
      clearInterval(timer)
      void drain()
      stopped = true
    },
    pending: () => queue.length,
  }
}
