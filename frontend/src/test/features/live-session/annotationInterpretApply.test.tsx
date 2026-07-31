import type React from 'react'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnnotationElement } from '@/features/live-session/annotation'

/**
 * 해석 결과를 <b>바로</b> 씬에 넣는 경로(ADR-0054, §3-6e).
 *
 * <p>처음에는 적용 전에 강사 확인을 받았다. 모델이 낸 `confidence`를 믿을 수 없다는 실측(틀린 한글
 * 라벨에 1.0)이 근거였다. 그런데 실제로 써 보니 매 정리마다 확인 창이 강의 흐름을 끊었고, 잘못
 * 나온 것을 <b>되돌리는 비용이 훨씬 쌌다</b> — 강사는 이미 Excalidraw의 되돌리기를 쓰고 있다.
 *
 * <p>그래서 확인 절차를 없앴다. 다만 그 결정은 <b>되돌리기가 실제로 된다는 전제</b> 위에 선다.
 * 프로그램으로 넣은 변경은 기본적으로 되돌리기 스택에 올라가지 않는다.
 */

const updateScene = vi.fn()
const exportToCanvas = vi.fn()
const parseMermaidToExcalidraw = vi.fn()
const convertToExcalidrawElements = vi.fn()
const addFiles = vi.fn()
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
          getFiles: () => ({}),
          addFiles: addFiles,
        })
      }
      return <div data-testid="excalidraw-editor">{props.children as React.ReactNode}</div>
    },
    exportToCanvas,
    getCommonBounds: vi.fn(() => [0, 0, 100, 100]),
    convertToExcalidrawElements,
    CaptureUpdateAction: { IMMEDIATELY: 'IMMEDIATELY', NEVER: 'NEVER', EVENTUALLY: 'EVENTUALLY' },
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

/** 수식은 그림으로 들어간다. MathJax는 무겁고 jsdom에서 돌릴 이유도 없어 결과만 흉내낸다. */
const mathApi = vi.hoisted(() => ({
  renderMathSvg: vi.fn(),
  mathFileEntry: vi.fn(),
}))
vi.mock('@/features/live-session/mathRuntime', () => mathApi)

const interpretApi = vi.hoisted(() => ({ interpretAnnotation: vi.fn() }))
vi.mock('@/features/live-session/annotationInterpret', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/features/live-session/annotationInterpret')),
  interpretAnnotation: interpretApi.interpretAnnotation,
}))

const { default: InstructorAnnotationLayer } = await import('@/features/live-session/InstructorAnnotationLayer')

