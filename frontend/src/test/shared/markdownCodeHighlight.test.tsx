import { render, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import Markdown from '@/shared/ui/Markdown'

/**
 * 코드 블록 문법 강조(ADR-0097).
 *
 * <p>지키는 것은 셋이다 — <b>언어를 밝힌 코드만 칠하는가</b>, <b>안 밝혔거나 모르는 언어면 깨지지 않고
 * 그대로 나오는가</b>, <b>덜 온 코드에도 터지지 않는가</b>.
 *
 * <p>가운데가 이 결정의 핵심이다. 자동 감지를 켜지 않았다 — 짧은 조각에서 자주 틀리는데
 * <b>코드를 가르치는 화면</b>이라 잘못 칠한 색이 색이 없는 것보다 나쁘다.
 */
beforeAll(async () => {
  await import('@/shared/ui/MarkdownBody')
}, 120_000)

const fence = (lang: string, code: string) => ['```' + lang, code, '```'].join('\n')

describe('코드 블록 문법 강조', () => {
  it('언어를 밝힌 코드는 토큰으로 쪼갠다', async () => {
    const { container } = render(<Markdown markdown={fence('java', 'public class A { }')} />)

    await waitFor(() => expect(container.querySelector('code.hljs')).not.toBeNull())
    const code = container.querySelector('pre code')
    expect(code?.querySelectorAll('.hljs-keyword').length).toBeGreaterThan(0)
    // 쪼갰다고 코드가 바뀌면 안 된다 — 화면에 보이는 글자는 원문 그대로다.
    expect(code?.textContent).toBe('public class A { }\n')
  })

  it('등록한 언어만 칠한다 — 나머지는 강조 없이 그대로 남는다', async () => {
    // 어떤 수업이 올지 다 알 수 없다. 모르는 언어가 와도 코드가 사라지거나 깨지면 안 된다.
    const { container } = render(<Markdown markdown={fence('brainfuck', '++[>+<-]')} />)

    await waitFor(() => expect(container.querySelector('pre code')?.textContent).toContain('++[>+<-]'))
    expect(container.querySelector('code.hljs')).toBeNull()
    expect(container.querySelectorAll('[class^="hljs-"]').length).toBe(0)
  })

  /**
   * 자동 감지를 켜지 않은 결과다. 모델이 언어를 안 밝히면 <b>칠하지 않는다</b> — 짧은 조각을 잘못
   * 감지해 엉뚱한 색을 입히느니 등폭 글꼴 상자로 두는 편이 낫다.
   */
  it('언어를 밝히지 않은 코드는 칠하지 않는다', async () => {
    const { container } = render(<Markdown markdown={'```\nselect 1\n```'} />)

    await waitFor(() => expect(container.querySelector('pre code')?.textContent).toContain('select 1'))
    expect(container.querySelector('code.hljs')).toBeNull()
  })

  it('문장 속 인라인 코드는 건드리지 않는다', async () => {
    // `pre` 밖의 code는 낱말이라 강조할 문법이 없다.
    const { container } = render(<Markdown markdown={'`SecurityContext`를 담는다'} />)

    await waitFor(() => expect(container.querySelector('code')).not.toBeNull())
    expect(container.querySelector('code')?.className).toBe('')
    expect(container.querySelector('pre')).toBeNull()
  })

  /**
   * 스트리밍 중에는 코드가 <b>덜 온 상태</b>로 들어온다 — 따옴표가 안 닫히고 괄호가 열린 채다.
   * 그 상태로도 답변이 빈 화면이 되면 안 된다.
   */
  it('덜 온 코드도 그리다 만 채로 보여준다', async () => {
    const { container } = render(<Markdown markdown={'```java\npublic class A { String s = "안 닫힌'} />)

    await waitFor(() => expect(container.querySelector('pre code')).not.toBeNull())
    expect(container.querySelector('pre code')?.textContent).toContain('안 닫힌')
  })

  it('링크 차단은 코드 안에서도 유지된다', async () => {
    // 강조가 붙으면서 링크가 되살아나면 안 된다 — 주소가 코드 블록 안에 있어도 눌리면 안 된다.
    const { container } = render(
      <Markdown markdown={fence('bash', 'curl https://evil.example.com/x')} />,
    )

    await waitFor(() => expect(container.querySelector('pre code')?.textContent).toContain('curl'))
    expect(container.querySelector('a')).toBeNull()
  })
})
