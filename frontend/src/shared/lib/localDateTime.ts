/**
 * datetime-local 입력이 그대로 받는 "오늘 0시" 문자열.
 * 0시로 잡아 오늘 안의 시각은 모두 허용하고 어제까지만 막는다.
 */
export function todayLocalStart(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T00:00`
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