/** 요소를 실제로 쓴 마지막 `updateScene` 호출. 리렌더마다 appState만 담은 호출이 뒤에 붙는다. */
function lastSceneWrite(): { elements: readonly unknown[]; captureUpdate?: string } | null {
  for (let i = updateScene.mock.calls.length - 1; i >= 0; i -= 1) {
    const arg = updateScene.mock.calls[i][0] as { elements?: readonly unknown[]; captureUpdate?: string }
    if (arg?.elements) return arg as { elements: readonly unknown[]; captureUpdate?: string }
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
    addFiles.mockClear()
    exportToCanvas.mockResolvedValue({ toDataURL: () => 'data:image/png;base64,AAAA' })
    parseMermaidToExcalidraw.mockResolvedValue({ elements: [{ type: 'rectangle' }] })
    convertToExcalidrawElements.mockReturnValue([
      { id: 'm1', type: 'rectangle', version: 1, x: 0, y: 0, width: 100, height: 50 },
    ])
    interpretApi.interpretAnnotation.mockResolvedValue({
      kind: 'mermaid', body: 'flowchart LR\n  A[요청] --> B[인증]', source: '',
      replace: ['a', 'b'], confidence: 0.98, unreadable: false,
    })
    mathApi.renderMathSvg.mockResolvedValue({ dataUrl: 'data:image/svg+xml;utf8,<svg/>', width: 200, height: 40 })
    mathApi.mathFileEntry.mockImplementation((id: string) => ({
      [id]: { id, mimeType: 'image/svg+xml', dataURL: 'data:image/svg+xml;utf8,<svg/>', created: 0 },
    }))
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 960, height: 540, x: 0, y: 0, top: 0, left: 0, right: 960, bottom: 540,
      toJSON: () => ({}),
    } as DOMRect)
  })

  async function selectAndPick(label: string) {
    const view = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} restoredElements={null} restoredFiles={null} />,
    )
    await view.findByTestId('excalidraw-editor')
    const onChange = excalidrawProps.onChange as (els: unknown[], state?: unknown) => void
    onChange(DRAWN, { selectedElementIds: { a: true, b: true } })

    await waitFor(() => { expect(view.getByText(label)).toBeTruthy() })
    view.getByText(label).closest('button')!.click()
    return view
  }

  it('고르면 확인 없이 바로 넣고, 고른 것은 지운다', async () => {
    await selectAndPick('다이어그램')

    await waitFor(() => {
      expect(lastSceneWrite()).not.toBeNull()
      expect(lastSceneWrite()!.elements.map((e) => (e as { id: string }).id)).toEqual(['m1'])
    })
  })

  /**
   * <b>이 테스트가 확인 절차를 없앤 결정을 떠받친다.</b> 프로그램으로 넣은 변경은 기본적으로
   * 되돌리기 스택에 올라가지 않는다. 이게 빠지면 잘못 나온 정리를 강사가 손으로 지워야 한다.
   */
  it('되돌리기로 취소할 수 있게 넣는다', async () => {
    await selectAndPick('다이어그램')

    await waitFor(() => { expect(lastSceneWrite()).not.toBeNull() })
    expect(lastSceneWrite()!.captureUpdate).toBe('IMMEDIATELY')
  })

  /** 바로 적용되므로 무슨 일이 일어났는지와 되돌리는 방법은 알려 줘야 한다. */
  it('무엇을 넣었는지와 되돌리는 방법을 알린다', async () => {
    const view = await selectAndPick('다이어그램')

    await waitFor(() => {
      const applied = view.container.querySelector('.annotation-interpret-applied')
      expect(applied?.textContent).toContain('다이어그램으로 정리했습니다')
      expect(applied?.textContent).toContain('Ctrl')
    })
  })

  /**
   * 모델은 위치도 크기도 말한 적이 없고 mermaid는 자기 기준으로 배치했다. 원래 그린 자리에 그만한
   * 크기로 얹는 일은 우리가 한다 — 안 그러면 정리한 그림이 엉뚱한 자리에 엉뚱한 크기로 나타난다.
   */
  it('새 요소를 원래 그린 자리·크기에 맞춘다', async () => {
    await selectAndPick('다이어그램')

    await waitFor(() => {
      const written = lastSceneWrite()
      expect(written).not.toBeNull()
      const first = written!.elements[0] as { x: number; y: number; width: number }
      // 원본 (500,300)-(800,500)에 100x50을 맞추면 짧은 쪽(가로) 기준 3배 → 300x150
      expect(first.width).toBe(300)
      expect([first.x, first.y]).toEqual([500, 325])
    })
  })

  /** 수식은 mermaid를 거치지 않는다. 잘못 태우면 유니코드 수식이 다이어그램 파서로 들어가 깨진다. */
  it('수식은 mermaid 변환을 거치지 않는다', async () => {
    interpretApi.interpretAnnotation.mockResolvedValue({
      kind: 'math', body: 'y = ax² + bx + c', source: 'y = ax^2 + bx + c',
      replace: ['a'], confidence: 0.98, unreadable: false,
    })
    convertToExcalidrawElements.mockReturnValue([
      { id: 't1', type: 'image', version: 1, x: 0, y: 0, width: 200, height: 40, fileId: 'f1' },
    ])

    await selectAndPick('수식')

    await waitFor(() => { expect(convertToExcalidrawElements).toHaveBeenCalled() })
    expect(parseMermaidToExcalidraw).not.toHaveBeenCalled()
    // 분수·적분의 상하 구조는 글자로 표현할 수 없어 렌더한 그림으로 넣는다.
    const created = convertToExcalidrawElements.mock.calls.at(-1)![0] as Record<string, unknown>[]
    expect(created[0].type).toBe('image')
    // LaTeX 원문을 요소에 붙여 둔다 — 그림이 되면 내용을 고칠 수 없으므로 다시 렌더할 근거가 필요하다.
    expect((created[0].customData as { liveclassMathLatex: string }).liveclassMathLatex)
      .toBe('y = ax^2 + bx + c')
  })

  /**
   * 이미지 요소는 데이터를 담지 않고 `fileId`로 가리키기만 한다. 파일을 함께 넣지 않으면 수식이
   * <b>빈 자리로</b> 합성된다 — 강사 화면에는 보이는데 수강생과 녹화에는 없다.
   */
  it('수식 그림을 파일과 함께 넣는다', async () => {
    interpretApi.interpretAnnotation.mockResolvedValue({
      kind: 'math', body: 'y = ax² + bx + c', source: 'y = ax^2 + bx + c',
      replace: ['a'], confidence: 0.98, unreadable: false,
    })
    convertToExcalidrawElements.mockReturnValue([
      { id: 't1', type: 'image', version: 1, x: 0, y: 0, width: 200, height: 40, fileId: 'f1' },
    ])

    await selectAndPick('수식')

    await waitFor(() => {
      // `updateScene`은 files를 받지 않는다. 거기 실어 보내면 조용히 버려지고 이미지 요소만
      // 남아 그림이 보이지 않는다 — 실제로 그렇게 배포할 뻔했다.
      expect(addFiles).toHaveBeenCalled()
      expect(addFiles.mock.calls[0][0]).toHaveLength(1)
    })
  })

  /** 읽지 못한 것을 넣지 않는다. 지어낸 것을 판서에 올리는 것보다 못 읽었다고 말하는 편이 낫다. */
  it('읽지 못했으면 아무것도 넣지 않고 알린다', async () => {
    interpretApi.interpretAnnotation.mockResolvedValue({
      kind: 'mermaid', body: '', source: '', replace: [], confidence: 0.1, unreadable: true,
    })

    const view = await selectAndPick('다이어그램')

    await waitFor(() => {
      expect(view.container.querySelector('.annotation-interpret-failure')?.textContent)
        .toContain('알아보지 못했습니다')
    })
    expect(convertToExcalidrawElements).not.toHaveBeenCalled()
  })
})

