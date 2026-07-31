import { applyAnnotationOp, type AnnotationDocument, type AnnotationOp } from './annotation'
import { foldStoredDocument } from './annotationPersistence'

/**
 * 판서 전체 상태를 <b>받아간다</b>(ADR-0055, CONTRACT §3-6b·§3-6d).
 *
 * <p><b>왜 밀지 않고 받아가는가.</b> 스냅샷은 문서 전체라 판서가 길어질수록 커진다. WebRTC 데이터
 * 채널의 기본 최대 메시지는 64KB인데 실측에서 요소 53개 + 수식 1개가 이미 74.9KB였다. 넘으면
 * 스냅샷이 통째로 실패해 <b>수강생 화면에 판서가 아예 나오지 않는다</b> — 강사 화면에는 멀쩡히
 * 보이므로 알아채기 어렵다.
 *
 * <p>델타는 계속 민다. 작고 잦고 지연에 민감해서 그 채널이 잘하는 일이다. 전체 상태만 HTTP로
 * 받아간다 — 크기 한도가 없고 재시도가 공짜다.
 */

/** Egress가 가진 것은 LiveKit 토큰뿐이다. 그것으로 "이 방의 참가자"임을 증명한다(ADR-0055 결정 4). */
export interface AnnotationPullOptions {
  sessionId: string
  livekitToken: string
  fetchImpl?: typeof fetch
}

/**
 * 서버에 있는 판서 문서를 가져온다. 실패하면 `null`이다.
 *
 * <p>던지지 않는다 — 이 경로가 막혀도 녹화는 계속돼야 한다.
 *
 * <p>돌려주는 문서의 `revision`은 <b>쓰지 않는다</b>. 그 번호는 서버가 저장한 마지막 op의 번호이고,
 * 델타 흐름과 이어붙일 기준은 포인터에 실려 온 강사의 번호다({@link applyPulledDocument}).
 */
export async function pullAnnotationDocument(
  options: AnnotationPullOptions,
): Promise<AnnotationDocument | null> {
  const request = options.fetchImpl ?? fetch
  try {
    const response = await request(`/api/live-sessions/${options.sessionId}/annotation`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        // 세션 쿠키가 없다. LiveKit 액세스 토큰으로 방 참가자임을 증명한다(ADR-0055).
        Authorization: `Bearer ${options.livekitToken}`,
      },
    })
    if (!response.ok) return null
    return foldStoredDocument(await response.json()).document
  } catch {
    return null
  }
}

/**
 * 가져온 문서에 <b>포인터의 번호</b>를 붙인다.
 *
 * <p>서버가 매긴 번호를 그대로 쓰면 안 된다. 강사는 저장하지 않는 op(판서 끄기, 번호 기준점용 빈
 * 스냅샷)에도 번호를 소비하므로 서버의 번호는 강사보다 낮다. 그대로 두면 이후 델타가 전부 "중간이
 * 빠졌다"로 버려진다 — 강사 화면에는 그려지는데 녹화에는 아무것도 나타나지 않는다.
 *
 * <p>포인터의 번호를 붙일 수 있는 근거는 강사 쪽에 있다: 밀린 저장을 모두 비운 뒤에만 포인터를
 * 내므로, 서버의 <b>내용</b>은 그 번호 시점의 강사 문서와 같다.
 */
export function applyPulledDocument(
  pulled: AnnotationDocument,
  pointerRevision: number,
): AnnotationDocument {
  return { revision: pointerRevision, elements: pulled.elements, files: pulled.files }
}

/**
 * 가져오는 동안 흐른 op를 쌓아 두는 버퍼.
 *
 * <p><b>버퍼를 먼저 열고 나중에 가져오는 것이 핵심이다</b>(ADR-0055 결정 3). 순서가 반대면 왕복이
 * 도는 몇백 ms 사이에 흐른 op가 사라지고, 수신 측은 그 구멍 때문에 <b>이후 op를 전부</b> 버린다.
 *
 * <p>포인터가 오기 전까지는 열지 않는다. 그 전에 흐른 op는 어차피 포인터가 가리키는 문서에 들어
 * 있고, 처음부터 열어 두면 <b>포인터를 모르는 옛 강사 페이지와 붙었을 때 아무것도 그려지지 않는다</b>.
 */
export class AnnotationOpBuffer {

  /** 쌓아 둘 op의 상한. 가져오기가 계속 실패해도 두 시간짜리 강의의 메모리를 먹지 않는다. */
  private static readonly LIMIT = 2000

  private buffered: AnnotationOp[] = []
  private open = false

  /** 버퍼를 연다. <b>포인터를 받은 순간</b>, 가져오기를 시작하기 직전에 부른다. */
  start(): void {
    this.open = true
    this.buffered = []
  }

  /** 쌓았으면 true. false면 버퍼링 중이 아니므로 호출자가 곧바로 적용한다. */
  push(op: AnnotationOp): boolean {
    if (!this.open) return false
    if (this.buffered.length >= AnnotationOpBuffer.LIMIT) this.buffered.shift()
    this.buffered.push(op)
    return true
  }

  /**
   * 버퍼를 닫고, 쌓인 것을 문서 위에 얹는다.
   *
   * <p>`revision <= 문서의 revision`인 op는 버린다 — 가져온 문서가 이미 그 내용을 담고 있어, 다시
   * 얹으면 같은 요소를 두 번 넣거나 이미 지운 것을 되살린다.
   */
  drainOnto(document: AnnotationDocument): AnnotationDocument {
    this.open = false
    const pending = this.buffered
      .filter((op) => op.revision > document.revision)
      .sort((a, b) => a.revision - b.revision)
    this.buffered = []

    let current = document
    for (const op of pending) {
      current = applyAnnotationOp(current, op).document
    }
    return current
  }

  /**
   * 버퍼링을 그만두고 쌓인 것을 버린다. 구독을 정리할 때 부른다.
   *
   * <p>열어 둔 채로 두면 다음 구독이 같은 인스턴스를 물려받아 <b>op를 전부 쌓기만 하고 아무것도
   * 그리지 않는다</b> — 다음 포인터가 올 때까지 녹화가 빈 채로 돈다.
   */
  close(): void {
    this.open = false
    this.buffered = []
  }

  /** 쌓여 있는 op 수(테스트·진단용). */
  size(): number {
    return this.buffered.length
  }
}
