import type React from 'react'
import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Room } from 'livekit-client'
import { RoomEvent } from 'livekit-client'
import {
  ANNOTATION_FRAME_HEIGHT,
  ANNOTATION_FRAME_WIDTH,
  ANNOTATION_TOPIC,
  WHITEBOARD_ELEMENT_ID,
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
const updateScene = vi.fn()
/** getAppState가 돌려줄 상태. 강사가 캔버스를 밀거나 확대한 상황을 흉내내는 데 쓴다. */
let drifted: Record<string, unknown> = {}
/** getSceneElements가 돌려줄 씬. 화이트보드 토글이 기존 요소를 보존하는지 보려면 필요하다. */
let sceneElements: Array<Record<string, unknown>> = []
let excalidrawProps: Record<string, unknown> = {}

vi.mock('@/features/live-session/excalidrawRuntime', () => ({
  EXCALIDRAW_ASSET_PATH: '/excalidraw/',
  loadExcalidraw: () => Promise.resolve({
    Excalidraw: (props: Record<string, unknown>) => {
      excalidrawProps = props
      // 실제 컴포넌트처럼 마운트 시 명령형 API를 넘겨준다.
      const give = props.excalidrawAPI as ((api: unknown) => void) | undefined
      if (give) give({ updateScene, getAppState: () => drifted, getSceneElements: () => sceneElements })
      // 실제 컴포넌트처럼 children(우리가 조립한 MainMenu)을 그린다.
      return <div data-testid="excalidraw-editor">{props.children as React.ReactNode}</div>
    },
    exportToCanvas,
    getCommonBounds,
    // 메뉴는 우리가 조립한다. 어떤 항목을 넣었는지 검증할 수 있게 자식을 그대로 렌더한다.
    MainMenu: Object.assign(
      ({ children }: { children?: React.ReactNode }) => <div data-testid="main-menu">{children}</div>,
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
      <InstructorAnnotationLayer sessionId="ses-1" active={false} audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} restoredElements={null} />,
    )

    expect(queryByTestId('excalidraw-editor')).toBeNull()
  })

  it('켜면 에디터를 붙이고 배경을 투명하게 둔다 — 아래 화면공유가 비쳐야 한다', async () => {
    const { findByTestId } = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} restoredElements={null} />,
    )
    await findByTestId('excalidraw-editor')

    const initialData = excalidrawProps.initialData as { appState: Record<string, unknown> }
    expect(initialData.appState.viewBackgroundColor).toBe('transparent')
  })

  /**
   * 문서 좌표계를 창 크기에서 떼어 내는 핵심 장치.
   *
   * Excalidraw의 scene 단위는 `zoom: 1`일 때 컨테이너 CSS 픽셀이다. 그대로 두면 창이 1000px일 때
   * 화면 중앙에 그은 획이 (500,281)로 기록되고 Egress는 26% 지점에 그린다 — 창 크기를 바꾸면 판서가
   * 영상 위에서 통째로 어긋난다. 실제로 그렇게 배포했고 강사 화면에서는 드러나지 않았다.
   *
   * `zoom = 컨테이너폭 / 1920`, `scroll = 0`이면 scene 좌표가 곧 논리 프레임 좌표가 된다.
   */
  it.each([
    [{ width: 1920, height: 1080 }, 1],
    [{ width: 960, height: 540 }, 0.5],
    [{ width: 480, height: 270 }, 0.25],
    [{ width: 3840, height: 2160 }, 2],
  ])('컨테이너 %o → zoom %s, scroll 0을 적용한다', async (size, expectedZoom) => {
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      ...size, x: 0, y: 0, top: 0, left: 0, right: size.width, bottom: size.height,
      toJSON: () => ({}),
    })

    const { findByTestId } = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} restoredElements={null} />,
    )
    await findByTestId('excalidraw-editor')

    await waitFor(() => { expect(updateScene).toHaveBeenCalled() })
    const applied = updateScene.mock.calls.at(-1)![0] as { appState: Record<string, unknown> }
    expect(applied.appState.zoom).toEqual({ value: expectedZoom })
    expect(applied.appState.scrollX).toBe(0)
    expect(applied.appState.scrollY).toBe(0)

    rect.mockRestore()
  })

  it('컨테이너 크기를 아직 모르면 zoom을 건드리지 않는다 — 0으로 그리면 아무것도 안 보인다', async () => {
    // jsdom 기본값은 0x0이다. 첫 렌더에서 잘못된 배율을 적용하지 않아야 한다.
    const { findByTestId } = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} restoredElements={null} />,
    )
    await findByTestId('excalidraw-editor')

    expect(updateScene).not.toHaveBeenCalled()
  })

  /**
   * 판서는 영상 위에 정확히 겹쳐야 한다. 캔버스가 밀리거나 확대되면 강사가 보는 자리와 합성에 나가는
   * 자리가 갈리는데 <b>강사 화면에서는 정상으로 보인다</b>. 그래서 어떤 경로로든 어긋나면 되돌린다.
   */
  it('스크롤·확대가 밀리면 프레임 매핑으로 되돌린다', async () => {
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 960, height: 540, x: 0, y: 0, top: 0, left: 0, right: 960, bottom: 540,
      toJSON: () => ({}),
    })
    // 강사가 캔버스를 밀고 확대한 상태를 흉내낸다.
    drifted = { zoom: { value: 3 }, scrollX: -120, scrollY: 40 }

    const { findByTestId } = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} restoredElements={null} />,
    )
    await findByTestId('excalidraw-editor')
    updateScene.mockClear()

    // onChange는 appState가 바뀔 때도 불린다(스크롤·확대 포함).
    ;(excalidrawProps.onChange as (elements: unknown[]) => void)([])

    const applied = updateScene.mock.calls.at(-1)![0] as { appState: Record<string, unknown> }
    expect(applied.appState.zoom).toEqual({ value: 0.5 })
    expect(applied.appState.scrollX).toBe(0)
    expect(applied.appState.scrollY).toBe(0)

    drifted = {}
    rect.mockRestore()
  })

  it('이미 맞으면 다시 쓰지 않는다 — 매 onChange마다 updateScene을 부르면 렌더가 요동친다', async () => {
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 960, height: 540, x: 0, y: 0, top: 0, left: 0, right: 960, bottom: 540,
      toJSON: () => ({}),
    })
    drifted = { zoom: { value: 0.5 }, scrollX: 0, scrollY: 0 }

    const { findByTestId } = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} restoredElements={null} />,
    )
    await findByTestId('excalidraw-editor')
    updateScene.mockClear()

    ;(excalidrawProps.onChange as (elements: unknown[]) => void)([])

    expect(updateScene).not.toHaveBeenCalled()

    drifted = {}
    rect.mockRestore()
  })

  /**
   * 메뉴를 직접 조립하는 이유는 기본 메뉴에 강의 판서와 무관하거나 위험한 항목이 섞여 있기 때문이다.
   * 파일 열기는 판서를 통째로 덮어쓰고, 내보내기·이미지 저장은 "수강생에게 보이는 것"과 무관한데
   * 그렇게 오해되기 쉽다. 다시 새어 들어오지 않게 고정한다.
   */
  it('메뉴에는 다크모드·전체 지우기·도움말만 넣는다', async () => {
    const { findByTestId, queryByText } = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} restoredElements={null} />,
    )
    const menu = await findByTestId('main-menu')

    expect(menu.textContent).toContain('테마')
    expect(menu.textContent).toContain('전체 지우기')
    expect(menu.textContent).toContain('도움말')
    for (const forbidden of ['내보내기', '이미지 저장', '열기', '협업']) {
      expect(queryByText(forbidden)).toBeNull()
    }
  })

  /**
   * 이미지 삽입은 데이터 채널로 파일이 흐르지 않아 Egress에 나타나지 않는다 — 강사에게만 보이는
   * 판서를 만들면 강사는 수강생이 본다고 착각한다.
   */
  it('이미지 도구와 위험한 캔버스 액션을 끈다', async () => {
    const { findByTestId } = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} restoredElements={null} />,
    )
    await findByTestId('excalidraw-editor')

    const ui = excalidrawProps.UIOptions as {
      tools: { image: boolean }
      canvasActions: Record<string, boolean>
    }
    expect(ui.tools.image).toBe(false)
    expect(ui.canvasActions.loadScene).toBe(false)
    expect(ui.canvasActions.export).toBe(false)
    expect(ui.canvasActions.saveAsImage).toBe(false)
    // 캔버스 배경을 칠하면 아래 화면공유를 덮는다.
    expect(ui.canvasActions.changeViewBackgroundColor).toBe(false)
  })

  /**
   * "강사가 보는 화면이 곧 수강생이 보는 화면"이라는 규칙. 판서를 끄면 강사 화면에서 사라지므로
   * 수강생 화면에서도 사라져야 한다. `clear`를 보내지 않으면 Egress가 자기 문서를 계속 렌더해
   * <b>강사는 껐다고 믿는데 수강생과 녹화에는 남는다</b>.
   */
  it('판서를 끄면 수강생 화면에서도 감춘다', async () => {
    const onPublish = vi.fn<(change: AnnotationChange) => void>()
    const { findByTestId, rerender } = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={onPublish} restoredElements={null} />,
    )
    await findByTestId('excalidraw-editor')
    ;(excalidrawProps.onChange as (elements: unknown[]) => void)([element('a', 1)])
    onPublish.mockClear()

    rerender(<InstructorAnnotationLayer sessionId="ses-1" active={false} audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={onPublish} restoredElements={null} />)

    expect(onPublish).toHaveBeenCalledWith({ type: 'clear' })
  })

  it('그린 것이 없으면 끌 때 아무것도 보내지 않는다', async () => {
    const onPublish = vi.fn()
    const { findByTestId, rerender } = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={onPublish} restoredElements={null} />,
    )
    await findByTestId('excalidraw-editor')
    onPublish.mockClear()

    rerender(<InstructorAnnotationLayer sessionId="ses-1" active={false} audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={onPublish} restoredElements={null} />)

    expect(onPublish).not.toHaveBeenCalled()
  })

  /**
   * 판서를 껐다 켜면 Excalidraw가 다시 mount되어 씬이 비어서 시작한다. 문서를 되돌려주지 않으면
   * 강사가 그린 것이 사라지고, 더 나쁘게 빈 배열이 diff를 타고 <b>수강생 화면의 판서까지 지운다</b>.
   */
  it('판서를 껐다 켜면 그린 문서를 되돌려준다 — 수강생 판서까지 지우지 않는다', async () => {
    const onPublish = vi.fn<(change: AnnotationChange) => void>()
    const { findByTestId, rerender } = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={onPublish} restoredElements={null} />,
    )
    await findByTestId('excalidraw-editor')
    ;(excalidrawProps.onChange as (elements: unknown[]) => void)([element('a', 1), element('b', 1)])

    // 판서 끄기 → 켜기
    rerender(<InstructorAnnotationLayer sessionId="ses-1" active={false} audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={onPublish} restoredElements={null} />)
    onPublish.mockClear()
    rerender(<InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={onPublish} restoredElements={null} />)
    await findByTestId('excalidraw-editor')

    const initialData = excalidrawProps.initialData as { elements?: Array<{ id: string }> }
    expect(initialData.elements?.map((e) => e.id)).toEqual(['a', 'b'])

    // 다시 켤 때 내보내는 것은 전체 스냅샷 하나뿐이다 — Egress와 상태를 다시 맞추는 자기 복구다.
    expect(onPublish.mock.calls.map(([change]) => change.type)).toEqual(['snapshot'])

    // 복원된 문서로 onChange가 오면 바뀐 것이 없으므로 추가 op가 없다.
    // 특히 <b>delete가 나가면 안 된다</b> — 그게 수강생 판서를 지우던 버그였다.
    onPublish.mockClear()
    ;(excalidrawProps.onChange as (elements: unknown[]) => void)([element('a', 1), element('b', 1)])
    expect(onPublish).not.toHaveBeenCalled()
  })

  /**
   * 화이트보드는 배경색(appState)이 아니라 <b>요소</b>다. 그래야 기존 upsert/delete/스냅샷 경로를
   * 그대로 타서 Egress가 아무 변경 없이 그린다 — 배경색은 데이터 채널로 흐르지 않는다.
   */
  describe('화이트보드', () => {
    function renderWithBoard(whiteboard: boolean) {
      return render(
        <InstructorAnnotationLayer sessionId="ses-1"
          active
          audienceRevision={0}
          showPropertyPanel={false}
          whiteboard={whiteboard}
          onLaser={vi.fn()} onPublish={vi.fn()} restoredElements={null}
        />,
      )
    }

    it('켜면 프레임 전체를 덮는 잠긴 요소를 맨 앞에 넣는다', async () => {
      sceneElements = [{ id: 'stroke-1', version: 1 }]
      const { findByTestId } = renderWithBoard(true)
      await findByTestId('excalidraw-editor')

      await waitFor(() => {
        expect(updateScene.mock.calls.some((call) => (call[0] as { elements?: unknown[] }).elements)).toBe(true)
      })
      const applied = updateScene.mock.calls
        .map((call) => call[0] as { elements?: Array<Record<string, unknown>> })
        .filter((arg) => arg.elements)
        .at(-1)!
      const board = applied.elements![0]

      // 맨 앞이어야 한다 — 뒤에 넣으면 이미 그린 획을 덮는다.
      expect(board.id).toBe(WHITEBOARD_ELEMENT_ID)
      expect(board.width).toBe(ANNOTATION_FRAME_WIDTH)
      expect(board.height).toBe(ANNOTATION_FRAME_HEIGHT)
      expect(board.x).toBe(0)
      expect(board.y).toBe(0)
      // 잠그지 않으면 강사가 판서하려다 판을 선택해 끌어버린다.
      expect(board.locked).toBe(true)
      expect(board.backgroundColor).toBe('#ffffff')
      // 기존 획은 보존한다.
      expect(applied.elements!.map((e) => e.id)).toContain('stroke-1')
      sceneElements = []
    })

    it('끄면 그 요소만 빼고 나머지는 남긴다', async () => {
      sceneElements = [{ id: WHITEBOARD_ELEMENT_ID, version: 1 }, { id: 'stroke-1', version: 1 }]
      const { findByTestId } = renderWithBoard(false)
      await findByTestId('excalidraw-editor')

      await waitFor(() => {
        expect(updateScene.mock.calls.some((call) => (call[0] as { elements?: unknown[] }).elements)).toBe(true)
      })
      const applied = updateScene.mock.calls
        .map((call) => call[0] as { elements?: Array<Record<string, unknown>> })
        .filter((arg) => arg.elements)
        .at(-1)!

      expect(applied.elements!.map((e) => e.id)).toEqual(['stroke-1'])
      sceneElements = []
    })

    it('이미 원하는 상태면 손대지 않는다 — 매 렌더마다 씬을 갈아치우면 판서가 깜빡인다', async () => {
      sceneElements = [{ id: 'stroke-1', version: 1 }]
      const { findByTestId } = renderWithBoard(false)
      await findByTestId('excalidraw-editor')

      const sceneWrites = updateScene.mock.calls.filter((call) => (call[0] as { elements?: unknown[] }).elements)
      expect(sceneWrites).toHaveLength(0)
      sceneElements = []
    })
  })

  /**
   * 레이저는 scene 요소가 아니라 판서 op 경로로는 수강생에게 도달하지 않는다. 포인터 좌표를 직접
   * 주워 별도 경로로 보내되, <b>레이저 도구가 활성일 때만</b> 보낸다 — 아니면 판서 중 포인터 이동까지
   * 전부 흘러 나간다.
   */
  describe('레이저 중계', () => {
    // jsdom에는 PointerEvent가 없다. 우리가 읽는 것은 clientX/clientY뿐이라 MouseEvent로 충분하다.
    function pointer(target: EventTarget, type: string) {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: 480, clientY: 270 }))
    }

    function renderLaser(onLaser: ReturnType<typeof vi.fn>) {
      return render(
        <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={onLaser} onPublish={vi.fn()} restoredElements={null} />,
      )
    }

    const rect = () => vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 960, height: 540, x: 0, y: 0, top: 0, left: 0, right: 960, bottom: 540, toJSON: () => ({}),
    })

    /**
     * Excalidraw는 누르고 있는 동안만 궤적을 만든다. 그냥 움직일 때도 보내면 강사 화면에는 아무것도
     * 없는데 수강생 화면에만 궤적이 생긴다 — "강사가 보는 화면 = 수강생이 보는 화면" 위반이다.
     */
    it('누르지 않고 움직이면 아무것도 보내지 않는다', async () => {
      const restore = rect()
      const onLaser = vi.fn()
      drifted = { zoom: { value: 0.5 }, scrollX: 0, scrollY: 0, activeTool: { type: 'laser' } }

      const { container, findByTestId } = renderLaser(onLaser)
      await findByTestId('excalidraw-editor')
      pointer(container.querySelector('.instructor-annotation-layer')!, 'pointermove')
      await new Promise((resolve) => { requestAnimationFrame(() => resolve(null)) })

      expect(onLaser).not.toHaveBeenCalled()
      drifted = {}
      restore.mockRestore()
    })

    it('레이저 도구가 아니면 눌러도 보내지 않는다', async () => {
      const restore = rect()
      const onLaser = vi.fn()
      drifted = { zoom: { value: 0.5 }, scrollX: 0, scrollY: 0, activeTool: { type: 'freedraw' } }

      const { container, findByTestId } = renderLaser(onLaser)
      await findByTestId('excalidraw-editor')
      const host = container.querySelector('.instructor-annotation-layer')!
      pointer(host, 'pointerdown')
      pointer(host, 'pointermove')
      await new Promise((resolve) => { requestAnimationFrame(() => resolve(null)) })

      expect(onLaser).not.toHaveBeenCalled()
      drifted = {}
      restore.mockRestore()
    })

    it('누른 뒤 움직이고 떼면 start·move·end를 순서대로 보낸다', async () => {
      const restore = rect()
      const onLaser = vi.fn()
      drifted = { zoom: { value: 0.5 }, scrollX: 0, scrollY: 0, activeTool: { type: 'laser' } }

      const { container, findByTestId } = renderLaser(onLaser)
      await findByTestId('excalidraw-editor')
      const host = container.querySelector('.instructor-annotation-layer')!

      pointer(host, 'pointerdown')
      pointer(host, 'pointermove')
      pointer(host, 'pointermove')
      await new Promise((resolve) => { requestAnimationFrame(() => resolve(null)) })
      pointer(window, 'pointerup')

      const phases = onLaser.mock.calls.map(([stroke]) => (stroke as { phase: string }).phase)
      expect(phases).toEqual(['start', 'move', 'end'])
      // 화면 (480,270)은 zoom 0.5에서 프레임 중앙 (960,540)이다.
      const first = onLaser.mock.calls[0][0] as { points: Array<{ x: number; y: number }> }
      expect(first.points[0].x).toBeCloseTo(960, 6)
      expect(first.points[0].y).toBeCloseTo(540, 6)
      // 이동은 프레임당 한 번으로 묶인다.
      const move = onLaser.mock.calls[1][0] as { points: unknown[] }
      expect(move.points).toHaveLength(2)

      drifted = {}
      restore.mockRestore()
    })

    it('캔버스 밖에서 떼도 획이 끝난다 — 안 그러면 궤적이 계속 이어진다', async () => {
      const restore = rect()
      const onLaser = vi.fn()
      drifted = { zoom: { value: 0.5 }, scrollX: 0, scrollY: 0, activeTool: { type: 'laser' } }

      const { container, findByTestId } = renderLaser(onLaser)
      await findByTestId('excalidraw-editor')
      pointer(container.querySelector('.instructor-annotation-layer')!, 'pointerdown')
      pointer(window, 'pointerup')

      expect(onLaser.mock.calls.map(([s]) => (s as { phase: string }).phase)).toEqual(['start', 'end'])
      drifted = {}
      restore.mockRestore()
    })
  })

  it('바뀐 요소만 내보낸다 — 같은 배열이 다시 와도 다시 보내지 않는다', async () => {
    const onPublish = vi.fn<(change: AnnotationChange) => void>()
    const { findByTestId } = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={onPublish} restoredElements={null} />,
    )
    await findByTestId('excalidraw-editor')
    onPublish.mockClear()   // 판서를 켤 때 나가는 기준점 스냅샷은 여기 관심사가 아니다
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
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={onPublish} restoredElements={null} />,
    )
    await findByTestId('excalidraw-editor')
    ;(excalidrawProps.onChange as (elements: unknown[]) => void)([element('a', 1), element('b', 1)])
    onPublish.mockClear()

    rerender(<InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={1} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={onPublish} restoredElements={null} />)

    expect(onPublish).toHaveBeenCalledWith({
      type: 'snapshot',
      elements: [element('a', 1), element('b', 1)],
    })
  })

  /**
   * 강사가 새로고침해도 판서가 남아야 한다(ADR-0051). Egress는 자기 문서를 계속 들고 있으므로,
   * 되살리지 않으면 <b>강사만</b> 빈 화면을 보고 수강생 화면과 갈린다.
   */
  it('저장돼 있던 판서를 에디터에 되돌린다', async () => {
    const restored = [element('a', 3), element('b', 5)]
    const { findByTestId } = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} restoredElements={restored} />,
    )
    await findByTestId('excalidraw-editor')

    expect(updateScene.mock.calls.map(([arg]) => (arg as { elements?: unknown[] }).elements))
      .toContainEqual(restored)
  })

  /** 복원된 요소는 이미 서버·Egress 양쪽에 있다. 다시 내보내면 같은 획이 op로 한 번 더 흐른다. */
  it('되돌린 요소를 새로 그린 것으로 보고 다시 내보내지 않는다', async () => {
    const restored = [element('a', 3)]
    const onPublish = vi.fn<(change: AnnotationChange) => void>()
    const { findByTestId } = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={onPublish} restoredElements={restored} />,
    )
    await findByTestId('excalidraw-editor')

    ;(excalidrawProps.onChange as (elements: unknown[]) => void)(restored)

    // 스냅샷(기준점·복원 전달)은 나가야 하지만, 복원된 요소를 "새로 그린 것"으로 보고 upsert로
    // 다시 내보내면 같은 획이 op로 한 번 더 흐른다.
    expect(onPublish.mock.calls.map(([change]) => change.type)).not.toContain('upsert')
  })

  /**
   * 복원이 늦게 도착해 방금 그린 획을 덮으면, 그 획은 강사 화면에서 사라지는데 수강생 화면에는
   * 남는다 — 되돌릴 방법이 없는 어긋남이다.
   */
  it('강사가 이미 그렸으면 복원본으로 덮지 않는다', async () => {
    const { findByTestId, rerender } = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} restoredElements={null} />,
    )
    await findByTestId('excalidraw-editor')
    ;(excalidrawProps.onChange as (elements: unknown[]) => void)([element('방금', 1)])
    updateScene.mockClear()

    rerender(<InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} restoredElements={[element('저장된', 9)]} />)

    expect(updateScene.mock.calls.map(([arg]) => (arg as { elements?: unknown[] }).elements))
      .not.toContainEqual([element('저장된', 9)])
  })

  /**
   * Egress는 revision 0에서 시작하는데 강사는 서버에서 이어받은 번호(예: 48)부터 매긴다. 기준점이
   * 없으면 이후 op가 전부 "중간이 빠졌다"로 버려져 <b>강사 화면에는 그려지는데 수강생 화면에는
   * 아무것도 나타나지 않는다</b>. `snapshot`만 revision 검사를 건너뛰므로 이것이 유일한 기준점이다.
   */
  it('판서를 켜면 비어 있어도 스냅샷을 보내 기준점을 잡는다', async () => {
    const onPublish = vi.fn<(change: AnnotationChange) => void>()
    const { findByTestId, rerender } = render(
      <InstructorAnnotationLayer sessionId="ses-1" active={false} audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={onPublish} restoredElements={null} />,
    )

    rerender(<InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={onPublish} restoredElements={null} />)
    await findByTestId('excalidraw-editor')

    expect(onPublish).toHaveBeenCalledWith({ type: 'snapshot', elements: [] })
  })

  it('새 참가자가 들어오면 판서가 비어 있어도 기준점을 다시 보낸다', async () => {
    const onPublish = vi.fn<(change: AnnotationChange) => void>()
    const { findByTestId, rerender } = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={onPublish} restoredElements={null} />,
    )
    await findByTestId('excalidraw-editor')
    onPublish.mockClear()

    rerender(<InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={1} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={onPublish} restoredElements={null} />)

    expect(onPublish).toHaveBeenCalledWith({ type: 'snapshot', elements: [] })
  })

  /**
   * 복원은 `knownRef`를 함께 채우므로 뒤따르는 `onChange`의 diff가 아무것도 찾지 못한다. 여기서
   * 보내지 않으면 강사 화면에만 판서가 돌아오고 수강생 화면은 빈 채로 남는다.
   */
  it('되돌린 판서를 수신 측에도 스냅샷으로 내보낸다', async () => {
    const restored = [element('a', 3)]
    const onPublish = vi.fn<(change: AnnotationChange) => void>()
    const { findByTestId } = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={onPublish} restoredElements={restored} />,
    )
    await findByTestId('excalidraw-editor')

    // 복원 시딩은 에디터가 붙은 뒤 이펙트에서 일어난다. 마운트 직후를 바로 단언하면 부하에 따라
    // 아직 돌지 않은 순간을 잡아 간헐적으로 실패한다.
    await waitFor(() => {
      expect(onPublish).toHaveBeenCalledWith({ type: 'snapshot', elements: restored })
    })
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
      expect(container.querySelector('.egress-stage__annotation canvas')).not.toBeNull()
    })
    const canvas = container.querySelector<HTMLCanvasElement>('.egress-stage__annotation canvas')!
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
   * op 하나마다 그리면 밀린다. 획을 긋는 동안 op는 <b>33.6ms마다</b> 오는데(실측 40건/1.35초)
   * `exportToCanvas`는 문서 전체를 매번 다시 그려 획 50개에 32.5ms, 200개에 55.1ms가 든다
   * (ADR-0051 실측). 그리는 시간이 도착 간격을 넘어서면 렌더가 op마다 쌓여 <b>획을 그을수록 수강생
   * 화면이 뒤처지고 획을 멈춰야 따라잡는다</b>.
   *
   * <p>중간 상태를 버려도 잃는 것이 없다 — 어차피 다음 op가 곧 덮어쓸 그림이고, 마지막 상태는
   * 반드시 그린다.
   */
  it('렌더가 밀리는 동안 도착한 op는 합쳐서 한 번만 그린다', async () => {
    const { room, receive } = fakeRoom()
    getCommonBounds.mockReturnValue([0, 0, 100, 100])

    // 첫 export를 우리가 붙잡아 둔다 — 그동안 op가 계속 도착하는 상황이다.
    let releaseFirst: (canvas: HTMLCanvasElement) => void = () => {}
    const first = new Promise<HTMLCanvasElement>((resolve) => { releaseFirst = resolve })
    exportToCanvas.mockReturnValueOnce(first)
    const done = document.createElement('canvas')
    done.width = 100
    done.height = 100
    exportToCanvas.mockResolvedValue(done)

    render(<EgressAnnotationLayer room={room} />)

    receive(encodeAnnotationOp({ type: 'upsert', revision: 1, elements: [element('a', 1)] }), ANNOTATION_TOPIC)
    await waitFor(() => { expect(exportToCanvas).toHaveBeenCalledTimes(1) })

    // 그리는 동안 세 건이 더 온다. 실제처럼 <b>따로따로</b> 도착시킨다 — 한 tick에 몰아 넣으면
    // React가 한 번의 갱신으로 합쳐 버려, op마다 그리는 구현도 멀쩡해 보인다.
    const tick = () => new Promise((resolve) => { setTimeout(resolve, 0) })
    for (const [revision, id] of [[2, 'b'], [3, 'c'], [4, 'd']] as const) {
      receive(encodeAnnotationOp({ type: 'upsert', revision, elements: [element(id, 1)] }), ANNOTATION_TOPIC)
      await tick()
    }
    expect(exportToCanvas).toHaveBeenCalledTimes(1)   // 아직 첫 렌더가 끝나지 않았다

    const stub = document.createElement('canvas')
    stub.width = 100
    stub.height = 100
    releaseFirst(stub)

    // 밀려 있던 것을 다 소화하고, 마지막 그림에는 그동안 온 것이 전부 들어 있다.
    await waitFor(() => {
      const last = exportToCanvas.mock.calls.at(-1)![0] as { elements: { id: string }[] }
      expect(last.elements.map((e) => e.id)).toEqual(['a', 'b', 'c', 'd'])
    })
    // op 하나마다 그렸다면 네 번이다. 중간 상태를 건너뛰므로 그보다 적어야 한다.
    expect(exportToCanvas.mock.calls.length).toBeLessThan(4)
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
    expect(container.querySelector('.egress-stage__annotation canvas')).toBeNull()
  })

  it('clear를 받으면 판서를 지운다', async () => {
    const { room, receive } = fakeRoom()
    getCommonBounds.mockReturnValue([0, 0, 100, 100])
    stubCanvas(100, 100)
    const { container } = render(<EgressAnnotationLayer room={room} />)

    receive(encodeAnnotationOp({ type: 'upsert', revision: 1, elements: [element('a', 1)] }), ANNOTATION_TOPIC)
    await waitFor(() => { expect(container.querySelector('.egress-stage__annotation canvas')).not.toBeNull() })

    receive(encodeAnnotationOp({ type: 'clear', revision: 2 }), ANNOTATION_TOPIC)
    await waitFor(() => { expect(container.querySelector('.egress-stage__annotation canvas')).toBeNull() })
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
    // 판서 op와 레이저 궤적은 서로 다른 topic이라 구독이 둘이다.
    expect(handlers.get(RoomEvent.DataReceived)?.size).toBe(2)

    unmount()

    expect(handlers.get(RoomEvent.DataReceived)?.size).toBe(0)
  })
})

