import type React from 'react'
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnnotationElement } from '@/features/live-session/annotation'

/**
 * 해석 결과를 실제로 <b>씬에 넣는</b> 경로(ADR-0054, §3-6e).
 *
 * <p>이 경로가 지금까지 통째로 미검증이었다. 배치 계산(`placeAtSelection`)과 링 컴포넌트는 각각
 * 단위 테스트가 있었지만, "고른 것을 지우고 새 요소를 같은 자리에 넣는" 실제 흐름은 아무도 확인하지
 * 않았다. 같은 공백 때문에 정리 진입점이 아예 보이지 않는 버그를 강사가 먼저 발견했다.
 *
 * <p>여기서 고정하는 것은 셋이다 — <b>원본을 지우는가</b>, <b>새 요소가 원래 자리에 놓이는가</b>,
 * 그리고 <b>확인 전에는 아무것도 바뀌지 않는가</b>.
 */

const updateScene = vi.fn()
const exportToCanvas = vi.fn()
const parseMermaidToExcalidraw = vi.fn()
const convertToExcalidrawElements = vi.fn()
let excalidrawProps: Record<string, unknown> = {}
let sceneElements: AnnotationElement[] = []

vi.mock('@/features/live-session/excalidrawRuntime', () => ({
  EXCALIDRAW_ASSET_PATH: '/excalidraw/',
  loadExcalidraw: () => Promise.resolve({
    Excalidraw: (props: Record<string, unknown>) => {
      excalidrawProps = props
      const give = props.excalidrawAPI as ((api: unknown) => void) | undefined
      if (give) {
        give({
          updateScene,
          getAppState: () => ({}),
          getSceneElements: () => sceneElements,
        })
      }
      return <div data-testid="excalidraw-editor">{props.children as React.ReactNode}</div>
    },
    exportToCanvas,
    getCommonBounds: vi.fn(() => [0, 0, 100, 100]),
    convertToExcalidrawElements,
    MainMenu: Object.assign(
      ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
      {
        Separator: () => <hr />,
        DefaultItems: {
          ToggleTheme: () => <button type="button">테마</button>,
          ClearCanvas: () => <button type="button">전체 지우기</button>,
          Help: () => <button type="button">도움말</button>,
        },
      },
    ),
  }),
  loadMermaid: () => Promise.resolve({ parseMermaidToExcalidraw }),
}))

const interpretApi = vi.hoisted(() => ({ interpretAnnotation: vi.fn() }))
vi.mock('@/features/live-session/annotationInterpret', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/features/live-session/annotationInterpret')),
  interpretAnnotation: interpretApi.interpretAnnotation,
}))

const { default: InstructorAnnotationLayer } = await import('@/features/live-session/InstructorAnnotationLayer')

/**
 * 요소를 실제로 쓴 마지막 `updateScene` 호출.
 *
 * <p>`.at(-1)`을 그냥 보면 안 된다 — 리렌더마다 프레임 매핑이 `appState`만 담아 호출하므로 우리가
 * 넣은 요소가 뒤로 밀린다.
 */
function lastSceneWrite(): readonly unknown[] | null {
  for (let i = updateScene.mock.calls.length - 1; i >= 0; i -= 1) {
    const arg = updateScene.mock.calls[i][0] as { elements?: readonly unknown[] }
    if (arg?.elements) return arg.elements
  }
  return null
}

/** 강사가 (500,300)-(800,500)에 그린 손그림 두 획. */
const DRAWN: AnnotationElement[] = [
  { id: 'a', type: 'freedraw', version: 1, x: 500, y: 300, points: [[0, 0], [300, 200]] },
  { id: 'b', type: 'freedraw', version: 1, x: 600, y: 350, points: [[0, 0], [50, 50]] },
] as unknown as AnnotationElement[]

