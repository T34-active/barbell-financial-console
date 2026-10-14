import type { TermLock } from '@/types/finance'
import { todayBeijingDate } from '@/utils/datetime'
import { div, mul, round, sub } from '@/utils/decimal'

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/

/** 合法的公历 YYYY-MM-DD */
export function isYmd(value: string): boolean {
  const match = YMD.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const utc = Date.UTC(year, month - 1, day)
  const date = new Date(utc)
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

/** 设为定期时的期限快捷项。到期日 = 起息日加上对应天数或自然月 */
export const TERM_SHORTCUTS = [
  { id: '7d', label: '七天', days: 7 },
  { id: '1m', label: '一个月', months: 1 },
  { id: '2m', label: '两个月', months: 2 },
  { id: '3m', label: '三个月', months: 3 },
] as const

export type TermShortcutId = (typeof TERM_SHORTCUTS)[number]['id']

function formatUtcYmd(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 起息日加上若干天或自然月；跨月时夹到该月最后一天 */
export function addTermSpan(start: string, span: { days?: number; months?: number }): string {
  const match = YMD.exec(start)
  if (!match) return ''
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (span.days) return formatUtcYmd(new Date(Date.UTC(year, month - 1, day + span.days)))
  if (span.months) {
    const monthIndex = month - 1 + span.months
    const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
    return formatUtcYmd(new Date(Date.UTC(year, monthIndex, Math.min(day, lastDay))))
  }
  return start
}

export function termMaturityFromShortcut(start: string, id: TermShortcutId): string {
  const shortcut = TERM_SHORTCUTS.find((item) => item.id === id)
  if (!shortcut) return ''
  if ('days' in shortcut) return addTermSpan(start, { days: shortcut.days })
  return addTermSpan(start, { months: shortcut.months })
}

/** 与快捷项对齐时用「七天定期」；否则用实际天数 */
export function termLengthLabel(start: string, maturity: string): string {
  for (const shortcut of TERM_SHORTCUTS) {
    if (termMaturityFromShortcut(start, shortcut.id) === maturity) return `${shortcut.label}定期`
  }
  const days = termDays(start, maturity)
  return days > 0 ? `${days} 天定期` : '定期'
}

/** 起息日到到期日的实际天数（到期日当天不计在持有天数之外，首尾相减） */
export function termDays(start: string, maturity: string): number {
  const from = YMD.exec(start)
  const to = YMD.exec(maturity)
  if (!from || !to) return 0
  const utcFrom = Date.UTC(Number(from[1]), Number(from[2]) - 1, Number(from[3]))
  const utcTo = Date.UTC(Number(to[1]), Number(to[2]) - 1, Number(to[3]))
  return Math.round((utcTo - utcFrom) / 86_400_000)
}

/** 到期前：今天（北京时间）早于到期日 */
export function isTermLocked(lock: TermLock | undefined, now: Date = new Date()): boolean {
  if (!lock) return false
  return todayBeijingDate(now) < lock.maturity_date
}

/** 已到到期日（含当天），锁仓记录可能还在，等入账后才清掉 */
export function isTermMatured(lock: TermLock | undefined, now: Date = new Date()): boolean {
  if (!lock) return false
  return todayBeijingDate(now) >= lock.maturity_date
}

/** 距到期日还有几天；到期当天为 0 */
export function termDaysLeft(lock: TermLock, now: Date = new Date()): number {
  return Math.max(0, termDays(todayBeijingDate(now), lock.maturity_date))
}

/** 锁仓本金。旧数据没有 principal 时，用当前余额 */
export function lockedPrincipal(amount: number, lock: TermLock | undefined): number {
  if (!lock) return 0
  if (lock.principal != null && lock.principal >= 0) return lock.principal
  return amount
}

/** 可存入取出的活期。未锁仓时等于全部余额 */
export function demandBalance(
  amount: number,
  lock: TermLock | undefined,
  now: Date = new Date(),
): number {
  if (!isTermLocked(lock, now)) return amount
  return round(Math.max(0, sub(amount, lockedPrincipal(amount, lock))), 2)
}

/**
 * 到期利息：本金 × 年化 × 实际天数 / 365，四舍五入到分。
 * 年化为小数，如 0.024 = 2.4%。
 */
export function maturityInterest(
  principal: number,
  annualRate: number,
  start: string,
  maturity: string,
): number {
  const days = termDays(start, maturity)
  if (!(principal > 0) || !(annualRate > 0) || days <= 0) return 0
  return round(div(mul(principal, annualRate, days), 365), 2)
}
