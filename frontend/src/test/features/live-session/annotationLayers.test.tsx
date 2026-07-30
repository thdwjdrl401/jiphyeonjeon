import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Room } from 'livekit-client'
import { RoomEvent } from 'livekit-client'
import {
  ANNOTATION_TOPIC,
  encodeAnnotationOp,
  type AnnotationChange,
  type AnnotationOp,
} from '@/features/live-session/annotation'

/**
 * Excalidraw는 초기 로드에서 떼어 낸 무거운 청크다(+2.4MB). 테스트에서 실제로 불러오면 느려지고,
 * jsdom에는 캔버스 렌더가 없어 어차피 그림을 검증할 수 없다. 우리가 검증할 것은 <b>배선</b>이다 —
 * 무엇을 언제 내보내고, 받은 op를 어떤 좌표로 얹는지.
 */
const exportToCanvas = vi.fn()
const getCommonBounds = vi.fn()
let excalidrawProps: Record<string, unknown> = {}

vi.mock('@/features/live-session/excalidrawRuntime', () => ({
  EXCALIDRAW_ASSET_PATH: '/excalidraw/',
  loadExcalidraw: () => Promise.resolve({
    Excalidraw: (props: Record<string, unknown>) => {
      excalidrawProps = props
      return <div data-testid="excalidraw-editor" />
    },
    exportToCanvas,
    getCommonBounds,
  }),
}))

const { default: InstructorAnnotationLayer } = await import('@/features/live-session/InstructorAnnotationLayer')
const { default: EgressAnnotationLayer } = await import('@/features/live-session/EgressAnnotationLayer')

function element(id: string, version: number) {
  return { id, version, type: 'freedraw' }
}