describe('해석 결과 적용', () => {
  beforeEach(() => {
    sceneElements = [...DRAWN]
    excalidrawProps = {}
    updateScene.mockClear()
    exportToCanvas.mockResolvedValue({ toDataURL: () => 'data:image/png;base64,AAAA' })
    // mermaid가 자기 원점 (0,0)-(100,50)에 배치한 결과
    parseMermaidToExcalidraw.mockResolvedValue({ elements: [{ type: 'rectangle' }] })
    convertToExcalidrawElements.mockReturnValue([
      { id: 'm1', type: 'rectangle', version: 1, x: 0, y: 0, width: 100, height: 50 },
    ])
    interpretApi.interpretAnnotation.mockResolvedValue({
      kind: 'mermaid', body: 'flowchart LR\n  A[요청] --> B[인증]',
      replace: ['a', 'b'], confidence: 0.98, unreadable: false,
    })
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 960, height: 540, x: 0, y: 0, top: 0, left: 0, right: 960, bottom: 540,
      toJSON: () => ({}),
    } as DOMRect)
  })

  async function selectAndPick(label: string) {
    const view = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} restoredElements={null} />,
    )
    await view.findByTestId('excalidraw-editor')
    const onChange = excalidrawProps.onChange as (els: unknown[], state?: unknown) => void
    onChange(DRAWN, { selectedElementIds: { a: true, b: true } })

    await waitFor(() => { expect(view.getByText(label)).toBeTruthy() })
    view.getByText(label).closest('button')!.click()
    return view
  }

  /** 강사가 확인하기 전에는 화면이 바뀌면 안 된다 — 틀린 것으로 바뀌면 수강생은 이미 봤다. */
  it('확인 전에는 씬을 건드리지 않는다', async () => {
    const view = await selectAndPick('다이어그램')

    await waitFor(() => { expect(view.getByText('적용')).toBeTruthy() })

    const touched = updateScene.mock.calls.some(([arg]) =>
      (arg as { elements?: unknown[] }).elements?.some((e) => (e as { id?: string }).id === 'm1'))
    expect(touched).toBe(false)
  })

  it('적용하면 고른 것을 지우고 새 요소를 넣는다', async () => {
    const view = await selectAndPick('다이어그램')
    await waitFor(() => { expect(view.getByText('적용')).toBeTruthy() })

    view.getByText('적용').closest('button')!.click()

    await waitFor(() => {
      expect(lastSceneWrite()).not.toBeNull()
      expect(lastSceneWrite()!.map((e) => (e as { id: string }).id)).toEqual(['m1'])
    })
  })

  /**
   * 모델은 위치를 말한 적이 없고 mermaid는 자기 원점에서 배치했다. 원래 그린 자리에 겹쳐 놓는 일은
   * 우리가 한다 — 안 그러면 정리한 그림이 화면 구석에 나타난다.
   */
  it('새 요소를 원래 그린 자리 가운데로 옮긴다', async () => {
    const view = await selectAndPick('다이어그램')
    await waitFor(() => { expect(view.getByText('적용')).toBeTruthy() })

    view.getByText('적용').closest('button')!.click()

    await waitFor(() => {
      const written = lastSceneWrite()
      expect(written).not.toBeNull()
      const first = written![0] as { x: number; y: number }
      // 원본 bbox (500,300)-(800,500) 가운데에 100x50을 놓으면 (600, 375)
      expect([first.x, first.y]).toEqual([600, 375])
    })
  })

  /** 수식은 mermaid를 거치지 않는다. 잘못 태우면 LaTeX가 다이어그램 파서로 들어가 깨진다. */
  it('수식은 mermaid 변환을 거치지 않는다', async () => {
    interpretApi.interpretAnnotation.mockResolvedValue({
      kind: 'latex', body: 'y = ax^2 + bx + c', replace: ['a'], confidence: 0.98, unreadable: false,
    })
    convertToExcalidrawElements.mockReturnValue([
      { id: 't1', type: 'text', version: 1, x: 0, y: 0, width: 200, height: 40 },
    ])

    const view = await selectAndPick('수식')
    await waitFor(() => { expect(view.getByText('적용')).toBeTruthy() })
    view.getByText('적용').closest('button')!.click()

    await waitFor(() => { expect(convertToExcalidrawElements).toHaveBeenCalled() })
    expect(parseMermaidToExcalidraw).not.toHaveBeenCalled()
    // 글자 크기는 원본 손글씨 높이(200)에서 온다.
    const created = convertToExcalidrawElements.mock.calls.at(-1)![0] as { fontSize: number }[]
    expect(created[0].fontSize).toBe(72)
  })

  it('취소하면 아무것도 바뀌지 않는다', async () => {
    const view = await selectAndPick('다이어그램')
    await waitFor(() => { expect(view.getByText('취소')).toBeTruthy() })

    view.getByText('취소').closest('button')!.click()

    await waitFor(() => { expect(view.queryByText('적용')).toBeNull() })
    expect(convertToExcalidrawElements).not.toHaveBeenCalled()
  })
})
