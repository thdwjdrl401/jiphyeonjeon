import type React from 'react'
import { fireEvent, render, waitFor } from '@testing-library/react'
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
/**
 * "전체 상태를 알린다"를 확인하는 스파이(ADR-0055).
 *
 * <p>레이어는 더 이상 문서 전체를 데이터 채널로 밀지 않는다 — 실제로 나가는 것은 포인터이고, 밀린
 * 저장이 있을 때만 여기서 만든 스냅샷으로 물러선다. 그 선택은 전송을 쥔 Provider의 몫이므로, 레이어
 * 테스트에서 확인할 것은 <b>알리는 내용</b>이다. 그래서 스냅샷 팩토리를 풀어 같은 스파이에 흘린다.
 */
const stateSpies = new WeakMap<object, (make: () => AnnotationChange) => void>()

/**
 * 같은 스파이에는 <b>같은 함수</b>를 돌려준다. 렌더마다 새 함수를 주면 이 prop을 의존하는 effect가
 * 매번 다시 돌아, 전체 상태가 몇 번 나갔는지 세는 검증이 무의미해진다.
 */
function stateSpy(spy: (change: AnnotationChange) => void): (make: () => AnnotationChange) => void {
  const existing = stateSpies.get(spy)
  if (existing) return existing
  const fn = (make: () => AnnotationChange) => { spy(make()) }
  stateSpies.set(spy, fn)
  return fn
}

/** 전체 상태를 확인하지 않는 테스트용. 모듈 상수라 렌더마다 identity가 바뀌지 않는다. */
const noopState = () => {}

/** 화이트보드 문서 상태 보고. 대부분의 테스트는 이걸 보지 않는다. */
const noopPresence = () => {}

/** 체크포인트 저장. 대부분의 테스트는 이걸 보지 않는다(ADR-0057). */
const noopSnapshot = () => {}

/** 레이어의 체크포인트 임계값과 같은 값. 여기서 바뀌면 테스트도 같이 바꿔야 한다(ADR-0057). */
const OPS_PER_SNAPSHOT_FOR_TEST = 100

const exportToCanvas = vi.fn()
const getCommonBounds = vi.fn()
const updateScene = vi.fn()
/** getAppState가 돌려줄 상태. 강사가 캔버스를 밀거나 확대한 상황을 흉내내는 데 쓴다. */
let drifted: Record<string, unknown> = {}
/** getSceneElements가 돌려줄 씬. 화이트보드 토글이 기존 요소를 보존하는지 보려면 필요하다. */
let sceneElements: Array<Record<string, unknown>> = []
let excalidrawProps: Record<string, unknown> = {}
/** true면 `excalidrawAPI`를 렌더가 아니라 <b>mount 이후</b>에 넘긴다(실제 지연 청크에 가깝다). */
let lateApi = false

