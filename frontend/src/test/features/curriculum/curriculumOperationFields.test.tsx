import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CurriculumPeriodFields from '@/features/curriculum/CurriculumPeriodFields'
import EnrollmentPolicyField, {
  ENROLLMENT_POLICY_OPTIONS,
  type EnrollmentPolicyOption,
} from '@/features/curriculum/EnrollmentPolicyField'

describe('CurriculumPeriodFields', () => {
  it('모집·공개 기간이 아니라 운영 기간임을 라벨과 보조 설명으로 알린다', () => {
    render(
      <CurriculumPeriodFields idPrefix="t" value={{ startsAt: '', endsAt: '' }} onChange={vi.fn()} />,
    )

    expect(screen.getByRole('group', { name: '커리큘럼 운영 기간' })).toBeInTheDocument()
    expect(screen.getByLabelText('운영 시작일')).toBeInTheDocument()
    expect(screen.getByLabelText('운영 종료일')).toBeInTheDocument()
    expect(
      screen.getByText(/수강 신청을 받는 기간이나 개별 강의 공개일과는 별개예요/),
    ).toBeInTheDocument()
  })

  it('시작·종료를 모두 넣으면 읽을 수 있는 기간과 총 길이를 되읽어 준다', () => {
    render(
      <CurriculumPeriodFields
        idPrefix="t"
        value={{ startsAt: '2026-08-01T10:00', endsAt: '2026-10-15T22:00' }}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText(/2026년 8월 1일/)).toBeInTheDocument()
    expect(screen.getByText(/2026년 10월 15일/)).toBeInTheDocument()
    expect(screen.getByText('약 11주 과정')).toBeInTheDocument()
  })

  it('한쪽만 입력했으면 나머지를 미정으로 표시하고 길이는 계산하지 않는다', () => {
    render(
      <CurriculumPeriodFields
        idPrefix="t"
        value={{ startsAt: '2026-08-01T10:00', endsAt: '' }}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('group', { name: '커리큘럼 운영 기간' })).toHaveTextContent('종료일 미정')
    expect(screen.queryByText(/과정$/)).not.toBeInTheDocument()
  })

  it('입력한 필드 이름과 값을 그대로 올려보낸다', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <CurriculumPeriodFields idPrefix="t" value={{ startsAt: '', endsAt: '' }} onChange={onChange} />,
    )

    await user.type(screen.getByLabelText('운영 시작일'), '2026-08-01T10:00')
    expect(onChange).toHaveBeenCalledWith('startsAt', expect.any(String))
  })
})

describe('EnrollmentPolicyField', () => {
  it('고를 수 있는 값이 하나면 라디오 대신 고정 정책 문장으로 알린다', () => {
    render(<EnrollmentPolicyField value="APPROVAL_REQUIRED" />)

    expect(screen.getByText('강사 승인 후 수강')).toBeInTheDocument()
    expect(screen.getByText(/지금은 모든 커리큘럼이 이 방식으로 운영돼요/)).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })

  it('현재 제공하는 수강 방식은 강사 승인 하나뿐이다', () => {
    expect(ENROLLMENT_POLICY_OPTIONS.map((option) => option.value)).toEqual(['APPROVAL_REQUIRED'])
  })

  // 서버가 enrollmentType을 받기 시작하면 옵션과 onChange만 넘겨 선택형으로 바꾼다.
  it('옵션과 onChange를 넘기면 그대로 선택형 라디오가 된다', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const options: EnrollmentPolicyOption[] = [
      ...ENROLLMENT_POLICY_OPTIONS,
      { value: 'IMMEDIATE', label: '즉시 수강 가능', description: '신청하면 바로 수강이 시작돼요.' },
    ]

    render(<EnrollmentPolicyField options={options} value="APPROVAL_REQUIRED" onChange={onChange} />)

    expect(screen.getByRole('radio', { name: /강사 승인 후 수강/ })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: /즉시 수강 가능/ }))
    expect(onChange).toHaveBeenCalledWith('IMMEDIATE')
  })
})