/** 타입이 맞는지 컴파일 단계에서 확인한다. op 모양이 바뀌면 여기서 먼저 깨진다. */
const _typeCheck: AnnotationOp = { type: 'clear', revision: 1 }
void _typeCheck

/**
 * 선택 → 액션 링(ADR-0054). 링은 <b>선택이 있을 때만</b> 뜨므로, 선택이 우리 쪽에 전달되는지가
 * 전부다. Excalidraw는 `onChange(elements, appState)`로 알려 준다.
 */
describe('판서 정리 액션 링 배선', () => {
  function rectStub() {
    return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 960, height: 540, x: 0, y: 0, top: 0, left: 0, right: 960, bottom: 540,
      toJSON: () => ({}),
    } as DOMRect)
  }

  it('요소를 선택하면 그 자리에 링이 뜬다', async () => {
    const restore = rectStub()
    const { findByTestId, container } = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} restoredElements={null} />,
    )
    await findByTestId('excalidraw-editor')
    const onChange = excalidrawProps.onChange as (els: unknown[], state?: unknown) => void

    // 강사가 획 하나를 그리고 그것을 선택했다.
    const drawn = { id: 'a', type: 'freedraw', version: 1, x: 100, y: 200, points: [[0, 0], [80, 40]] }
    onChange([drawn], { selectedElementIds: { a: true } })

    await waitFor(() => {
      expect(container.querySelector('.annotation-action-ring')).not.toBeNull()
    })
    expect(container.querySelectorAll('.annotation-action-ring__item')).toHaveLength(2)
    restore.mockRestore()
  })

  it('선택이 없으면 링을 그리지 않는다', async () => {
    const restore = rectStub()
    const { findByTestId, container } = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} restoredElements={null} />,
    )
    await findByTestId('excalidraw-editor')
    const onChange = excalidrawProps.onChange as (els: unknown[], state?: unknown) => void

    onChange([{ id: 'a', type: 'freedraw', version: 1, x: 0, y: 0, points: [[0, 0]] }], { selectedElementIds: {} })

    expect(container.querySelector('.annotation-action-ring')).toBeNull()
    restore.mockRestore()
  })

  /** 화이트보드는 배경으로 깔아 둔 판이지 정리 대상이 아니다. */
  it('화이트보드만 선택된 것은 정리 대상으로 치지 않는다', async () => {
    const restore = rectStub()
    const { findByTestId, container } = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} restoredElements={null} />,
    )
    await findByTestId('excalidraw-editor')
    const onChange = excalidrawProps.onChange as (els: unknown[], state?: unknown) => void

    onChange([{ id: WHITEBOARD_ELEMENT_ID, type: 'rectangle', version: 1, x: 0, y: 0, width: 10, height: 10 }],
      { selectedElementIds: { [WHITEBOARD_ELEMENT_ID]: true } })

    expect(container.querySelector('.annotation-action-ring')).toBeNull()
    restore.mockRestore()
  })
})