vi.mock('@/features/live-session/excalidrawRuntime', () => ({
  EXCALIDRAW_ASSET_PATH: '/excalidraw/',
  loadExcalidraw: () => Promise.resolve({
    Excalidraw: (props: Record<string, unknown>) => {
      excalidrawProps = props
      // 실제 컴포넌트처럼 마운트 시 명령형 API를 넘겨준다.
      const give = props.excalidrawAPI as ((api: unknown) => void) | undefined
      const api = { updateScene, getAppState: () => drifted, getSceneElements: () => sceneElements, getFiles: () => ({}), addFiles: () => {} }
      if (give && lateApi) setTimeout(() => give(api), 0)
      else if (give) give(api)
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
      <InstructorAnnotationLayer sessionId="ses-1" active={false} audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} onPublishState={noopState} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null} />,
    )

    expect(queryByTestId('excalidraw-editor')).toBeNull()
  })

  it('켜면 에디터를 붙이고 배경을 투명하게 둔다 — 아래 화면공유가 비쳐야 한다', async () => {
    const { findByTestId } = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} onPublishState={noopState} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null} />,
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
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} onPublishState={noopState} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null} />,
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
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} onPublishState={noopState} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null} />,
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
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} onPublishState={noopState} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null} />,
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
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} onPublishState={noopState} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null} />,
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
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} onPublishState={noopState} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null} />,
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
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} onPublishState={noopState} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null} />,
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
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={onPublish} onPublishState={stateSpy(onPublish)} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null} />,
    )
    await findByTestId('excalidraw-editor')
    ;(excalidrawProps.onChange as (elements: unknown[]) => void)([element('a', 1)])
    onPublish.mockClear()

    rerender(<InstructorAnnotationLayer sessionId="ses-1" active={false} audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={onPublish} onPublishState={stateSpy(onPublish)} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null} />)

    expect(onPublish).toHaveBeenCalledWith({ type: 'clear' })
  })

  it('그린 것이 없으면 끌 때 아무것도 보내지 않는다', async () => {
    const onPublish = vi.fn()
    const { findByTestId, rerender } = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={onPublish} onPublishState={stateSpy(onPublish)} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null} />,
    )
    await findByTestId('excalidraw-editor')
    onPublish.mockClear()

    rerender(<InstructorAnnotationLayer sessionId="ses-1" active={false} audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={onPublish} onPublishState={stateSpy(onPublish)} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null} />)

    expect(onPublish).not.toHaveBeenCalled()
  })

  /**
   * 판서를 껐다 켜면 Excalidraw가 다시 mount되어 씬이 비어서 시작한다. 문서를 되돌려주지 않으면
   * 강사가 그린 것이 사라지고, 더 나쁘게 빈 배열이 diff를 타고 <b>수강생 화면의 판서까지 지운다</b>.
   */
  it('판서를 껐다 켜면 그린 문서를 되돌려준다 — 수강생 판서까지 지우지 않는다', async () => {
    const onPublish = vi.fn<(change: AnnotationChange) => void>()
    const { findByTestId, rerender } = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={onPublish} onPublishState={stateSpy(onPublish)} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null} />,
    )
    await findByTestId('excalidraw-editor')
    ;(excalidrawProps.onChange as (elements: unknown[]) => void)([element('a', 1), element('b', 1)])

    // 판서 끄기 → 켜기
    rerender(<InstructorAnnotationLayer sessionId="ses-1" active={false} audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={onPublish} onPublishState={stateSpy(onPublish)} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null} />)
    onPublish.mockClear()
    rerender(<InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={onPublish} onPublishState={stateSpy(onPublish)} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null} />)
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
          onLaser={vi.fn()} onPublish={vi.fn()} onPublishState={noopState} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null}
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
        <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={onLaser} onPublish={vi.fn()} onPublishState={noopState} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null} />,
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
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={onPublish} onPublishState={stateSpy(onPublish)} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null} />,
    )
    await findByTestId('excalidraw-editor')
    onPublish.mockClear()   // 판서를 켤 때 나가는 기준점 스냅샷은 여기 관심사가 아니다
    const onChange = excalidrawProps.onChange as (elements: unknown[]) => void

    onChange([element('a', 1)])
    expect(onPublish).toHaveBeenCalledTimes(1)
    expect(onPublish).toHaveBeenCalledWith({ type: 'upsert', elements: [element('a', 1)], files: {} })

    // Excalidraw는 아무것도 안 바뀌어도 onChange를 부른다(포인터 이동 등).
    onChange([element('a', 1)])
    expect(onPublish).toHaveBeenCalledTimes(1)

    onChange([element('a', 2)])
    expect(onPublish).toHaveBeenCalledTimes(2)
    expect(onPublish).toHaveBeenLastCalledWith({ type: 'upsert', elements: [element('a', 2)], files: {} })
  })

  /**
   * <b>부모로 올라가는 보고는 값이 바뀔 때만 한다.</b>
   *
   * <p>`onChange`는 포인터가 움직일 때도 불린다. 거기서 매번 부모의 setState를 부르면
   * <b>부모 렌더 → Excalidraw 갱신 → componentDidUpdate → onChange</b>가 돌면서 React가
   * "Maximum update depth exceeded"(#185)로 앱을 통째로 죽인다.
   *
   * <p>실제로 그렇게 터졌다 — 화이트보드를 켜는 순간 화면이 하얗게 되고 라이브 연결까지 끊겼다.
   * 같은 파일의 다른 보고들은 원래 이 규칙을 지키고 있었고, 나중에 추가된 것 하나만 빠져 있었다.
   */
  it('화이트보드 존재는 값이 바뀔 때만 알린다 — 렌더 루프를 만들지 않는다', async () => {
    const onWhiteboardPresence = vi.fn<(present: boolean) => void>()
    const { findByTestId } = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} onPublishState={noopState} onWhiteboardPresence={onWhiteboardPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null} />,
    )
    await findByTestId('excalidraw-editor')
    const onChange = excalidrawProps.onChange as (els: unknown[]) => void

    // 판이 없는 상태로 여러 번 — 포인터가 움직이는 상황이다.
    onChange([element('a', 1)])
    onChange([element('a', 1)])
    onChange([element('a', 2)])
    expect(onWhiteboardPresence).not.toHaveBeenCalledWith(true)
    const beforeBoard = onWhiteboardPresence.mock.calls.length

    // 판이 생기면 <b>한 번</b> 알린다.
    const board = { id: WHITEBOARD_ELEMENT_ID, type: 'rectangle', version: 1, index: 'a0' }
    onChange([board, element('a', 2)])
    onChange([board, element('a', 3)])
    onChange([board, element('a', 4)])

    const trueCalls = onWhiteboardPresence.mock.calls.filter(([present]) => present === true)
    expect(trueCalls).toHaveLength(1)
    expect(onWhiteboardPresence.mock.calls.length).toBeLessThanOrEqual(beforeBoard + 1)
  })

  /**
   * <b>주기적으로 복원 체크포인트를 남긴다</b>(ADR-0057).
   *
   * <p>없으면 복원이 세션 시작부터 전부 내려온다 — 실측에서 op 233건이 983kB였고, 강의가 길어질수록
   * 무한히 자란다. ADR-0055에서 복원 시딩을 스냅샷 → 포인터로 바꾸며 저장되던 스냅샷이 사라진 탓이다.
   *
   * <p><b>데이터 채널로는 나가지 않는다.</b> 문서 전체를 채널에 실으면 ADR-0055가 없앤 64KB 문제가
   * 되돌아온다 — 그래서 `onPublish`가 아니라 별도 경로다.
   */
  it('문서 변경이 쌓이면 복원 체크포인트를 남긴다 — 데이터 채널로는 보내지 않는다', async () => {
    const onPublish = vi.fn<(change: AnnotationChange) => void>()
    const onSaveSnapshot = vi.fn<(make: () => AnnotationChange) => void>()
    const { findByTestId } = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={onPublish} onPublishState={noopState} onWhiteboardPresence={noopPresence} onSaveSnapshot={onSaveSnapshot} restoredElements={null} restoredFiles={null} />,
    )
    await findByTestId('excalidraw-editor')
    const onChange = excalidrawProps.onChange as (els: unknown[]) => void

    // 요소를 하나씩 늘려 문서-변경 op를 100건 넘긴다.
    const drawn: ReturnType<typeof element>[] = []
    for (let i = 1; i <= 101; i += 1) {
      drawn.push(element(`e${i}`, 1))
      onChange([...drawn])
    }

    expect(onSaveSnapshot).toHaveBeenCalledTimes(1)
    /*
     * 체크포인트에는 <b>그 시점의 문서 전체</b>가 담긴다. 정확히 몇 번째 변경에서 찍히는지는 계약이
     * 아니다 — 임계값 근처에서 한 tick 차이가 나도 복원은 똑같이 동작한다. 고정할 것은 "일부가 아니라
     * 전체가 담긴다"는 것이다.
     */
    const made = onSaveSnapshot.mock.calls[0][0]()
    expect(made.type).toBe('snapshot')
    const saved = (made as { elements: { id: string }[] }).elements
    expect(saved.length).toBeGreaterThanOrEqual(OPS_PER_SNAPSHOT_FOR_TEST)
    expect(new Set(saved.map((e) => e.id)).size).toBe(saved.length)

    // 그리고 그것이 데이터 채널로는 나가지 않는다 — 나갔다면 64KB 문제가 되돌아온다.
    expect(onPublish.mock.calls.map(([c]) => c.type)).not.toContain('snapshot')
  })

  /**
   * 새로 들어온 Egress는 그 전에 흐른 op를 받을 수 없다. 스냅샷을 다시 내지 않으면 판서가 통째로
   * 빈 채로 녹화된다.
   */
  it('새 참가자가 들어오면 전체 스냅샷을 다시 내보낸다', async () => {
    const onPublish = vi.fn<(change: AnnotationChange) => void>()
    const { findByTestId, rerender } = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={onPublish} onPublishState={stateSpy(onPublish)} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null} />,
    )
    await findByTestId('excalidraw-editor')
    ;(excalidrawProps.onChange as (elements: unknown[]) => void)([element('a', 1), element('b', 1)])
    onPublish.mockClear()

    rerender(<InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={1} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={onPublish} onPublishState={stateSpy(onPublish)} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null} />)

    expect(onPublish).toHaveBeenCalledWith({
      type: 'snapshot',
      elements: [element('a', 1), element('b', 1)],
      files: {},
    })
  })

  /**
   * 강사가 새로고침해도 판서가 남아야 한다(ADR-0051). Egress는 자기 문서를 계속 들고 있으므로,
   * 되살리지 않으면 <b>강사만</b> 빈 화면을 보고 수강생 화면과 갈린다.
   */
  /**
   * <b>API가 mount 뒤에 도착해도</b> 복원이 씬에 들어가야 한다.
   *
   * <p>실제 Excalidraw는 지연 청크라, `excalidrawAPI` 콜백이 우리 effect보다 늦게 올 수 있다.
   * 그런데 API를 <b>ref에만</b> 담으면 "도착했다"는 사실이 렌더를 만들지 못해, 시딩 effect가 다시
   * 돌 기회가 없다 — 다른 값(`ui`)이 우연히 바뀌어 줘야만 돈다. 그러면 강사 화면에서만 판서가
   * 사라지고 수강생 화면에는 그대로 남는다(운영에서 실제로 그렇게 보였다).
   */
  it('에디터 API가 늦게 도착해도 복원을 씬에 넣는다', async () => {
    const restored = [element('a', 3), element('b', 5)]
    lateApi = true
    const { findByTestId } = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} onPublishState={noopState} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={restored} restoredFiles={null} />,
    )
    await findByTestId('excalidraw-editor')

    await waitFor(() => {
      expect(updateScene.mock.calls.map(([arg]) => (arg as { elements?: unknown[] }).elements))
        .toContainEqual(restored)
    })
    lateApi = false
  })

  it('저장돼 있던 판서를 에디터에 되돌린다', async () => {
    const restored = [element('a', 3), element('b', 5)]
    const { findByTestId } = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} onPublishState={noopState} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={restored} restoredFiles={null} />,
    )
    await findByTestId('excalidraw-editor')

    // 에디터가 붙은 것과 시딩 effect가 <b>돈 것</b>은 다르다. 바로 단언하면 로컬에서는 통과하고
    // 부하가 걸린 CI에서만 깨진다(실제로 그렇게 깨졌다).
    await waitFor(() => {
      expect(updateScene.mock.calls.map(([arg]) => (arg as { elements?: unknown[] }).elements))
        .toContainEqual(restored)
    })
  })

  /** 복원된 요소는 이미 서버·Egress 양쪽에 있다. 다시 내보내면 같은 획이 op로 한 번 더 흐른다. */
  it('되돌린 요소를 새로 그린 것으로 보고 다시 내보내지 않는다', async () => {
    const restored = [element('a', 3)]
    const onPublish = vi.fn<(change: AnnotationChange) => void>()
    const { findByTestId } = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={onPublish} onPublishState={stateSpy(onPublish)} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={restored} restoredFiles={null} />,
    )
    await findByTestId('excalidraw-editor')
    // 시딩이 끝나야 knownRef가 채워진다. 그 전에 onChange를 밀어 넣으면 복원본이 "새로 그린 것"으로
    // 보이는 게 당연하므로, 여기서 기다리지 않으면 부하에 따라 간헐적으로 실패한다.
    await waitFor(() => {
      expect(onPublish).toHaveBeenCalledWith({ type: 'snapshot', elements: restored, files: {} })
    })

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
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} onPublishState={noopState} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null} />,
    )
    await findByTestId('excalidraw-editor')
    ;(excalidrawProps.onChange as (elements: unknown[]) => void)([element('방금', 1)])
    updateScene.mockClear()

    rerender(<InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} onPublishState={noopState} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={[element('저장된', 9)]} restoredFiles={null} />)

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
      <InstructorAnnotationLayer sessionId="ses-1" active={false} audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={onPublish} onPublishState={stateSpy(onPublish)} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null} />,
    )

    rerender(<InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={onPublish} onPublishState={stateSpy(onPublish)} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null} />)
    await findByTestId('excalidraw-editor')

    expect(onPublish).toHaveBeenCalledWith({ type: 'snapshot', elements: [], files: {} })
  })

  it('새 참가자가 들어오면 판서가 비어 있어도 기준점을 다시 보낸다', async () => {
    const onPublish = vi.fn<(change: AnnotationChange) => void>()
    const { findByTestId, rerender } = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={onPublish} onPublishState={stateSpy(onPublish)} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null} />,
    )
    await findByTestId('excalidraw-editor')
    onPublish.mockClear()

    rerender(<InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={1} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={onPublish} onPublishState={stateSpy(onPublish)} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null} />)

    expect(onPublish).toHaveBeenCalledWith({ type: 'snapshot', elements: [], files: {} })
  })

  /**
   * 복원은 `knownRef`를 함께 채우므로 뒤따르는 `onChange`의 diff가 아무것도 찾지 못한다. 여기서
   * 보내지 않으면 강사 화면에만 판서가 돌아오고 수강생 화면은 빈 채로 남는다.
   */
  it('되돌린 판서를 수신 측에도 스냅샷으로 내보낸다', async () => {
    const restored = [element('a', 3)]
    const onPublish = vi.fn<(change: AnnotationChange) => void>()
    const { findByTestId } = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={onPublish} onPublishState={stateSpy(onPublish)} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={restored} restoredFiles={null} />,
    )
    await findByTestId('excalidraw-editor')

    // 복원 시딩은 에디터가 붙은 뒤 이펙트에서 일어난다. 마운트 직후를 바로 단언하면 부하에 따라
    // 아직 돌지 않은 순간을 잡아 간헐적으로 실패한다.
    await waitFor(() => {
      expect(onPublish).toHaveBeenCalledWith({ type: 'snapshot', elements: restored, files: {} })
    })
  })

})

