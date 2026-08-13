import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '@/App'
import { mockAuthService, resetMockAuth } from '@/features/auth/mockAuthService'

/**
 * 내 프로필 화면을 **페이지 단위**로 확인한다. 카드 자체는 ProfileIdentityCard.test.tsx가 보고,
 * 여기서는 페이지에 합쳐진 결과를 본다.
 *
 * 가장 중요한 것은 **이메일이 페이지 전체에서 한 번만** 보이는 것이다. 예전에는 "계정 정보"·
 * "기본 프로필" 두 패널이 각각 이메일을 표시했다. 카드만 따로 보면 한 번이라 통과하므로
 * 페이지에서 세어야 회귀가 잡힌다.
 */

function renderAt(path: string) {
  window.history.pushState({}, '', path)
  return render(<App />)
}

describe('내 프로필 화면', () => {
  beforeEach(() => {
    resetMockAuth()
    window.history.replaceState({}, '', '/')
  })

  it.each([
    ['학생', '/student/profile', 'student01@example.com', '학생', '김학생'],
    ['강사', '/instructor/profile', 'instructor@liveclass.ai', '강사', '이도현'],
  ])('%s 계정에서 같은 프로필 카드를 쓰고 이메일을 한 번만 표시한다', async (
    _label, path, email, roleLabel, displayName,
  ) => {
    await mockAuthService.login({ email, password: 'password1' })
    renderAt(path)

    await screen.findByRole('heading', { name: '내 프로필', level: 1 })
    // 카드는 이름으로 라벨링된 region이다.
    const card = await screen.findByRole('region', { name: displayName })

    // 학생·강사가 같은 컴포넌트를 쓰므로 카드 구조가 같아야 한다.
    expect(within(card).getByText(email)).toBeInTheDocument()
    expect(within(card).getByText(roleLabel)).toBeInTheDocument()

    // 카드 안이 아니라 화면 전체에서 한 번 — 두 패널로 갈라져 있던 구조로 돌아가면 여기서 잡힌다.
    expect(screen.getAllByText(email)).toHaveLength(1)

    // 읽기 전용 정보가 입력 필드로 새어 나오지 않는다.
    expect(within(card).queryByRole('textbox')).not.toBeInTheDocument()
  })

  it.each([
    ['학생', '/student/profile', 'student01@example.com'],
    ['강사', '/instructor/profile', 'instructor@liveclass.ai'],
  ])('%s 프로필은 처음에 읽기 전용이며 수정 버튼을 눌러야 기본 정보 폼을 연다', async (
    _label, path, email,
  ) => {
    const user = userEvent.setup()
    await mockAuthService.login({ email, password: 'password1' })
    renderAt(path)

    expect(screen.queryByLabelText('닉네임')).not.toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: '프로필 수정' }))
    expect(await screen.findByRole('dialog', { name: '프로필 수정' })).toBeInTheDocument()
  })

  it('예전의 분리된 두 카드 제목을 더 이상 쓰지 않는다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderAt('/student/profile')

    await screen.findByRole('heading', { name: '내 프로필', level: 1 })
    expect(screen.queryByRole('heading', { name: '계정 정보' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '기본 프로필' })).not.toBeInTheDocument()
  })

  it('프로필 수정 모달을 닫으면 진입 버튼으로 포커스가 돌아온다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })
    renderAt('/instructor/profile')

    const editButton = await screen.findByRole('button', { name: '프로필 수정' })
    await user.click(editButton)

    const dialog = await screen.findByRole('dialog', { name: '프로필 수정' })
    // 수정 가능한 것은 닉네임과 이미지뿐이다(가입 유형·이메일은 모달에도 없다).
    expect(within(dialog).getByLabelText(/닉네임/)).toBeInTheDocument()
    expect(within(dialog).getByLabelText('프로필 이미지 선택')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '취소' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // 키보드 사용자가 모달을 닫은 뒤 원래 자리로 돌아와야 한다.
    await waitFor(() => expect(screen.getByRole('button', { name: '프로필 수정' })).toHaveFocus())
  })

  it('학생은 계정 설정만, 강사는 읽기 전용 공개 프로필과 계정 설정을 표시한다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    const student = renderAt('/student/profile')
    /*
      학생의 왼쪽 카드는 닉네임·이미지를 고치는 "프로필 수정"이다. 학생에게는 커리큘럼 상세에
      공개되는 값이 없으므로 "공개 프로필"이라는 이름을 쓰지 않는다.
    */
    await screen.findByRole('heading', { name: '계정 설정' })
    expect(screen.queryByRole('heading', { name: '프로필 수정' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '강사 공개 프로필' })).not.toBeInTheDocument()
    student.unmount()

    resetMockAuth()
    await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })
    renderAt('/instructor/profile')
    // 강사 화면은 두 카드다 — 왼쪽 공개 프로필, 오른쪽 계정 설정.
    await screen.findByRole('heading', { name: '강사 공개 프로필' })
    expect(screen.getByRole('heading', { name: '계정 설정' })).toBeInTheDocument()
    expect(screen.queryByLabelText('강사 소개')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '공개 프로필 수정' })).toHaveClass('button--primary')
  })

  /**
   * 이 화면은 요약 통계를 두지 않는다(ADR-0011). 진도·커리큘럼 현황은 대시보드와 내 커리큘럼이
   * 이미 보여 주고, 한 페이지에 계정 정보를 다 담으려면 그 자리가 필요하다. 되살아나면 카드가
   * 늘어나 스크롤이 생기므로 두 역할 모두에서 없음을 단정한다.
   */
  it.each([
    ['학생', '/student/profile', 'student01@example.com', ['수강 중인 커리큘럼', '완료한 커리큘럼', '평균 진행률', '완료한 강의']],
    ['강사', '/instructor/profile', 'instructor@liveclass.ai', ['전체 커리큘럼', '공개 중', '예정 라이브', '수강생']],
  ] as const)('%s 화면에 요약 통계를 두지 않는다', async (_label, path, email, labels) => {
    await mockAuthService.login({ email, password: 'password1' })
    renderAt(path)

    await screen.findByRole('heading', { name: '계정 설정' })
    labels.forEach((label) => expect(screen.queryByText(label)).not.toBeInTheDocument())
  })

  /**
   * 비밀번호 변경과 회원 탈퇴는 "계정 설정" 카드 한 장에 함께 있고(ADR-0011), 탈퇴는 카드에
   * 진입 행만 둔다 — 안내 전문과 동의는 모달이 갖는다. 패널·모달 자체의 규칙은
   * AccountWithdrawPanel.test.tsx가 따로 본다.
   */
  it('계정 설정 카드에 비밀번호 변경과 회원 탈퇴 진입을 함께 둔다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderAt('/student/profile')

    const panel = (await screen.findByRole('heading', { name: '계정 설정' })).closest('section')!
    expect(within(panel).getByLabelText('현재 비밀번호')).toBeInTheDocument()
    // 오타로 바꾼 비밀번호는 로그인 실패로만 드러나므로 확인 필드가 유일한 방어다.
    expect(within(panel).getByLabelText('새 비밀번호 확인')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: '회원 탈퇴' })).toBeInTheDocument()

    // 한 카드에 두 기능이 있으므로 각 블록이 소제목을 갖는다 — 구분선만으로는 경계가 읽히지 않는다.
    expect(within(panel).getByRole('heading', { name: '비밀번호 변경', level: 3 })).toBeInTheDocument()
    expect(within(panel).getByRole('heading', { name: '회원 탈퇴', level: 3 })).toBeInTheDocument()

    // 안내와 동의는 카드가 아니라 모달에 있다 — 누르기 전에는 화면에 없다.
    expect(screen.queryByRole('checkbox', { name: /위 안내 사항을 모두 확인하였으며/ })).not.toBeInTheDocument()
  })

  it('비밀번호 변경 폼에서 재설정 화면으로 갈 수 있다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderAt('/student/profile')

    // 로그인한 사람도 현재 비밀번호를 모르면 이 링크로 나가야 한다 — 게스트 전용 라우트면 튕긴다.
    await user.click(await screen.findByRole('link', { name: '비밀번호를 잊으셨나요?' }))
    await screen.findByRole('heading', { name: '비밀번호를 잊으셨나요?' })
  })

  it('현재 비밀번호와 같은 새 비밀번호는 안내하고 제출하지 않는다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderAt('/student/profile')

    await user.type(await screen.findByLabelText('현재 비밀번호'), 'password1')
    await user.type(screen.getByLabelText('새 비밀번호'), 'password1')
    await user.type(screen.getByLabelText('새 비밀번호 확인'), 'password1')

    expect(screen.getByText('새 비밀번호는 현재 비밀번호와 다르게 입력해 주세요.')).toBeInTheDocument()
    expect(screen.getByLabelText('새 비밀번호')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: '비밀번호 변경' })).toBeDisabled()
  })

  it('회원 탈퇴 안내가 실제 동작(소프트 삭제·재가입 허용)을 말한다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderAt('/student/profile')

    // 안내는 모달로 옮겼다(ADR-0011) — 문장은 그대로다.
    await user.click(await screen.findByRole('button', { name: '회원 탈퇴' }))
    const dialog = await screen.findByRole('dialog', { name: '회원 탈퇴' })

    expect(within(dialog).getByText('회원 탈퇴 시 계정이 비활성화되어 더 이상 로그인할 수 없습니다.')).toBeInTheDocument()
    expect(within(dialog).getByText('강의, 커리큘럼 및 학습 기록은 서비스 운영을 위해 보존됩니다.')).toBeInTheDocument()
    expect(within(dialog).getByText('동일한 이메일로 언제든지 다시 회원가입할 수 있습니다.')).toBeInTheDocument()

    // 탈퇴는 소프트 삭제다(ADR-0031). "즉시 삭제·복구 불가" 류 문구가 되살아나면 거짓 고지가 된다.
    expect(screen.queryByText(/복구할 수 없습니다/)).not.toBeInTheDocument()
    expect(screen.queryByText(/영구적으로 사라집니다/)).not.toBeInTheDocument()
    expect(screen.queryByText(/재가입이 제한/)).not.toBeInTheDocument()
  })
})