/**
 * 정리 기능의 <b>진입점</b>. 링은 선택이 있어야 뜨는데, 판서를 켜면 펜이 잠긴 채 시작하므로
 * 강사는 선택하는 방법을 모른 채 기능을 찾게 된다 — 실제로 "바꾸는 버튼이 어디 있냐"는 말이
 * 나왔다. 기능이 있어도 닿을 길이 없으면 없는 것과 같다.
 */
describe('판서 정리 진입점', () => {
  function rectStub() {
    return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 960, height: 540, x: 0, y: 0, top: 0, left: 0, right: 960, bottom: 540,
      toJSON: () => ({}),
    } as DOMRect)
  }

  async function draw() {
    const { findByTestId, container, getByRole, queryByRole } = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} restoredElements={null} />,
    )
    await findByTestId('excalidraw-editor')
    const onChange = excalidrawProps.onChange as (els: unknown[], state?: unknown) => void
    return { container, getByRole, queryByRole, onChange }
  }

  it('그린 것이 없으면 진입점을 보이지 않는다 — 정리할 것이 없다', async () => {
    const restore = rectStub()
    const { onChange, queryByRole } = await draw()

    onChange([], { selectedElementIds: {} })

    expect(queryByRole('button', { name: /AI로 정리/ })).toBeNull()
    restore.mockRestore()
  })

  it('그린 것이 있으면 진입점을 보인다', async () => {
    const restore = rectStub()
    const { onChange, getByRole } = await draw()

    onChange([{ id: 'a', type: 'freedraw', version: 1, x: 0, y: 0, points: [[0, 0], [10, 10]] }],
      { selectedElementIds: {} })

    await waitFor(() => { expect(getByRole('button', { name: /AI로 정리/ })).toBeTruthy() })
    restore.mockRestore()
  })

  /** 펜이 잠겨 있으면 클릭도 드래그도 선택이 아니라 획이 된다. 눌렀을 때 도구까지 바꿔 줘야 한다. */
  it('누르면 선택 도구로 바꾸고 링을 펼친다', async () => {
    const restore = rectStub()
    const { onChange, getByRole, container } = await draw()
    onChange([{ id: 'a', type: 'freedraw', version: 1, x: 0, y: 0, points: [[0, 0], [10, 10]] }],
      { selectedElementIds: {} })
    await waitFor(() => { expect(getByRole('button', { name: /AI로 정리/ })).toBeTruthy() })
    updateScene.mockClear()

    getByRole('button', { name: /AI로 정리/ }).click()

    const tool = updateScene.mock.calls
      .map(([arg]) => (arg as { appState?: { activeTool?: { type?: string } } }).appState?.activeTool?.type)
      .filter(Boolean)
    expect(tool).toContain('selection')
    // 링이 펼쳐지되, 대상이 없으므로 고를 수는 없고 무엇이 필요한지 알려 준다.
    await waitFor(() => {
      expect(container.querySelector('.annotation-action-ring')).not.toBeNull()
    })
    expect(container.querySelector('.annotation-action-ring__need')?.textContent).toContain('선택하세요')
    const items = [...container.querySelectorAll<HTMLButtonElement>('.annotation-action-ring__item')]
    expect(items.every((b) => b.disabled)).toBe(true)
    restore.mockRestore()
  })

  it('선택하면 진입점 대신 링이 뜬다', async () => {
    const restore = rectStub()
    const { onChange, container, queryByRole } = await draw()
    const element = { id: 'a', type: 'freedraw', version: 1, x: 0, y: 0, points: [[0, 0], [10, 10]] }

    onChange([element], { selectedElementIds: { a: true } })

    await waitFor(() => { expect(container.querySelector('.annotation-action-ring')).not.toBeNull() })
    expect(queryByRole('button', { name: /AI로 정리/ })).toBeNull()
    restore.mockRestore()
  })
})

