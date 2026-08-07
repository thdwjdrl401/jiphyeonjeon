import type React from 'react'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ANNOTATION_TOPIC,
  applyAnnotationOp,
  decodeAnnotationOp,
  emptyAnnotationDocument,
  visibleAnnotationElements,
  type AnnotationDocument,
  type AnnotationElement,
  type AnnotationOp,
} from '@/features/live-session/annotation'
import { applyPulledDocument, pullAnnotationDocument } from '@/features/live-session/annotationPull'

/**
 * 판서 한 바퀴 — 강사가 그린 것이 <b>수신 측(Egress)에서 같은 문서로 수렴하는가</b>, 그리고
 * <b>새로고침 뒤에도 그러한가</b>(ADR-0051, CONTRACT §3-6b·§3-6d).
 *
 * <p>이 파일이 필요한 이유는 지금까지의 판서 버그가 전부 같은 모양이었기 때문이다 — <b>강사 화면에는
 * 정상으로 보이고 수강생 화면에서만 어긋난다.</b> 조각별 단위 테스트는 각 조각이 "무엇을 보낸다"까지만
 * 고정하므로, 보낸 것들을 다 합쳤을 때 수신 측 문서가 강사의 문서와 같아지는지는 잡지 못한다.
 * 실제로 그렇게 빠져나간 것이 두 건이다.
 *
 * <ul>
 *   <li>수신 측은 revision 0에서 시작하는데 강사는 서버에서 이어받은 번호부터 매겨, 첫 획부터 전부
 *       "중간이 빠졌다"로 버려졌다.</li>
 *   <li>판서를 껐을 때 보내는 `clear`(감추기)를 서버에 저장해, 새로고침하면 문서가 비어 있었다.</li>
 * </ul>
 *
 * <p>그래서 여기서는 강사 쪽을 실제로 렌더해 <b>발행된 op를 모두 주워</b> 수신 측과 똑같은 로직
 * ({@link applyAnnotationOp})에 먹이고, 두 문서를 비교한다. 브라우저·LiveKit·Egress를 실제로 띄우는
 * 검증은 아니지만, 지금까지 버그가 살던 자리는 전부 이 안에 있다.
 */

const updateScene = vi.fn()
let excalidrawProps: Record<string, unknown> = {}
let sceneElements: Array<Record<string, unknown>> = []

vi.mock('@/features/live-session/excalidrawRuntime', () => ({
  EXCALIDRAW_ASSET_PATH: '/excalidraw/',
  loadExcalidraw: () => Promise.resolve({
    Excalidraw: (props: Record<string, unknown>) => {
      excalidrawProps = props
      const give = props.excalidrawAPI as ((api: unknown) => void) | undefined
      if (give) {
        give({
          updateScene: (scene: { elements?: Array<Record<string, unknown>> }) => {
            if (scene.elements) sceneElements = scene.elements
            updateScene(scene)
          },
          getAppState: () => ({}),
          getSceneElements: () => sceneElements,
          refresh: () => {},
        })
      }
      return <div data-testid="excalidraw-editor">{props.children as React.ReactNode}</div>
    },
    exportToCanvas: vi.fn(),
    getCommonBounds: vi.fn(() => [0, 0, 100, 100]),
    CaptureUpdateAction: { IMMEDIATELY: 'IMMEDIATELY', NEVER: 'NEVER', EVENTUALLY: 'EVENTUALLY' },
    MainMenu: Object.assign(
      ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
      {
        Separator: () => <hr />,
        Item: ({ children, onSelect }: { children?: React.ReactNode; onSelect?: () => void }) => (
          <button type="button" onClick={onSelect}>{children}</button>
        ),
        DefaultItems: {
          ToggleTheme: () => <button type="button">테마</button>,
          ClearCanvas: () => <button type="button">전체 지우기</button>,
          Help: () => <button type="button">도움말</button>,
          Export: () => <button type="button">내보내기</button>,
          SaveAsImage: () => <button type="button">이미지 저장</button>,
          LoadScene: () => <button type="button">열기</button>,
          LiveCollaborationTrigger: () => <button type="button">협업</button>,
        },
      },
    ),
  }),
}))

