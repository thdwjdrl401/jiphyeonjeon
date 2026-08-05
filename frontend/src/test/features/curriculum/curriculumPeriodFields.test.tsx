import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CurriculumPeriodFields from '@/features/curriculum/CurriculumPeriodFields'
import { isBeforeToday, todayLocalStart } from '@/shared/lib/localDateTime'

/** 오늘 0시에서 days만큼 옮긴 datetime-local 문자열. 실행 시점 타임존에 기대지 않기 위해 로컬로 만든다. */
function localStartShiftedByDays(days: number): string {
  const shifted = new Date(todayLocalStart())
  shifted.setDate(shifted.getDate() + days)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}T00:00`
}

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

  it('운영 종료일은 오늘 이전을 고를 수 없게 하한선을 건다', () => {
    render(
      <CurriculumPeriodFields idPrefix="t" value={{ startsAt: '', endsAt: '' }} onChange={vi.fn()} />,
    )

    // 시작일에는 하한선이 없다 — 이미 진행 중인 커리큘럼을 등록할 수 있어야 한다.
    expect(screen.getByLabelText('운영 시작일')).not.toHaveAttribute('min')
    expect(screen.getByLabelText('운영 종료일')).toHaveAttribute('min', todayLocalStart())
    expect(new Date(todayLocalStart()).getHours()).toBe(0)
  })

  it('오늘 이전 종료일만 과거로 판정하고 오늘 당일은 허용한다', () => {
    expect(isBeforeToday(localStartShiftedByDays(-1))).toBe(true)
    expect(isBeforeToday(todayLocalStart())).toBe(false)
    expect(isBeforeToday(localStartShiftedByDays(1))).toBe(false)
    // 비었거나 깨진 값은 다른 검증이 다룬다.
    expect(isBeforeToday('')).toBe(false)
    expect(isBeforeToday('2026-13-99T99:99')).toBe(false)
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
