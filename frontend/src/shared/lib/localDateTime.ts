/**
 * datetime-local 입력이 그대로 받는 "오늘 0시" 문자열.
 * 0시로 잡아 오늘 안의 시각은 모두 허용하고 어제까지만 막는다.
 */
export function todayLocalStart(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T00:00`
}

/** date 입력이 그대로 받는 오늘 날짜 문자열. */
export function todayLocalDate(): string {
  return todayLocalStart().slice(0, 10)
}

/** YYYY-MM-DD를 UTC로 오해하지 않고 사용자의 지역 날짜 자정으로 해석한다. */
function parseLocalDate(localDate: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate)
  if (!match) return null
  const [, yearText, monthText, dayText] = match
  const year = Number(yearText)
  const month = Number(monthText) - 1
  const day = Number(dayText)
  const parsed = new Date(year, month, day)
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month || parsed.getDate() !== day) return null
  return parsed
}

/** date 값의 시작(지역 시각 00:00)을 서버용 ISO-8601로 바꾼다. */
export function toIsoAtStartOfDayOrNull(localDate: string): string | null {
  return parseLocalDate(localDate)?.toISOString() ?? null
}

/** date 값의 끝(지역 시각 23:59:59.999)을 서버용 ISO-8601로 바꾼다. */
export function toIsoAtEndOfDayOrNull(localDate: string): string | null {
  const parsed = parseLocalDate(localDate)
  if (!parsed) return null
  parsed.setDate(parsed.getDate() + 1)
  parsed.setMilliseconds(-1)
  return parsed.toISOString()
}

/** 서버 ISO-8601 또는 이미 정규화된 date 값을 date 입력용 YYYY-MM-DD로 바꾼다. */
export function toLocalDateInputValue(value: string | null | undefined): string {
  if (!value) return ''
  const localDate = parseLocalDate(value)
  if (localDate) return value
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`
}

/** date 값이 오늘보다 이전인지. 비었거나 형식이 잘못된 값은 각 폼의 형식 검증에 맡긴다. */
export function isDateBeforeToday(localDate: string): boolean {
  const parsed = parseLocalDate(localDate)
  if (!parsed) return false
  return localDate < todayLocalDate()
}

/** datetime-local 값("2026-08-01T10:00")을 서버가 받는 오프셋 포함 ISO-8601로. 비어 있으면 null. */
export function toIsoOrNull(localValue: string): string | null {
  if (!localValue) return null
  const parsed = new Date(localValue)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

/**
 * 서버가 준 ISO-8601을 datetime-local 입력이 그대로 받는 문자열로. 없거나 깨졌으면 빈 문자열 —
 * 입력을 비워 두는 것이 "미정"의 표현이다.
 *
 * <p><b>UTC로 자르지 않는다.</b> `toISOString().slice(0,16)`은 KST 19:00을 10:00으로 보여 준다.
 * 강사가 넣은 값과 다시 읽은 값이 달라지면, 저장을 누르지 않았는데도 기간이 바뀐 것으로 읽힌다.
 */
export function toLocalInputValue(isoValue: string | null | undefined): string {
  if (!isoValue) return ''
  const parsed = new Date(isoValue)
  if (Number.isNaN(parsed.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`
    + `T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
}

/**
 * datetime-local 값이 오늘보다 이전인지. `min` 속성은 달력·스테퍼만 막고 키보드로 직접 입력한
 * 값은 통과하므로, 저장 직전에 같은 기준으로 한 번 더 본다.
 * 값이 비었거나 깨졌으면 여기서 판단하지 않는다 — 그건 각 폼의 필수/형식 검증이 다룰 몫이다.
 */
export function isBeforeToday(localValue: string): boolean {
  if (!localValue) return false
  const parsed = new Date(localValue)
  if (Number.isNaN(parsed.getTime())) return false
  return parsed.getTime() < new Date(todayLocalStart()).getTime()
}