const liveKit = vi.hoisted(() => {
  const localParticipant = {
    isCameraEnabled: false,
    isMicrophoneEnabled: false,
    isScreenShareEnabled: false,
    metadata: undefined as string | undefined,
    getTrackPublication: vi.fn(),
    setCameraEnabled: vi.fn(async () => {}),
    setMicrophoneEnabled: vi.fn(async () => {}),
    setScreenShareEnabled: vi.fn(async () => {}),
    setMetadata: vi.fn(async () => {}),
    publishData: vi.fn<(payload: Uint8Array, options?: { topic?: string }) => Promise<void>>(async () => {}),
  }
  const room = {
    localParticipant,
    state: 'connected',
    on: vi.fn(),
    off: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  }
  room.on.mockImplementation(() => room)
  room.off.mockImplementation(() => room)
  return { localParticipant, room }
})

const liveSessionApi = vi.hoisted(() => ({
  preparePreflightRoom: vi.fn(),
  getInstructorLiveToken: vi.fn(),
}))

vi.mock('@/shared/config/runtime', () => ({ isMockApiEnabled: false, isTestMode: true }))
vi.mock('@/features/live-session/liveSessionService', () => liveSessionApi)
vi.mock('@/shared/api/client', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/shared/api/client')),
  resolveCsrfHeader: async () => ({}),
}))

vi.mock('livekit-client', () => ({
  LocalVideoTrack: class LocalVideoTrack {},
  MediaDeviceFailure: { PermissionDenied: 'PermissionDenied', NotFound: 'NotFound', DeviceInUse: 'DeviceInUse', getFailure: vi.fn() },
  VideoPresets: {
    h1080: { resolution: { width: 1920, height: 1080 }, encoding: { maxBitrate: 3_000_000 } },
    h720: { resolution: { width: 1280, height: 720 }, encoding: { maxBitrate: 1_700_000 } },
    h540: { resolution: { width: 960, height: 540 }, encoding: { maxBitrate: 1_000_000 } },
  },
  ScreenSharePresets: {
    h1080fps30: { resolution: { width: 1920, height: 1080 }, encoding: { maxBitrate: 5_000_000 } },
    h1080fps15: { resolution: { width: 1920, height: 1080 }, encoding: { maxBitrate: 2_500_000 } },
    h720fps30: { resolution: { width: 1280, height: 720 }, encoding: { maxBitrate: 3_000_000 } },
  },
  Room: vi.fn(() => liveKit.room),
  RoomEvent: {
    Reconnecting: 'Reconnecting', Reconnected: 'Reconnected', Disconnected: 'Disconnected',
    MediaDevicesError: 'MediaDevicesError', LocalTrackPublished: 'LocalTrackPublished',
    LocalTrackUnpublished: 'LocalTrackUnpublished', TrackMuted: 'TrackMuted', TrackUnmuted: 'TrackUnmuted',
    ParticipantConnected: 'ParticipantConnected',
  },
  Track: { Source: { Camera: 'Camera', ScreenShare: 'ScreenShare' } },
}))

/**
 * 서버(§3-6d)를 대신한다. 계약에 적힌 것만 한다 — `(sessionId, revision)` 멱등 적재, 마지막
 * 스냅샷과 그 이후 op만 돌려주는 복원, 서버가 정하는 `nextRevision`.
 */
function fakeServer() {
  const rows: { revision: number; opType: string; payload: string }[] = []
  /** 판서 표시 상태(ADR-0056). op가 아니라 세션에 붙는 값이라 따로 둔다. */
  const state = { visible: false }
  return {
    rows,
    state,
    async handle(url: string, init?: RequestInit): Promise<Response> {
      if (init && init.method === 'PUT') {
        state.visible = (JSON.parse(String(init.body)) as { visible: boolean }).visible
        return new Response(null, { status: 204 })
      }
      if (!init || (init.method ?? 'GET') === 'GET') {
        const lastSnapshot = [...rows].reverse().find((r) => r.opType === 'snapshot')
        const from = lastSnapshot?.revision ?? 0
        const after = rows.filter((r) => r.revision > from)
        const revision = after.length > 0 ? after[after.length - 1].revision : from
        return new Response(JSON.stringify({
          revision,
          nextRevision: (rows.reduce((max, r) => Math.max(max, r.revision), 0)) + 1,
          snapshotPayload: lastSnapshot?.payload ?? null,
          ops: after,
          visible: state.visible,
        }), { status: 200 })
      }
      for (const op of JSON.parse(String(init.body)) as { revision: number; opType: string; payload: string }[]) {
        if (rows.some((r) => r.revision === op.revision)) continue
        rows.push({ revision: op.revision, opType: op.opType, payload: op.payload })
      }
      rows.sort((a, b) => a.revision - b.revision)
      return new Response(null, { status: 202 })
    },
  }
}