describe('Egress 판서 레이어', () => {
  /** LiveKit Room의 데이터 수신만 흉내낸다. 실제 Room을 띄우지 않고 배선을 본다. */
  function fakeRoom() {
    const handlers = new Map<string, Set<(...args: never[]) => void>>()
    const room = {
      // 방 이름이 곧 세션이다(백엔드 `LiveSessionService.roomName`과 같은 규칙). 전체 상태를
      // 받아갈 때 여기서 sessionId를 꺼낸다.
      name: 'session-ses-1',
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

  /* ── 전체 상태는 받아간다(ADR-0055) ──────────────────────────────────────── */

  /** §3-6d 응답 한 건. 서버는 마지막 스냅샷과 그 이후 op를 준다. */
  function storedDocument(elements: ReturnType<typeof element>[], revision: number) {
    return {
      revision,
      nextRevision: revision + 1,
      snapshotPayload: JSON.stringify({ elements, files: {} }),
      ops: [],
    }
  }

  /**
   * 포인터를 받으면 문서를 <b>서버에서</b> 가져온다(ADR-0055).
   *
   * <p>강사가 문서 전체를 데이터 채널로 밀지 않게 된 이유는 실측 74.9KB가 한도(64KB)를 넘었기
   * 때문이다. 넘으면 전송이 통째로 실패해 수강생 화면에 판서가 아예 나오지 않는다.
   */
  it('포인터를 받으면 서버에서 전체 상태를 받아 그린다', async () => {
    const { room, receive } = fakeRoom()
    getCommonBounds.mockReturnValue([0, 0, 100, 100])
    stubCanvas(100, 100)
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify(storedDocument([element('a', 1), element('b', 1)], 7)), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    render(<EgressAnnotationLayer room={room} livekitToken="lk-token" />)
    receive(encodeAnnotationOp({ type: 'pointer', revision: 9 }), ANNOTATION_TOPIC)

    await waitFor(() => {
      const last = exportToCanvas.mock.calls.at(-1)![0] as { elements: { id: string }[] }
      expect(last.elements.map((e) => e.id)).toEqual(['a', 'b'])
    })

    // 세션 쿠키가 없으므로 LiveKit 토큰으로 방 참가자임을 증명한다. 방 이름에서 세션을 꺼낸다.
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/live-sessions/ses-1/annotation')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer lk-token')

    vi.unstubAllGlobals()
  })

  /**
   * <b>받아오는 동안에도 강사는 계속 그린다.</b> 그 사이 도착한 op를 잃으면 이어붙일 자리가 비어
   * 그 뒤 op가 전부 버려진다 — 강사 화면에는 그려지는데 녹화에는 나타나지 않는, 이 프로젝트에서
   * 반복해 겪은 그 모양이다.
   */
  it('전체 상태를 받아오는 동안 도착한 op를 잃지 않는다', async () => {
    const { room, receive } = fakeRoom()
    getCommonBounds.mockReturnValue([0, 0, 100, 100])
    stubCanvas(100, 100)
    let release: (response: Response) => void = () => {}
    const pending = new Promise<Response>((resolve) => { release = resolve })
    vi.stubGlobal('fetch', vi.fn(() => pending))

    render(<EgressAnnotationLayer room={room} livekitToken="lk-token" />)
    receive(encodeAnnotationOp({ type: 'pointer', revision: 9 }), ANNOTATION_TOPIC)

    // 왕복이 도는 동안 강사가 한 획 더 그었다.
    receive(encodeAnnotationOp({ type: 'upsert', revision: 10, elements: [element('c', 1)] }), ANNOTATION_TOPIC)
    await new Promise((resolve) => { setTimeout(resolve, 0) })

    release(new Response(JSON.stringify(storedDocument([element('a', 1)], 7)), { status: 200 }))

    await waitFor(() => {
      const last = exportToCanvas.mock.calls.at(-1)![0] as { elements: { id: string }[] }
      expect(last.elements.map((e) => e.id)).toEqual(['a', 'c'])
    })

    vi.unstubAllGlobals()
  })

  /**
   * 받아오지 못했을 때 <b>번호만이라도 맞춘다.</b> 그러지 않으면 이후 델타가 전부 "중간이 빠졌다"로
   * 버려져 강의가 끝날 때까지 아무것도 나타나지 않는다 — 그쪽이 훨씬 나쁘다.
   */
  it('전체 상태를 받아오지 못해도 이후 판서는 이어 그린다', async () => {
    const { room, receive } = fakeRoom()
    getCommonBounds.mockReturnValue([0, 0, 100, 100])
    stubCanvas(100, 100)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 403 })))

    render(<EgressAnnotationLayer room={room} livekitToken="lk-token" />)
    receive(encodeAnnotationOp({ type: 'pointer', revision: 9 }), ANNOTATION_TOPIC)
    await waitFor(() => { expect(warn).toHaveBeenCalled() })

    receive(encodeAnnotationOp({ type: 'upsert', revision: 10, elements: [element('c', 1)] }), ANNOTATION_TOPIC)
    await waitFor(() => {
      const last = exportToCanvas.mock.calls.at(-1)![0] as { elements: { id: string }[] }
      expect(last.elements.map((e) => e.id)).toEqual(['c'])
    })

    warn.mockRestore()
    vi.unstubAllGlobals()
  })

  /** 토큰 없이 열린 페이지에서도 녹화는 계속돼야 한다 — 예외로 화면을 멈추지 않는다. */
  it('토큰이 없으면 받아가지 않고 넘어간다', async () => {
    const { room, receive } = fakeRoom()
    stubCanvas(10, 10)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<EgressAnnotationLayer room={room} />)
    expect(() => receive(encodeAnnotationOp({ type: 'pointer', revision: 9 }), ANNOTATION_TOPIC)).not.toThrow()

    await new Promise((resolve) => { setTimeout(resolve, 0) })
    expect(fetchMock).not.toHaveBeenCalled()

    warn.mockRestore()
    vi.unstubAllGlobals()
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
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} onPublishState={noopState} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null} />,
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
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} onPublishState={noopState} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null} />,
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
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} onPublishState={noopState} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null} />,
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
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} onPublishState={noopState} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null} />,
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
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} onPublishState={noopState} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null} />,
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
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} onPublishState={noopState} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null} />,
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

