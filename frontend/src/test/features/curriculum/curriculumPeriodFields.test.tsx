import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CurriculumPeriodFields from '@/features/curriculum/CurriculumPeriodFields'
import {
  isDateBeforeToday,
  todayLocalDate,
  toIsoAtEndOfDayOrNull,
  toIsoAtStartOfDayOrNull,
} from '@/shared/lib/localDateTime'

/** 오늘에서 days만큼 옮긴 date 문자열. 실행 시점 타임존에 기대지 않기 위해 로컬로 만든다. */
function localDateShiftedByDays(days: number): string {
  const shifted = new Date(`${todayLocalDate()}T00:00`)
  shifted.setDate(shifted.getDate() + days)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`
}

describe('CurriculumPeriodFields', () => {
  it('모집·공개 기간이 아니라 운영 기간임을 라벨과 보조 설명으로 알린다', () => {
    render(
      <CurriculumPeriodFields idPrefix="t" value={{ startsAt: '', endsAt: '' }} onChange={vi.fn()} />,
    )

    expect(screen.getByRole('group', { name: '커리큘럼 운영 기간' })).toBeInTheDocument()
    expect(screen.getByLabelText('운영 시작일')).toBeInTheDocument()
    expect(screen.getByLabelText('운영 종료일')).toBeInTheDocument()
    expect(screen.getByLabelText('운영 시작일')).toHaveAttribute('name', 'startsAt')
    expect(screen.getByLabelText('운영 종료일')).toHaveAttribute('name', 'endsAt')
    expect(screen.getByLabelText('운영 시작일')).toHaveAttribute('type', 'date')
    expect(screen.getByLabelText('운영 종료일')).toHaveAttribute('type', 'date')
    expect(
      screen.getByText(/수강 신청을 받는 기간이나 개별 강의 공개일과는 별개예요/),
    ).toBeInTheDocument()
  })

  it('시작·종료를 모두 넣으면 읽을 수 있는 기간과 총 길이를 되읽어 준다', () => {
    render(
      <CurriculumPeriodFields
        idPrefix="t"
        value={{ startsAt: '2026-08-01', endsAt: '2026-10-15' }}
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
        value={{ startsAt: '2026-08-01', endsAt: '' }}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('group', { name: '커리큘럼 운영 기간' })).toHaveTextContent('종료일 미정')
    expect(screen.queryByText(/과정$/)).not.toBeInTheDocument()
  })

  it('시작일과 종료일이 같으면 1일 과정으로 안내한다', () => {
    render(
      <CurriculumPeriodFields
        idPrefix="t"
        value={{ startsAt: '2026-08-01', endsAt: '2026-08-01' }}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('1일 과정')).toBeInTheDocument()
  })

  it('운영 종료일은 오늘 이전을 고를 수 없게 하한선을 건다', () => {
    render(
      <CurriculumPeriodFields idPrefix="t" value={{ startsAt: '', endsAt: '' }} onChange={vi.fn()} />,
    )

    // 시작일에는 하한선이 없다 — 이미 진행 중인 커리큘럼을 등록할 수 있어야 한다.
    expect(screen.getByLabelText('운영 시작일')).not.toHaveAttribute('min')
    expect(screen.getByLabelText('운영 종료일')).toHaveAttribute('min', todayLocalDate())
  })

  it('오늘 이전 종료일만 과거로 판정하고 오늘 당일은 허용한다', () => {
    expect(isDateBeforeToday(localDateShiftedByDays(-1))).toBe(true)
    expect(isDateBeforeToday(todayLocalDate())).toBe(false)
    expect(isDateBeforeToday(localDateShiftedByDays(1))).toBe(false)
    // 비었거나 깨진 값은 다른 검증이 다룬다.
    expect(isDateBeforeToday('')).toBe(false)
    expect(isDateBeforeToday('2026-13-99')).toBe(false)
  })

  it('입력한 필드 이름과 날짜를 그대로 올려보낸다', () => {
    const onChange = vi.fn()
    render(
      <CurriculumPeriodFields idPrefix="t" value={{ startsAt: '', endsAt: '' }} onChange={onChange} />,
    )

    fireEvent.change(screen.getByLabelText('운영 시작일'), { target: { value: '2026-08-01' } })
    expect(onChange).toHaveBeenCalledWith('startsAt', '2026-08-01')
  })

  it('시작일은 0시, 종료일은 하루의 끝으로 서버에 보낼 수 있게 변환한다', () => {
    const expectedStart = new Date(2026, 7, 1)
    const expectedEnd = new Date(2026, 7, 2)
    expectedEnd.setMilliseconds(-1)

    expect(toIsoAtStartOfDayOrNull('2026-08-01')).toBe(expectedStart.toISOString())
    expect(toIsoAtEndOfDayOrNull('2026-08-01')).toBe(expectedEnd.toISOString())
  })
})