/**
 * 수식 재편집(ADR-0051 · ADR-0054).
 *
 * <p>수식을 그림으로 넣는 순간 내용을 고칠 수 없게 된다. ADR-0051이 Excalidraw를 고른 이유가
 * "결과가 이미지가 아니라 다시 고칠 수 있는 객체여야 한다"였으므로, 그대로 두면 그 전제를 깬다.
 * 그래서 넣을 때 LaTeX 원문을 요소에 붙여 두고 여기서 꺼내 다시 렌더한다 — 이 경로가 없으면
 * 수식을 그림으로 넣기로 한 결정 자체가 성립하지 않는다.
 */
describe('수식 재편집', () => {
  const MATH_ELEMENT = {
    id: 'm', type: 'image', version: 1, x: 100, y: 100, width: 200, height: 50,
    fileId: 'f1', customData: { liveclassMathLatex: 'y = ax^2' },
  } as unknown as AnnotationElement

  async function selectMath() {
    sceneElements = [MATH_ELEMENT]
    const view = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} restoredElements={null} restoredFiles={null} />,
    )
    await view.findByTestId('excalidraw-editor')
    const onChange = excalidrawProps.onChange as (els: unknown[], state?: unknown) => void
    onChange([MATH_ELEMENT], { selectedElementIds: { m: true } })
    return view
  }

  it('우리가 넣은 수식을 고르면 고치기가 뜬다', async () => {
    const view = await selectMath()

    await waitFor(() => { expect(view.getByText('수식 고치기')).toBeTruthy() })
  })

  it('보통 판서를 고르면 고치기가 뜨지 않는다 — 고칠 LaTeX가 없다', async () => {
    sceneElements = [...DRAWN]
    const view = render(
      <InstructorAnnotationLayer sessionId="ses-1" active audienceRevision={0} showPropertyPanel={false} whiteboard={false} onLaser={vi.fn()} onPublish={vi.fn()} restoredElements={null} restoredFiles={null} />,
    )
    await view.findByTestId('excalidraw-editor')
    ;(excalidrawProps.onChange as (els: unknown[], state?: unknown) => void)(
      DRAWN, { selectedElementIds: { a: true } })

    await waitFor(() => { expect(view.container.querySelector('.annotation-action-ring')).not.toBeNull() })
    expect(view.queryByText('수식 고치기')).toBeNull()
  })

  it('붙여 둔 LaTeX를 그대로 꺼내 보여 준다', async () => {
    const view = await selectMath()
    await waitFor(() => { expect(view.getByText('수식 고치기')).toBeTruthy() })

    view.getByText('수식 고치기').click()

    await waitFor(() => {
      expect(view.container.querySelector<HTMLInputElement>('#annotation-math-input')!.value)
        .toBe('y = ax^2')
    })
  })

  it('고쳐서 다시 렌더하면 그 LaTeX로 갈아 끼운다', async () => {
    convertToExcalidrawElements.mockReturnValue([
      { id: 'm2', type: 'image', version: 1, x: 0, y: 0, width: 200, height: 50, fileId: 'f2' },
    ])
    const view = await selectMath()
    await waitFor(() => { expect(view.getByText('수식 고치기')).toBeTruthy() })
    view.getByText('수식 고치기').click()
    await waitFor(() => { expect(view.container.querySelector('#annotation-math-input')).not.toBeNull() })

    // React 제어 입력이라 value를 직접 넣으면 상태가 바뀌지 않는다. fireEvent가 그 처리를 한다.
    fireEvent.change(view.container.querySelector('#annotation-math-input')!,
      { target: { value: 'y = bx^3' } })
    fireEvent.submit(view.container.querySelector('form.annotation-math-editor')!)

    await waitFor(() => { expect(mathApi.renderMathSvg).toHaveBeenCalledWith('y = bx^3', expect.any(Number)) })
    // 원본은 지우고 새 그림만 남는다.
    await waitFor(() => {
      expect(lastSceneWrite()!.elements.map((e) => (e as { id: string }).id)).toEqual(['m2'])
    })
  })
})
