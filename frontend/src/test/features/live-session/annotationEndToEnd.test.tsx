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
} from '@/features/live-session/annotation'

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
        })
      }
      return <div data-testid="excalidraw-editor">{props.children as React.ReactNode}</div>
    },
    exportToCanvas: vi.fn(),
    getCommonBounds: vi.fn(() => [0, 0, 100, 100]),
    MainMenu: Object.assign(
      ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
      {
        Separator: () => <hr />,
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
  return {
    rows,
    async handle(url: string, init?: RequestInit): Promise<Response> {
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
 * <p>`joinedAt`은 이 수신자가 <b>합류한 시점</b>이다(그때까지의 publish 횟수). Egress는 강의를 시작할
 * 때 방에 들어오므로 강사 페이지가 접속하며 낸 op를 <b>받지 못한다</b> — 처음부터 다 본다고 두면
 * 늦게 합류한 수신자에게만 생기는 어긋남을 통째로 놓친다.
 */
function receiverDocument(joinedAt = 0): AnnotationDocument {
  let document = emptyAnnotationDocument()
  for (const [payload, options] of liveKit.localParticipant.publishData.mock.calls.slice(joinedAt)) {
    if ((options as { topic?: string } | undefined)?.topic !== ANNOTATION_TOPIC) continue
    const op = decodeAnnotationOp(payload)
    if (!op) continue
    document = applyAnnotationOp(document, op).document
  }
  return document
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
    const toggle = getByRole('button', { name: /^판서 (켜짐|꺼짐)$/ })
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
    await findByRole('button', { name: /^판서 (켜짐|꺼짐)$/ })
    await waitFor(() => { expect(liveKit.localParticipant.publishData).toHaveBeenCalled() })

    // Egress는 강의를 시작할 때 들어온다 — 강사 페이지가 접속하며 낸 복원 스냅샷은 받지 못한다.
    const egressJoined = joinNow()

    turnAnnotationOn(getByRole)
    await waitFor(() => { expect(excalidrawProps.onChange).toBeDefined() })

    draw([element('첫획', 1)])

    expect(visibleAnnotationElements(receiverDocument(egressJoined)).map((e) => e.id)).toEqual(['첫획'])
  })

  /**
   * 강사가 판서를 껐다 켜는 것은 <b>감추기</b>다. 문서를 지우는 것이 아니므로, 다시 켜면 수신 측에도
   * 그대로 돌아와야 한다.
   */
  it('판서를 껐다 켜도 수신 측 문서가 강사의 것과 같아진다', async () => {
    const { getByRole, findByRole } = await renderStage()
    await findByRole('button', { name: /^판서 (켜짐|꺼짐)$/ })
    await waitFor(() => { expect(liveKit.localParticipant.publishData).toHaveBeenCalled() })

    turnAnnotationOn(getByRole)
    await waitFor(() => { expect(excalidrawProps.onChange).toBeDefined() })
    draw([element('a', 1), element('b', 1)])

    const toggle = getByRole('button', { name: /^판서 (켜짐|꺼짐)$/ })
    toggle.click()   // 끄기 → clear(감추기)
    await waitFor(() => { expect(visibleAnnotationElements(receiverDocument())).toHaveLength(0) })

    toggle.click()   // 다시 켜기
    await waitFor(() => {
      expect(visibleAnnotationElements(receiverDocument()).map((e) => e.id)).toEqual(['a', 'b'])
    })
  })

  /**
   * 새로고침 = 페이지가 통째로 다시 뜬다. 서버에 남은 것으로 복원해 <b>강사 화면과 수신 측이 모두</b>
   * 이전과 같아져야 한다. 여기가 지금까지 계속 어긋나던 자리다.
   */
  it('새로고침해도 강사 화면과 수신 측이 모두 그대로 돌아온다', async () => {
    const first = await renderStage()
    await first.findByRole('button', { name: /^판서 (켜짐|꺼짐)$/ })
    await waitFor(() => { expect(liveKit.localParticipant.publishData).toHaveBeenCalled() })

    turnAnnotationOn(first.getByRole)
    await waitFor(() => { expect(excalidrawProps.onChange).toBeDefined() })
    draw([element('a', 1), element('b', 1)])
    // 판서를 끈 채로 떠난다 — clear를 저장하던 시절 판서가 통째로 사라지던 경로다.
    first.getByRole('button', { name: /^판서 (켜짐|꺼짐)$/ }).click()

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

    // 강사 화면: 판서가 자동으로 켜지고 에디터에 그림이 돌아온다.
    await waitFor(() => {
      expect(second.getByRole('button', { name: /^판서 (켜짐|꺼짐)$/ }).getAttribute('aria-pressed')).toBe('true')
    })
    await waitFor(() => {
      expect(sceneElements.map((e) => e.id)).toEqual(['a', 'b'])
    })

    // 수신 측: 같은 문서로 수렴한다.
    await waitFor(() => {
      expect(visibleAnnotationElements(receiverDocument()).map((e) => e.id)).toEqual(['a', 'b'])
    })

    // 그리고 <b>다음</b> 새로고침도 살아남아야 한다. 복원은 마지막 스냅샷부터 접으므로, 접속하며
    // 나가는 빈 기준점 스냅샷이 저장되면 그 앞의 판서가 통째로 사라진다 — 이번 페이지에서는 멀쩡해
    // 보이고 다음 번에야 드러난다.
    window.dispatchEvent(new Event('pagehide'))
    await waitFor(() => {
      expect(server.rows.some((r) => r.opType === 'snapshot')).toBe(true)
    })
    // 빈 스냅샷은 한 건도 저장되면 안 된다. 복원은 마지막 스냅샷부터 접으므로, 그런 op가 마지막에
    // 앉는 순간 그 앞의 판서가 통째로 사라진다 — 뒤에 내용 스냅샷이 따라붙느냐에 기대면 안 된다.
    const empties = server.rows.filter(
      (r) => r.opType === 'snapshot' && JSON.parse(r.payload).elements.length === 0)
    expect(empties).toHaveLength(0)
  })
})