/**
 * 링을 여는 두 경로와 닫는 한 경로. 강사가 획을 고르면 바로 뜨고(클릭이든 드래그든), 아무것도
 * 고르지 않았어도 칩을 눌러 펼칠 수 있다. 펼쳐 놓은 메뉴가 스스로 닫히지 않으면 판서를 가린다.
 */
describe('액션 링 펼침·접힘', () => {
  function rectStub() {
    return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 960, height: 540, x: 0, y: 0, top: 0, left: 0, right: 960, bottom: 540,
      toJSON: () => ({}),
    } as DOMRect)
  }

  async function open() {
    const view = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} restoredElements={null} />,
    )
    await view.findByTestId('excalidraw-editor')
    const onChange = excalidrawProps.onChange as (els: unknown[], state?: unknown) => void
    onChange([{ id: 'a', type: 'freedraw', version: 1, x: 0, y: 0, points: [[0, 0], [10, 10]] }],
      { selectedElementIds: {} })
    await waitFor(() => { expect(view.getByRole('button', { name: /AI로 정리/ })).toBeTruthy() })
    view.getByRole('button', { name: /AI로 정리/ }).click()
    await waitFor(() => { expect(view.container.querySelector('.annotation-action-ring')).not.toBeNull() })
    return view
  }

  it('링 바깥을 누르면 접힌다', async () => {
    const restore = rectStub()
    const view = await open()

    view.container.querySelector('.instructor-annotation-layer')!
      .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))

    await waitFor(() => { expect(view.container.querySelector('.annotation-action-ring')).toBeNull() })
    expect(view.getByRole('button', { name: /AI로 정리/ })).toBeTruthy()
    restore.mockRestore()
  })

  /** 항목을 고르려던 클릭이 링을 접어 버리면 아무것도 고를 수 없다. */
  it('링 위에서 누른 것은 접지 않는다', async () => {
    const restore = rectStub()
    const view = await open()

    view.container.querySelector('.annotation-action-ring__item')!
      .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))

    await new Promise((resolve) => { setTimeout(resolve, 0) })
    expect(view.container.querySelector('.annotation-action-ring')).not.toBeNull()
    restore.mockRestore()
  })

  /** 획 하나를 클릭해 고르는 경우다 — 드래그로 감싸지 않아도 링이 떠야 한다. */
  it('획을 하나만 골라도 링이 뜨고 고를 수 있다', async () => {
    const restore = rectStub()
    const view = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} restoredElements={null} />,
    )
    await view.findByTestId('excalidraw-editor')
    const onChange = excalidrawProps.onChange as (els: unknown[], state?: unknown) => void

    onChange([{ id: 'a', type: 'freedraw', version: 1, x: 100, y: 100, points: [[0, 0], [40, 40]] }],
      { selectedElementIds: { a: true } })

    await waitFor(() => { expect(view.container.querySelector('.annotation-action-ring')).not.toBeNull() })
    const items = [...view.container.querySelectorAll<HTMLButtonElement>('.annotation-action-ring__item')]
    expect(items.every((b) => b.disabled)).toBe(false)
    expect(view.container.querySelector('.annotation-action-ring__need')).toBeNull()
    restore.mockRestore()
  })
})
