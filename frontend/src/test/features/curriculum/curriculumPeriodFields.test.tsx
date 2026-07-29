import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CurriculumPeriodFields from '@/features/curriculum/CurriculumPeriodFields'

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