/**
 * 수신 측(Egress)과 같은 로직. 발행된 op를 순서대로 얹어 문서를 만든다.
 *
 * <p><b>포인터를 만나면 서버에서 받아간다</b>(ADR-0055). 강사는 더 이상 문서 전체를 데이터 채널로
 * 밀지 않으므로, 발행된 op만 접어서는 수신 측 문서가 나오지 않는다 — 실제 Egress가 하는 그대로
 * {@link pullAnnotationDocument}를 부른다(전역 fetch가 이 테스트의 가짜 서버로 가 있다).
 *
 * <p>`joinedAt`은 이 수신자가 <b>합류한 시점</b>이다(그때까지의 publish 횟수). Egress는 강의를 시작할
 * 때 방에 들어오므로 강사 페이지가 접속하며 낸 op를 <b>받지 못한다</b> — 처음부터 다 본다고 두면
 * 늦게 합류한 수신자에게만 생기는 어긋남을 통째로 놓친다.
 */
async function receiverDocument(joinedAt = 0): Promise<AnnotationDocument> {
  let document = emptyAnnotationDocument()
  for (const [payload, options] of liveKit.localParticipant.publishData.mock.calls.slice(joinedAt)) {
    if ((options as { topic?: string } | undefined)?.topic !== ANNOTATION_TOPIC) continue
    const op = decodeAnnotationOp(payload)
    if (!op) continue
    if (op.type === 'pointer') {
      const pulled = await pullAnnotationDocument({ sessionId: 'ses-1', livekitToken: 't' })
      // 받아오지 못하면 번호만 맞추고 이어 그린다 — EgressAnnotationLayer와 같은 처리다.
      document = pulled ? applyPulledDocument(pulled, op.revision) : { ...document, revision: op.revision }
      continue
    }
    document = applyAnnotationOp(document, op).document
  }
  return document
}

/** 그때 이후 판서 topic으로 나간 것들. 크기까지 보려고 payload를 함께 준다. */
function publishedSince(from: number): { op: AnnotationOp; bytes: number }[] {
  const out: { op: AnnotationOp; bytes: number }[] = []
  for (const [payload, options] of liveKit.localParticipant.publishData.mock.calls.slice(from)) {
    if ((options as { topic?: string } | undefined)?.topic !== ANNOTATION_TOPIC) continue
    const op = decodeAnnotationOp(payload)
    if (op) out.push({ op, bytes: payload.length })
  }
  return out
}

/** 지금 합류하는 수신자의 시작점. */
function joinNow(): number {
  return liveKit.localParticipant.publishData.mock.calls.length
}

function element(id: string, version: number): AnnotationElement {
  return { id, type: 'freedraw', version, index: `a${version}` } as AnnotationElement
}