describe('강사 판서 레이어', () => {
  beforeEach(() => {
    excalidrawProps = {}
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('꺼져 있으면 에디터를 붙이지 않는다 — 무거운 청크를 미리 내려받을 이유가 없다', () => {
    const { queryByTestId } = render(
      <InstructorAnnotationLayer active={false} audienceRevision={0} onPublish={vi.fn()} />,
    )

    expect(queryByTestId('excalidraw-editor')).toBeNull()
  })

  it('켜면 에디터를 붙이고 배경을 투명하게 둔다 — 아래 화면공유가 비쳐야 한다', async () => {
    const { findByTestId } = render(
      <InstructorAnnotationLayer active audienceRevision={0} onPublish={vi.fn()} />,
    )
    await findByTestId('excalidraw-editor')

    const initialData = excalidrawProps.initialData as { appState: Record<string, unknown> }
    expect(initialData.appState.viewBackgroundColor).toBe('transparent')
  })

  /**
   * 확대·이동을 허용하면 강사가 보는 자리와 합성에 나가는 자리가 달라진다 — 강사 화면에서는
   * 정상으로 보이므로 눈으로 잡을 수 없다.
   */
  it('배율 1, 스크롤 0으로 시작한다 — 프레임과 1:1로 대응해야 한다', async () => {
    const { findByTestId } = render(
      <InstructorAnnotationLayer active audienceRevision={0} onPublish={vi.fn()} />,
    )
    await findByTestId('excalidraw-editor')

    const initialData = excalidrawProps.initialData as { appState: Record<string, unknown> }
    expect(initialData.appState.zoom).toEqual({ value: 1 })
    expect(initialData.appState.scrollX).toBe(0)
    expect(initialData.appState.scrollY).toBe(0)
  })

  it('바뀐 요소만 내보낸다 — 같은 배열이 다시 와도 다시 보내지 않는다', async () => {
    const onPublish = vi.fn<(change: AnnotationChange) => void>()
    const { findByTestId } = render(
      <InstructorAnnotationLayer active audienceRevision={0} onPublish={onPublish} />,
    )
    await findByTestId('excalidraw-editor')
    const onChange = excalidrawProps.onChange as (elements: unknown[]) => void

    onChange([element('a', 1)])
    expect(onPublish).toHaveBeenCalledTimes(1)
    expect(onPublish).toHaveBeenCalledWith({ type: 'upsert', elements: [element('a', 1)] })

    // Excalidraw는 아무것도 안 바뀌어도 onChange를 부른다(포인터 이동 등).
    onChange([element('a', 1)])
    expect(onPublish).toHaveBeenCalledTimes(1)

    onChange([element('a', 2)])
    expect(onPublish).toHaveBeenCalledTimes(2)
    expect(onPublish).toHaveBeenLastCalledWith({ type: 'upsert', elements: [element('a', 2)] })
  })

  /**
   * 새로 들어온 Egress는 그 전에 흐른 op를 받을 수 없다. 스냅샷을 다시 내지 않으면 판서가 통째로
   * 빈 채로 녹화된다.
   */
  it('새 참가자가 들어오면 전체 스냅샷을 다시 내보낸다', async () => {
    const onPublish = vi.fn<(change: AnnotationChange) => void>()
    const { findByTestId, rerender } = render(
      <InstructorAnnotationLayer active audienceRevision={0} onPublish={onPublish} />,
    )
    await findByTestId('excalidraw-editor')
    ;(excalidrawProps.onChange as (elements: unknown[]) => void)([element('a', 1), element('b', 1)])
    onPublish.mockClear()

    rerender(<InstructorAnnotationLayer active audienceRevision={1} onPublish={onPublish} />)

    expect(onPublish).toHaveBeenCalledWith({
      type: 'snapshot',
      elements: [element('a', 1), element('b', 1)],
    })
  })

  it('판서가 비어 있으면 스냅샷을 보내지 않는다 — 보낼 것이 없다', async () => {
    const onPublish = vi.fn()
    const { findByTestId, rerender } = render(
      <InstructorAnnotationLayer active audienceRevision={0} onPublish={onPublish} />,
    )
    await findByTestId('excalidraw-editor')

    rerender(<InstructorAnnotationLayer active audienceRevision={1} onPublish={onPublish} />)

    expect(onPublish).not.toHaveBeenCalled()
  })
})

describe('Egress 판서 레이어', () => {
  /** LiveKit Room의 데이터 수신만 흉내낸다. 실제 Room을 띄우지 않고 배선을 본다. */
  function fakeRoom() {
    const handlers = new Map<string, Set<(...args: never[]) => void>>()
    const room = {
      on(event: string, handler: (...args: never[]) => void) {
        if (!handlers.has(event)) handlers.set(event, new Set())
        handlers.get(event)!.add(handler)
        return room
      },
      off(event: string, handler: (...args: never[]) => void) {
        handlers.get(event)?.delete(handler)
        return room
      },
    }
    const receive = (payload: Uint8Array, topic?: string) => {
      for (const handler of handlers.get(RoomEvent.DataReceived) ?? []) {
        (handler as (p: Uint8Array, a?: unknown, b?: unknown, t?: string) => void)(payload, undefined, undefined, topic)
      }
    }
    return { room: room as unknown as Room, receive, handlers }
  }

  function stubCanvas(width: number, height: number) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    exportToCanvas.mockResolvedValue(canvas)
    return canvas
  }

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('판서 op가 없으면 Excalidraw를 불러오지 않는다 — 판서 없는 강의가 청크를 지불할 이유가 없다', () => {
    const { room } = fakeRoom()

    render(<EgressAnnotationLayer room={room} />)

    expect(exportToCanvas).not.toHaveBeenCalled()
  })

  /**
   * `exportToCanvas`는 프레임이 아니라 내용 바운딩 박스를 기준으로 그린다. 오프셋을 보정하지 않으면
   * 획이 늘 때마다 판서가 영상 대비 밀리는데, <b>강사 화면에서는 드러나지 않는다</b>.
   */
  it('받은 op를 렌더하고 바운딩 박스 오프셋을 보정해 얹는다', async () => {
    const { room, receive } = fakeRoom()
    getCommonBounds.mockReturnValue([960, 540, 1920, 1080])
    stubCanvas(960, 540)
    const { container } = render(<EgressAnnotationLayer room={room} />)

    receive(encodeAnnotationOp({ type: 'upsert', revision: 1, elements: [element('a', 1)] }), ANNOTATION_TOPIC)

    await waitFor(() => {
      expect(container.querySelector('canvas')).not.toBeNull()
    })
    const canvas = container.querySelector('canvas')!
    // 오프셋 (960,540) / 프레임 1920x1080 = 50%, 캔버스 960x540 = 50%
    expect(canvas.style.left).toBe('50%')
    expect(canvas.style.top).toBe('50%')
    expect(canvas.style.width).toBe('50%')
    expect(canvas.style.height).toBe('50%')
    expect(canvas.style.position).toBe('absolute')
  })

  it('내용 크기 그대로 export한다 — 늘 1920x1080을 할당하지 않는다', async () => {
    const { room, receive } = fakeRoom()
    getCommonBounds.mockReturnValue([0, 0, 100, 100])
    stubCanvas(100, 100)
    render(<EgressAnnotationLayer room={room} />)

    receive(encodeAnnotationOp({ type: 'upsert', revision: 1, elements: [element('a', 1)] }), ANNOTATION_TOPIC)

    await waitFor(() => { expect(exportToCanvas).toHaveBeenCalled() })
    const options = exportToCanvas.mock.calls[0][0] as {
      exportPadding: number
      appState: { exportBackground: boolean }
      getDimensions: (w: number, h: number) => { width: number; height: number; scale: number }
    }
    expect(options.exportPadding).toBe(0)
    // 배경을 칠하면 아래 화면공유를 덮는다.
    expect(options.appState.exportBackground).toBe(false)
    expect(options.getDimensions(123, 456)).toEqual({ width: 123, height: 456, scale: 1 })
  })

  it('다른 topic은 판서로 해석하지 않는다', async () => {
    const { room, receive } = fakeRoom()
    stubCanvas(10, 10)
    render(<EgressAnnotationLayer room={room} />)

    receive(encodeAnnotationOp({ type: 'upsert', revision: 1, elements: [element('a', 1)] }), 'captions')

    await new Promise((resolve) => { setTimeout(resolve, 0) })
    expect(exportToCanvas).not.toHaveBeenCalled()
  })

  /**
   * 이 컴포넌트는 Egress의 헤드리스 Chrome에서 돈다. 여기서 예외가 나면 녹화 중 화면이 멈춘다 —
   * 판서 한 획을 잃는 것과 강의 녹화가 끊기는 것은 비교할 수 없다.
   */
  it('해석할 수 없는 payload는 예외 없이 버린다', async () => {
    const { room, receive } = fakeRoom()
    stubCanvas(10, 10)
    const { container } = render(<EgressAnnotationLayer room={room} />)

    expect(() => receive(new Uint8Array([0xff, 0x00, 0x13]), ANNOTATION_TOPIC)).not.toThrow()

    await new Promise((resolve) => { setTimeout(resolve, 0) })
    expect(exportToCanvas).not.toHaveBeenCalled()
    expect(container.querySelector('canvas')).toBeNull()
  })

  it('clear를 받으면 판서를 지운다', async () => {
    const { room, receive } = fakeRoom()
    getCommonBounds.mockReturnValue([0, 0, 100, 100])
    stubCanvas(100, 100)
    const { container } = render(<EgressAnnotationLayer room={room} />)

    receive(encodeAnnotationOp({ type: 'upsert', revision: 1, elements: [element('a', 1)] }), ANNOTATION_TOPIC)
    await waitFor(() => { expect(container.querySelector('canvas')).not.toBeNull() })

    receive(encodeAnnotationOp({ type: 'clear', revision: 2 }), ANNOTATION_TOPIC)
    await waitFor(() => { expect(container.querySelector('canvas')).toBeNull() })
  })

  /**
   * 재접속으로 op가 유실되면 revision이 건너뛴다. 그 op를 그대로 적용하면 빠진 획을 모른 채 반쪽짜리
   * 판서가 녹화되므로, 스냅샷이 올 때까지 이전 상태를 유지한다.
   */
  it('revision이 건너뛴 op는 무시하고, 뒤이은 스냅샷으로 복구한다', async () => {
    const { room, receive } = fakeRoom()
    getCommonBounds.mockReturnValue([0, 0, 100, 100])
    stubCanvas(100, 100)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    render(<EgressAnnotationLayer room={room} />)

    receive(encodeAnnotationOp({ type: 'upsert', revision: 1, elements: [element('a', 1)] }), ANNOTATION_TOPIC)
    await waitFor(() => { expect(exportToCanvas).toHaveBeenCalledTimes(1) })

    // revision 2가 유실된 상황
    receive(encodeAnnotationOp({ type: 'upsert', revision: 3, elements: [element('b', 1)] }), ANNOTATION_TOPIC)
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    expect(exportToCanvas).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalled()

    receive(encodeAnnotationOp({
      type: 'snapshot',
      revision: 4,
      elements: [element('a', 1), element('b', 1)],
    }), ANNOTATION_TOPIC)
    await waitFor(() => { expect(exportToCanvas).toHaveBeenCalledTimes(2) })
    const lastElements = (exportToCanvas.mock.calls[1][0] as { elements: unknown[] }).elements
    expect(lastElements).toHaveLength(2)

    warn.mockRestore()
  })

  it('room이 없으면 아무것도 구독하지 않는다', () => {
    expect(() => render(<EgressAnnotationLayer room={null} />)).not.toThrow()
  })

  it('unmount하면 구독을 해제한다 — 녹화가 끝난 뒤 핸들러가 남으면 안 된다', () => {
    const { room, handlers } = fakeRoom()
    const { unmount } = render(<EgressAnnotationLayer room={room} />)
    expect(handlers.get(RoomEvent.DataReceived)?.size).toBe(1)

    unmount()

    expect(handlers.get(RoomEvent.DataReceived)?.size).toBe(0)
  })
})

/** 타입이 맞는지 컴파일 단계에서 확인한다. op 모양이 바뀌면 여기서 먼저 깨진다. */
const _typeCheck: AnnotationOp = { type: 'clear', revision: 1 }
void _typeCheck