/**
 * 강조 툴 캡처 발동(ADR-0074).
 *
 * <p>여기서 고정하는 것: <b>그리는 동안이 아니라 멎은 뒤</b> 한 번만 알린다. `onChange`는 포인터가
 * 움직일 때마다 불리므로, 매번 캡처하면 같은 강조로 이미지가 수십 장 쌓이고 비전 모델도 그만큼 불린다.
 */
describe('강조 툴 캡처 발동', () => {
  beforeEach(() => {
    excalidrawProps = {}
    // 모듈 상태다. 앞선 테스트가 켜 두면 API가 늦게 도착해 타이머 시점에 아직 없고, 표식이 붙지
    // 않아 이 describe가 통째로 플레이키해진다. 명시적으로 되돌린다.
    lateApi = false
    sceneElements = []
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  function highlight(id: string, version: number) {
    return { id, version, type: 'freedraw', x: 100, y: 100, width: 50, height: 50,
      customData: { liveclassHighlight: true } }
  }

  /** 강조 툴로 막 그린 획 — 표식은 아직 없다. 붙이는 것은 레이어의 일이다. */
  function plainStroke(id: string, version: number) {
    return { id, version, type: 'freedraw', x: 100, y: 100, width: 50, height: 50 }
  }

  async function mount(onHighlightSettled: (elements: readonly unknown[]) => void) {
    lateApi = false
    sceneElements = []
    const view = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} onPublishState={noopState} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null} onHighlightSettled={onHighlightSettled as never} />,
    )
    await vi.waitFor(() => expect(excalidrawProps.onChange).toBeTypeOf('function'))
    return view
  }

  it('그리는 동안에는 부르지 않고, 멎고 1초 뒤에 한 번 부른다', async () => {
    const settled = vi.fn()
    const { getByRole } = await mount(settled)
    fireEvent.click(getByRole('button', { name: /강조/ }))
    const onChange = excalidrawProps.onChange as (elements: unknown[]) => void

    // 획 하나를 긋는 동안 onChange가 여러 번 불린다.
    onChange([plainStroke('h1', 1)])
    onChange([plainStroke('h1', 2)])
    onChange([plainStroke('h1', 3)])
    expect(settled).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1000)
    expect(settled).toHaveBeenCalledTimes(1)
  })

  it('동그라미 뒤에 밑줄을 이어 그으면 한 건으로 묶인다', async () => {
    const settled = vi.fn()
    const { getByRole } = await mount(settled)
    fireEvent.click(getByRole('button', { name: /강조/ }))
    const onChange = excalidrawProps.onChange as (elements: unknown[]) => void

    onChange([plainStroke('h1', 1)])
    await vi.advanceTimersByTimeAsync(600)
    onChange([plainStroke('h1', 1), plainStroke('h2', 1)])
    await vi.advanceTimersByTimeAsync(600)
    expect(settled).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(400)
    expect(settled).toHaveBeenCalledTimes(1)
  })

  it('일반 판서만 그리면 발동하지 않는다', async () => {
    const settled = vi.fn()
    await mount(settled)
    const onChange = excalidrawProps.onChange as (elements: unknown[]) => void

    onChange([element('normal', 1)])
    await vi.advanceTimersByTimeAsync(2000)
    expect(settled).not.toHaveBeenCalled()
  })

  /** 타이머가 도는 사이 지웠으면 없는 강조를 근거로 남기게 된다. */
  it('기다리는 동안 강조를 지우면 캡처하지 않는다', async () => {
    const settled = vi.fn()
    await mount(settled)
    const onChange = excalidrawProps.onChange as (elements: unknown[]) => void

    onChange([highlight('h1', 1)])
    await vi.advanceTimersByTimeAsync(500)
    onChange([{ ...highlight('h1', 2), isDeleted: true }])
    await vi.advanceTimersByTimeAsync(1500)

    expect(settled).not.toHaveBeenCalled()
  })
})

