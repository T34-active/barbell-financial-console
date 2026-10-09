import dayjs from 'dayjs'

/** 统一按北京时间（UTC+8 / Asia/Shanghai）展示，不跟浏览器本地或美东盘时 */

const BEIJING = 'Asia/Shanghai'

function beijingDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BEIJING,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const year = parts.find((p) => p.type === 'year')?.value ?? ''
  const month = parts.find((p) => p.type === 'month')?.value ?? ''
  const day = parts.find((p) => p.type === 'day')?.value ?? ''
  return { year, month, day }
}

export function formatBeijingDateTime(input: string | number | Date): string {
  const date = dayjs(input)
  if (!date.isValid()) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: BEIJING,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date.toDate())
}

/** 北京时间当天，YYYY-MM-DD */
export function todayBeijingDate(now = dayjs().toDate()): string {
  const { year, month, day } = beijingDateParts(now)
  return `${year}-${month}-${day}`
}

/** 用北京墙钟拼出 Date（UTC+8） */
export function beijingWallTime(
  year: string | number,
  month: string | number,
  day: string | number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const pad = (n: string | number) => String(n).padStart(2, '0')
  return dayjs(
    `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}+08:00`,
  ).toDate()
}

export function addBeijingHours(date: Date, hours: number): Date {
  return dayjs(date)
    .add(hours * 3_600_000, 'millisecond')
    .toDate()
}

/** 下一北京整点。21:00 与 21:12 都落到 22:00 */
export function nextBeijingHour(date: Date = dayjs().toDate()): Date {
  const c = beijingClock(date)
  return addBeijingHours(beijingWallTime(c.year, c.month, c.day, c.hour), 1)
}

/** HTX 样式：2026/09/02 22:00 */
export function formatBeijingHourLabel(input: string | number | Date): string {
  const date = dayjs(input)
  if (!date.isValid()) return '—'
  const c = beijingClock(date.toDate())
  return `${c.year}/${c.month}/${c.day} ${String(c.hour).padStart(2, '0')}:00`
}

/** 北京时间时钟（用于 HTX 按小时计提） */
export function beijingClock(date: Date = dayjs().toDate()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BEIJING,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '0'
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
  }
}

/** YYYY-MM-DD → 8-25 */
export function formatMonthDay(ymd: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!match) return ymd
  return `${Number(match[2])}-${Number(match[3])}`
}

/** 北京墙钟 YYYY-MM-DD HH:mm，给日期时间选择器当默认值 */
export function nowBeijingDateTime(now = dayjs().toDate()): string {
  const c = beijingClock(now)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${c.dateKey} ${pad(c.hour)}:${pad(c.minute)}`
}

/** 解析申购时间：墙钟字符串按北京时间，ISO 按瞬时 */
export function parseBeijingDateTime(value: string | Date): Date {
  if (value instanceof Date) return value
  const trimmed = value.trim()
  if (!trimmed) return dayjs().toDate()
  if (/T|[zZ]|[+-]\d{2}:\d{2}$/.test(trimmed)) {
    const instant = dayjs(trimmed)
    if (instant.isValid()) return instant.toDate()
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(trimmed)
  if (match) {
    return beijingWallTime(
      match[1],
      match[2],
      match[3],
      Number(match[4] ?? 0),
      Number(match[5] ?? 0),
      Number(match[6] ?? 0),
    )
  }
  const fallback = dayjs(trimmed)
  return fallback.isValid() ? fallback.toDate() : dayjs().toDate()
}

/** Element Plus disabled-date：禁用晚于北京时间今天的日历日 */
export function isFutureBeijingDate(d: Date): boolean {
  return dayjs(d).format('YYYY-MM-DD') > todayBeijingDate()
}