describe('판서 한 바퀴 — 강사가 그린 것이 수신 측에서 같은 문서가 된다', () => {
  let server: ReturnType<typeof fakeServer>

  beforeEach(() => {
    server = fakeServer()
    sceneElements = []
    excalidrawProps = {}
    liveKit.localParticipant.publishData.mockClear()
    liveKit.room.connect.mockResolvedValue(undefined)
    liveKit.room.disconnect.mockResolvedValue(undefined)
    liveSessionApi.preparePreflightRoom.mockResolvedValue({ sessionId: 'ses-1', roomName: 'r', roomSid: 'RM_1' })
    liveSessionApi.getInstructorLiveToken.mockResolvedValue({ token: 't', wsUrl: 'wss://x' })
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => server.handle(String(url), init)))
  })

  async function renderStage() {
    const { default: InstructorLiveMediaProvider } = await import('@/features/live-session/InstructorLiveMediaProvider')
    const { default: InstructorLiveKitStage } = await import('@/features/live-session/InstructorLiveKitStage')
    return render(
      <MemoryRouter initialEntries={['/instructor/live-sessions/ses-1/classroom']}>
        <Routes>
          <Route
            path="/instructor/live-sessions/:sessionId/classroom"
            element={(
              <InstructorLiveMediaProvider>
                <InstructorLiveKitStage lessonTitle="강의" participantCount={1} sessionId="ses-1" onRequestEnd={vi.fn()} />
              </InstructorLiveMediaProvider>
            )}
          />
        </Routes>
      </MemoryRouter>,
    )
  }

  /** 판서 토글. 자동으로 켜지는 경우(복원)에는 부르지 않는다. */
  function turnAnnotationOn(getByRole: ReturnType<typeof render>['getByRole']) {
    const toggle = getByRole('button', { name: '판서' })
    if (toggle.getAttribute('aria-pressed') === 'false') toggle.click()
  }

  function draw(elements: AnnotationElement[]) {
    const onChange = excalidrawProps.onChange as (els: readonly AnnotationElement[]) => void
    onChange(elements)
  }

  /**
   * 새 세션이 아니어도(= 서버에 이미 op가 있어 강사가 높은 번호부터 매겨도) 첫 획부터 수신 측에
   * 나타나야 한다. 기준점 스냅샷이 없으면 전부 "중간이 빠졌다"로 버려진다.
   */
  it('서버에 이미 op가 있어도 첫 획부터 수신 측에 나타난다', async () => {
    // preflight에서 이미 두 건을 썼다고 두면 강사는 3번부터 매긴다.
    server.rows.push({ revision: 1, opType: 'snapshot', payload: '{"elements":[]}' })
    server.rows.push({ revision: 2, opType: 'snapshot', payload: '{"elements":[]}' })

    const { getByRole, findByRole } = await renderStage()
    await findByRole('button', { name: '판서' })
    await waitFor(() => { expect(liveKit.localParticipant.publishData).toHaveBeenCalled() })

    // Egress는 강의를 시작할 때 들어온다 — 강사 페이지가 접속하며 낸 복원 스냅샷은 받지 못한다.
    const egressJoined = joinNow()

    turnAnnotationOn(getByRole)
    await waitFor(() => { expect(excalidrawProps.onChange).toBeDefined() })

    draw([element('첫획', 1)])

    await waitFor(async () => {
      expect(visibleAnnotationElements(await receiverDocument(egressJoined)).map((e) => e.id)).toEqual(['첫획'])
    })
  })

  /**
   * 강사가 판서를 껐다 켜는 것은 <b>감추기</b>다. 문서를 지우는 것이 아니므로, 다시 켜면 수신 측에도
   * 그대로 돌아와야 한다.
   */
  it('판서를 껐다 켜도 수신 측 문서가 강사의 것과 같아진다', async () => {
    const { getByRole, findByRole } = await renderStage()
    await findByRole('button', { name: '판서' })
    await waitFor(() => { expect(liveKit.localParticipant.publishData).toHaveBeenCalled() })

    turnAnnotationOn(getByRole)
    await waitFor(() => { expect(excalidrawProps.onChange).toBeDefined() })
    draw([element('a', 1), element('b', 1)])

    const toggle = getByRole('button', { name: '판서' })
    toggle.click()   // 끄기 → clear(감추기)
    await waitFor(async () => { expect(visibleAnnotationElements(await receiverDocument())).toHaveLength(0) })

    toggle.click()   // 다시 켜기
    await waitFor(async () => {
      expect(visibleAnnotationElements(await receiverDocument()).map((e) => e.id)).toEqual(['a', 'b'])
    })
  })

  /**
   * 새로고침 = 페이지가 통째로 다시 뜬다. 서버에 남은 것으로 복원해 <b>강사 화면과 수신 측이 모두</b>
   * 이전과 같아져야 한다. 여기가 지금까지 계속 어긋나던 자리다.
   */
  it('새로고침해도 강사 화면과 수신 측이 모두 그대로 돌아온다', async () => {
    const first = await renderStage()
    await first.findByRole('button', { name: '판서' })
    await waitFor(() => { expect(liveKit.localParticipant.publishData).toHaveBeenCalled() })

    turnAnnotationOn(first.getByRole)
    await waitFor(() => { expect(excalidrawProps.onChange).toBeDefined() })
    draw([element('a', 1), element('b', 1)])
    // 판서를 끈 채로 떠난다 — clear를 저장하던 시절 판서가 통째로 사라지던 경로다.
    first.getByRole('button', { name: '판서' }).click()

    // 새로고침이 실제로 하는 일: 페이지가 사라지기 직전에 밀린 기록을 비운다.
    window.dispatchEvent(new Event('pagehide'))
    await waitFor(() => { expect(server.rows.some((r) => r.opType === 'upsert')).toBe(true) })
    // `clear`는 감추기지 지우기가 아니다. 저장되면 복원했을 때 판서가 통째로 사라진다.
    expect(server.rows.some((r) => r.opType === 'clear')).toBe(false)

    first.unmount()
    liveKit.localParticipant.publishData.mockClear()
    sceneElements = []
    excalidrawProps = {}

    const second = await renderStage()

    /*
     * <b>강사가 끈 채로 떠났으면 꺼진 채로 돌아온다</b>(ADR-0056).
     *
     * <p>예전에는 "저장된 요소가 있으면 켠다"라서 강사의 선택이 무시됐다. 표시 상태를 세션에
     * 남기면서 그 선택이 그대로 돌아온다 — 영속화의 목적이 원래 그것이다.
     */
    await waitFor(() => {
      expect(second.getByRole('button', { name: '판서' }).getAttribute('aria-pressed')).toBe('false')
    })

    // 그리고 켜면 이전에 그린 것이 그대로 나온다.
    second.getByRole('button', { name: '판서' }).click()
    await waitFor(() => {
      expect(sceneElements.map((e) => e.id)).toEqual(['a', 'b'])
    })

    // 수신 측: 같은 문서로 수렴한다.
    await waitFor(async () => {
      expect(visibleAnnotationElements(await receiverDocument()).map((e) => e.id)).toEqual(['a', 'b'])
    })

    // 그리고 <b>다음</b> 새로고침도 살아남아야 한다. 서버에 남은 것만으로 접었을 때 판서가 그대로여야
    // 한다 — 이 검사가 없으면 이번 페이지에서는 멀쩡해 보이고 다음 번에야 드러나는 어긋남을 놓친다.
    window.dispatchEvent(new Event('pagehide'))
    await waitFor(async () => {
      const stored = await pullAnnotationDocument({ sessionId: 'ses-1', livekitToken: 't' })
      expect(visibleAnnotationElements(stored!).map((e) => e.id)).toEqual(['a', 'b'])
    })
    // 빈 스냅샷은 한 건도 저장되면 안 된다. 복원은 마지막 스냅샷부터 접으므로, 그런 op가 마지막에
    // 앉는 순간 그 앞의 판서가 통째로 사라진다 — 뒤에 내용 스냅샷이 따라붙느냐에 기대면 안 된다.
    const empties = server.rows.filter(
      (r) => r.opType === 'snapshot' && JSON.parse(r.payload).elements.length === 0)
    expect(empties).toHaveLength(0)
  })

  /**
   * <b>전체 상태를 알리는 크기가 판서 길이에 비례하면 안 된다</b>(ADR-0055).
   *
   * <p>이것이 이 변경의 이유다. 예전에는 참가자가 들어올 때마다 문서 전체를 데이터 채널로 밀었고,
   * 실측에서 요소 53개 + 수식 1개가 74,952 B로 한도(65,536 B)의 114%였다. 넘으면 전송이 통째로
   * 실패해 <b>수강생 화면에 판서가 아예 나오지 않는다</b> — 강사 화면에는 멀쩡히 보이므로 알아챌 수
   * 없다. 좌표 정밀도를 다듬어 85%까지 내렸지만 그건 절벽에서 한 걸음 물러난 것일 뿐이다.
   *
   * <p>그래서 여기서 고정하는 것은 "작다"가 아니라 <b>"커지지 않는다"</b>이다.
   */
  it('전체 상태를 알리는 크기는 판서가 길어져도 늘지 않는다', async () => {
    const { getByRole, findByRole } = await renderStage()
    await findByRole('button', { name: '판서' })
    await waitFor(() => { expect(liveKit.localParticipant.publishData).toHaveBeenCalled() })

    turnAnnotationOn(getByRole)
    await waitFor(() => { expect(excalidrawProps.onChange).toBeDefined() })

    const toggle = getByRole('button', { name: '판서' })
    const announceAgain = async () => {
      toggle.click()   // 끄기
      // 한 tick 쉰다. 같은 tick에 껐다 켜면 React가 한 번의 갱신으로 합쳐 `active`가 바뀌지 않는다.
      await waitFor(() => { expect(toggle.getAttribute('aria-pressed')).toBe('false') })
      const from = joinNow()
      toggle.click()   // 켜기 → 전체 상태를 다시 알린다
      await waitFor(() => {
        expect(publishedSince(from).some((p) => p.op.type === 'pointer' || p.op.type === 'snapshot')).toBe(true)
      })
      const announced = publishedSince(from).find((p) => p.op.type === 'pointer' || p.op.type === 'snapshot')!
      return announced
    }

    draw([element('a', 1)])
    const small = await announceAgain()

    // 획 하나가 아니라 60개짜리 판서. 요소마다 좌표가 길게 붙는 실제 freedraw에 가깝게 만든다.
    const many = Array.from({ length: 60 }, (_, i) => ({
      ...element(`e${i}`, 1),
      points: Array.from({ length: 40 }, (_, k) => [k * 1.5, k * 2.25]),
    })) as AnnotationElement[]
    draw(many)
    const big = await announceAgain()

    // 문서를 실었다면 이 둘의 크기가 수십 배 벌어진다.
    expect(small.op.type).toBe('pointer')
    expect(big.op.type).toBe('pointer')
    // 문서를 실었다면 수십 배 벌어진다. revision 자릿수가 늘어 몇 바이트 차이 나는 것은 무관하다.
    expect(big.bytes - small.bytes).toBeLessThanOrEqual(4)
    expect(big.bytes).toBeLessThan(200)
  })

  /**
   * 포인터는 <b>"여기까지의 상태는 서버에 있다"는 약속</b>이다. 저장이 밀려 있는데 그대로 내면
   * 수신 측이 받는 문서에 마지막 몇 획이 빠지고, 그 뒤 델타와 이어지지 않아 이후 op가 전부 버려진다 —
   * 강사 화면에는 그려지는데 녹화에는 나타나지 않는다. 지킬 수 없으면 예전처럼 스냅샷을 민다.
   */
  it('저장이 밀려 있으면 포인터 대신 스냅샷으로 물러선다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { getByRole, findByRole } = await renderStage()
    await findByRole('button', { name: '판서' })
    await waitFor(() => { expect(liveKit.localParticipant.publishData).toHaveBeenCalled() })

    turnAnnotationOn(getByRole)
    await waitFor(() => { expect(excalidrawProps.onChange).toBeDefined() })
    draw([element('a', 1)])

    // 이제부터 서버가 op를 받지 않는다.
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (
      init && (init.method ?? 'GET') !== 'GET'
        ? new Response(null, { status: 500 })
        : server.handle(String(url), init)
    )))

    const toggle = getByRole('button', { name: '판서' })
    toggle.click()
    await waitFor(() => { expect(toggle.getAttribute('aria-pressed')).toBe('false') })
    const from = joinNow()
    toggle.click()

    await waitFor(() => {
      const announced = publishedSince(from).find((p) => p.op.type === 'pointer' || p.op.type === 'snapshot')
      expect(announced?.op.type).toBe('snapshot')
    })
    // 그리고 그 스냅샷에는 지금 그린 것이 들어 있다 — 수신 측이 이것만으로 맞춰야 하기 때문이다.
    const announced = publishedSince(from).find((p) => p.op.type === 'snapshot')!
    expect((announced.op as { elements: AnnotationElement[] }).elements.map((e) => e.id)).toEqual(['a'])

    warn.mockRestore()
  })
})