/**
 * 강조 툴이 실제로 표식을 붙이는가(ADR-0074).
 *
 * <p>앞의 발동 테스트는 `customData`를 <b>직접 넣어 준</b> 요소로 검증한다. 그래서 "표식을 아무도
 * 붙이지 않는" 구멍을 잡지 못했다 — 실제로 강조 툴로 그려도 요소는 일반 freedraw와 구별되지 않아
 * 캡처가 영영 발동하지 않았다. 여기서는 <b>버튼을 누르고 평범한 획을 그리는</b> 경로를 그대로 탄다.
 */
describe('강조 툴 표식 부착', () => {
  beforeEach(() => {
    excalidrawProps = {}
    lateApi = false
    sceneElements = []
    updateScene.mockClear()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  async function mountWithTool(settled = vi.fn()) {
    const view = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} onPublishState={noopState} onWhiteboardPresence={noopPresence} onSaveSnapshot={noopSnapshot} restoredElements={null} restoredFiles={null} onHighlightSettled={settled as never} />,
    )
    await vi.waitFor(() => expect(excalidrawProps.onChange).toBeTypeOf('function'))
    // 마운트 직후의 시딩(화이트보드·복원)이 updateScene을 부른다. 그 기록까지 세면 "그리는 동안
    // 씬을 건드리지 않는다"가 거짓으로 실패한다.
    await vi.advanceTimersByTimeAsync(0)
    updateScene.mockClear()
    return { ...view, settled }
  }

  /**
   * 씬에 들어간 것 중 <b>표식이 붙은</b> 요소들.
   *
   * <p>updateScene 호출 수로 세지 않는다 — 마운트 시딩·프레임 매핑 등 다른 이유로도 불려서
   * 그 수를 세면 이 테스트가 관계없는 변경에 흔들린다. 여기서 확인하려는 것은 하나다:
   * <b>표식이 붙은 요소가 씬에 들어갔는가.</b>
   */
  function taggedElements() {
    return updateScene.mock.calls
      .flatMap(([arg]) => (arg as { elements?: Array<Record<string, unknown>> }).elements ?? [])
      .filter((element) =>
        (element.customData as Record<string, unknown> | undefined)?.liveclassHighlight === true)
  }

  /**
   * <b>그리는 도중에 씬을 갈아끼우면 획이 죽는다.</b> freedraw는 점이 늘 때마다 onChange를 부르는데,
   * 첫 점에서 updateScene으로 덮으면 진행 중인 획이 그 시점으로 되돌아가 <b>찍은 점 하나만 남는다</b>.
   * 실제로 그렇게 그려졌다. 그래서 표식은 그리기가 멎은 뒤에만 붙인다.
   */
  it('완성된 획으로 표식을 붙인다 — 중간 스냅샷으로 덮으면 획이 죽는다', async () => {
    const { getByRole } = await mountWithTool()
    fireEvent.click(getByRole('button', { name: /강조/ }))

    const onChange = excalidrawProps.onChange as (elements: unknown[]) => void
    // 획 하나가 자라는 동안 onChange가 여러 번 불린다. 마지막이 완성된 획이다.
    onChange([{ id: 'stroke-1', version: 1, type: 'freedraw', x: 10, y: 10, width: 5, height: 5 }])
    onChange([{ id: 'stroke-1', version: 2, type: 'freedraw', x: 10, y: 10, width: 40, height: 30 }])
    onChange([{ id: 'stroke-1', version: 3, type: 'freedraw', x: 10, y: 10, width: 80, height: 60 }])
    await vi.advanceTimersByTimeAsync(1000)

    const tagged = taggedElements()
    expect(tagged).toHaveLength(1)
    /*
     * version 1(첫 점)으로 씬을 덮으면 진행 중인 획이 그 시점으로 되돌아가 <b>찍은 점 하나만
     * 남는다</b>. 실제로 그렇게 그려졌고, 그 망가진 문서가 그대로 수강생에게도 나갔다.
     */
    expect(tagged[0].version).toBe(3)
    expect(tagged[0].width).toBe(80)
  })

  it('그리기가 멎은 뒤에 표식이 붙는다', async () => {
    const { getByRole } = await mountWithTool()
    fireEvent.click(getByRole('button', { name: /강조/ }))

    const onChange = excalidrawProps.onChange as (elements: unknown[]) => void
    onChange([{ id: 'stroke-1', version: 1, type: 'freedraw', x: 10, y: 10, width: 5, height: 5 }])
    await vi.advanceTimersByTimeAsync(1000)

    const tagged = taggedElements()
    expect(tagged).toHaveLength(1)
    expect(tagged[0].customData).toMatchObject({ liveclassHighlight: true })
  })

  /**
   * 강조는 한 번 그리면 문서에 계속 남는다. "표식이 있으면 알린다"로 두면 그 뒤 모든 정지마다
   * 확인 창이 다시 뜬다 — 이미 물어본 강조를 무한히 다시 묻는 셈이다. 실제로 그렇게 동작했다.
   */
  it('한 번 물어본 강조는 다시 묻지 않는다', async () => {
    const { getByRole, settled } = await mountWithTool()
    fireEvent.click(getByRole('button', { name: /강조/ }))
    const onChange = excalidrawProps.onChange as (elements: unknown[]) => void

    const stroke = { id: 'stroke-1', version: 1, type: 'freedraw', x: 10, y: 10, width: 80, height: 60 }
    onChange([stroke])
    await vi.advanceTimersByTimeAsync(1000)
    expect(settled).toHaveBeenCalledTimes(1)

    // 표식 붙은 강조는 문서에 남는다. 그 뒤 정지가 반복돼도 같은 강조를 다시 묻지 않는다.
    const tagged = { ...stroke, version: 2, customData: { liveclassHighlight: true } }
    onChange([tagged])
    await vi.advanceTimersByTimeAsync(1000)
    onChange([{ ...tagged, version: 3 }])
    await vi.advanceTimersByTimeAsync(1000)

    expect(settled).toHaveBeenCalledTimes(1)
  })

  it('강조를 켜지 않았으면 표식을 붙이지 않는다', async () => {
    await mountWithTool()
    const onChange = excalidrawProps.onChange as (elements: unknown[]) => void
    onChange([{ id: 'stroke-1', version: 1, type: 'freedraw', x: 10, y: 10, width: 5, height: 5 }])
    await vi.advanceTimersByTimeAsync(1500)

    expect(taggedElements()).toHaveLength(0)
  })

  /**
   * `updateScene`이 다시 `onChange`를 부른다. 같은 요소를 또 건드리면 그 자리에서 앱이 죽는다
   * ("Maximum update depth exceeded"). 이미 붙인 것은 다시 건드리지 않아야 한다.
   */
  it('표식을 붙인 요소를 다시 건드리지 않는다 — 무한 루프 방지', async () => {
    const { getByRole } = await mountWithTool()
    fireEvent.click(getByRole('button', { name: /강조/ }))
    const onChange = excalidrawProps.onChange as (elements: unknown[]) => void

    const plain = { id: 'stroke-1', version: 1, type: 'freedraw', x: 10, y: 10, width: 5, height: 5 }
    onChange([plain])
    await vi.advanceTimersByTimeAsync(1000)
    const afterFirst = updateScene.mock.calls.length

    // updateScene이 유발한 재진입: 이제 표식이 붙은 채로 다시 들어온다.
    onChange([{ ...plain, version: 2, customData: { liveclassHighlight: true } }])
    await vi.advanceTimersByTimeAsync(1000)
    // 표식 없는 같은 요소가 다시 와도(경합) 재부착하지 않는다.
    onChange([{ ...plain, version: 3 }])
    await vi.advanceTimersByTimeAsync(1000)

    expect(updateScene.mock.calls.length).toBe(afterFirst)
  })

  /** 표식 부착과 알림이 한 번에 일어난다 — 재진입한 onChange를 기다리지 않는다. */
  it('멎고 1초 뒤 표식과 캡처 발동이 함께 일어난다 — 전체 경로', async () => {
    const { getByRole, settled } = await mountWithTool()
    fireEvent.click(getByRole('button', { name: /강조/ }))
    const onChange = excalidrawProps.onChange as (elements: unknown[]) => void

    onChange([{ id: 'stroke-1', version: 1, type: 'freedraw', x: 10, y: 10, width: 5, height: 5 }])
    expect(settled).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1000)
    expect(settled).toHaveBeenCalledTimes(1)
    // 알림에 실린 요소에 표식이 이미 있다 — 캡처가 그것으로 크롭 범위를 잡는다.
    const notified = settled.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(notified[0].customData).toMatchObject({ liveclassHighlight: true })
  })
})
