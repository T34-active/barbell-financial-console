import dayjs from 'dayjs'

/** 发薪日防呆状态 */
export type PaydayUiStatus = 'payday_today' | 'waiting' | 'overdue' | 'confirmed'

export interface SalaryCycle {
  /** 归属账期 YYYY-MM（名义发薪月，顺延跨月仍归属该月） */
  periodYearMonth: string
  /** 名义发薪日（未顺延） */
  nominalPayday: Date
  /** 实际发薪日（周末顺延后，可能跨月） */
  actualPayday: Date
}

export interface PaydayStatus {
  status: PaydayUiStatus
  /** 当前操作所属账期 */
  periodYearMonth: string
  /** 本账期实际发薪日（含周末顺延） */
  actualPayday: Date
  /** 下一笔预期到账日 */
  nextPayday: Date
  daysUntilNext: number
  daysOverdue: number
  paydayDay: number
  message: string
  canConfirm: boolean
  buttonLabel: string
  buttonTone: 'primary' | 'warning' | 'info'
  /**
   * 等待发薪期间：比例预览仅为模拟，
   * 安全垫是否满 2 万必须等确认入账瞬间再判定。
   */
  allocationDeferred: boolean
}

const WEEKDAY_ZH = ['日', '一', '二', '三', '四', '五', '六'] as const

/** 本地日历日。monthIndex 从 0 起，和 dayjs 的 month 一致。 */
function localDate(year: number, monthIndex: number, day: number) {
  return dayjs('2000-01-01').year(year).month(monthIndex).date(day).startOf('day')
}

function startOfDay(date: Date): Date {
  return dayjs(date).startOf('day').toDate()
}

function addDays(date: Date, days: number): Date {
  return dayjs(date).add(days, 'day').startOf('day').toDate()
}

function shiftMonth(
  year: number,
  monthIndex: number,
  delta: number,
): { year: number; monthIndex: number } {
  const d = localDate(year, monthIndex, 1).add(delta, 'month')
  return { year: d.year(), monthIndex: d.month() }
}

/** 若落在周六/周日，顺延到下周一（可能跨月） */
export function postponeToWeekday(date: Date, enabled = true): Date {
  const d = startOfDay(date)
  if (!enabled) return d
  const day = d.getDay()
  if (day === 6) return addDays(d, 2)
  if (day === 0) return addDays(d, 1)
  return d
}

function daysInMonth(year: number, monthIndex: number): number {
  return localDate(year, monthIndex, 1).daysInMonth()
}

export function formatYearMonth(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`
}

/**
 * 硬规则：固定每月 10 号发薪；周六顺延 +2，周日顺延 +1（到下周一）。
 * month 为 0-indexed，与 dayjs 的 month 一致。
 */
export function getActualPayday(year: number, month: number, paydayDay = 10): Date {
  const capped = Math.min(Math.max(1, paydayDay), daysInMonth(year, month))
  let d = localDate(year, month, capped)
  if (d.day() === 6) d = d.add(2, 'day')
  if (d.day() === 0) d = d.add(1, 'day')
  return d.startOf('day').toDate()
}

/** 计算某账期的名义/实际发薪日（顺延可跨月） */
export function resolveSalaryCycle(
  year: number,
  monthIndex: number,
  paydayDay: number,
  postponeWeekend = true,
): SalaryCycle {
  const capped = Math.min(Math.max(1, paydayDay), daysInMonth(year, monthIndex))
  const nominalPayday = localDate(year, monthIndex, capped).toDate()
  return {
    periodYearMonth: formatYearMonth(year, monthIndex),
    nominalPayday,
    actualPayday: postponeWeekend ? getActualPayday(year, monthIndex, paydayDay) : nominalPayday,
  }
}

/** @deprecated 使用 resolveSalaryCycle(...).actualPayday */
export function resolveActualPayday(
  year: number,
  monthIndex: number,
  paydayDay: number,
  postponeWeekend = true,
): Date {
  return resolveSalaryCycle(year, monthIndex, paydayDay, postponeWeekend).actualPayday
}

export function formatPaydayZh(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

export function formatPaydayWithWeekday(date: Date): string {
  return `${formatPaydayZh(date)}（周${WEEKDAY_ZH[date.getDay()]}）`
}

function diffDays(from: Date, to: Date): number {
  const ms = startOfDay(to).getTime() - startOfDay(from).getTime()
  return Math.round(ms / (24 * 60 * 60 * 1000))
}

function buildNearbyCycles(
  today: Date,
  paydayDay: number,
  postponeWeekend: boolean,
): SalaryCycle[] {
  const base = { year: today.getFullYear(), monthIndex: today.getMonth() }
  const offsets = [-1, 0, 1, 2]
  return offsets.map((delta) => {
    const m = shiftMonth(base.year, base.monthIndex, delta)
    return resolveSalaryCycle(m.year, m.monthIndex, paydayDay, postponeWeekend)
  })
}

/**
 * 解析当前应处理的发薪账期。
 * 关键：名义 5/30（周六）顺延到 6/1 → 账期仍为 2026-05，
 * 在 5/31～6/1 之间按 5 月账期等待/确认，绝不提前改工资比例。
 *
 * 只盯「最近一个已到期」账期：本月已入账后，不再逼补更早的空账期。
 */
export function resolvePaydayStatus(input: {
  today?: Date
  paydayDay: number
  postponeWeekend?: boolean
  isPeriodConfirmed: (periodYearMonth: string) => boolean
}): PaydayStatus {
  const today = startOfDay(input.today ?? dayjs().toDate())
  const paydayDay = input.paydayDay
  const postponeWeekend = input.postponeWeekend ?? true
  const cycles = buildNearbyCycles(today, paydayDay, postponeWeekend)

  // 已到期按实际发薪日倒序，只处理最近一期（跳过更早历史空档）
  const latestDue = cycles
    .filter((c) => c.actualPayday.getTime() <= today.getTime())
    .sort((a, b) => b.actualPayday.getTime() - a.actualPayday.getTime())[0]

  if (latestDue && !input.isPeriodConfirmed(latestDue.periodYearMonth)) {
    const cycle = latestDue
    const sameDay = cycle.actualPayday.getTime() === today.getTime()
    if (sameDay) {
      return {
        status: 'payday_today',
        periodYearMonth: cycle.periodYearMonth,
        actualPayday: cycle.actualPayday,
        nextPayday: cycle.actualPayday,
        daysUntilNext: 0,
        daysOverdue: 0,
        paydayDay,
        message: `今日发薪日！工资已到账，请点击下方确认分配。（账期 ${cycle.periodYearMonth}；安全垫比例在确认瞬间按余额判定）`,
        canConfirm: true,
        buttonLabel: '确认本月入账',
        buttonTone: 'primary',
        allocationDeferred: false,
      }
    }

    const daysOverdue = diffDays(cycle.actualPayday, today)
    return {
      status: 'overdue',
      periodYearMonth: cycle.periodYearMonth,
      actualPayday: cycle.actualPayday,
      nextPayday: cycle.actualPayday,
      daysUntilNext: 0,
      daysOverdue,
      paydayDay,
      message: `本月工资尚未确认入账，请尽快补录。（账期 ${cycle.periodYearMonth}，已逾期 ${daysOverdue} 天，实际发薪日 ${formatPaydayZh(cycle.actualPayday)}）`,
      canConfirm: true,
      buttonLabel: '补录本月入账',
      buttonTone: 'warning',
      allocationDeferred: false,
    }
  }

  const upcoming = cycles
    .filter(
      (c) =>
        c.actualPayday.getTime() > today.getTime() && !input.isPeriodConfirmed(c.periodYearMonth),
    )
    .sort((a, b) => a.actualPayday.getTime() - b.actualPayday.getTime())

  if (upcoming[0]) {
    const cycle = upcoming[0]
    const daysUntilNext = diffDays(today, cycle.actualPayday)
    const crossed = cycle.actualPayday.getMonth() !== cycle.nominalPayday.getMonth()
    return {
      status: 'waiting',
      periodYearMonth: cycle.periodYearMonth,
      actualPayday: cycle.actualPayday,
      nextPayday: cycle.actualPayday,
      daysUntilNext,
      daysOverdue: 0,
      paydayDay,
      message: `下次发薪日：${formatPaydayWithWeekday(cycle.actualPayday)}（倒计时 ${daysUntilNext} 天${crossed ? '，已周末顺延跨月' : ''}）。发薪前账户余额不应有工资相关变动；安全垫是否满额仅在确认入账瞬间判定。`,
      canConfirm: false,
      buttonLabel: '等待发薪',
      buttonTone: 'info',
      allocationDeferred: true,
    }
  }

  // 附近账期均已确认 → 展示下一账期
  const fallbackNext = shiftMonth(today.getFullYear(), today.getMonth(), 1)
  const nextCycle =
    cycles.find((c) => c.actualPayday.getTime() > today.getTime()) ??
    resolveSalaryCycle(fallbackNext.year, fallbackNext.monthIndex, paydayDay, postponeWeekend)

  const latestConfirmed =
    cycles
      .filter((c) => input.isPeriodConfirmed(c.periodYearMonth))
      .sort((a, b) => b.actualPayday.getTime() - a.actualPayday.getTime())[0] ?? cycles[1]!

  return {
    status: 'confirmed',
    periodYearMonth: latestConfirmed.periodYearMonth,
    actualPayday: latestConfirmed.actualPayday,
    nextPayday: nextCycle.actualPayday,
    daysUntilNext: diffDays(today, nextCycle.actualPayday),
    daysOverdue: 0,
    paydayDay,
    message: `账期 ${latestConfirmed.periodYearMonth} 已确认入账。下一笔工资预计于 ${formatPaydayWithWeekday(nextCycle.actualPayday)} 到账。`,
    canConfirm: false,
    buttonLabel: '本月已入账',
    buttonTone: 'info',
    allocationDeferred: false,
  }
}

/** 总览用：下一笔（或当前待处理）工资到账日 */
export function resolveNextPaydayHint(input: {
  today?: Date
  paydayDay: number
  postponeWeekend?: boolean
  isPeriodConfirmed: (periodYearMonth: string) => boolean
}): {
  date: Date
  label: string
  periodYearMonth: string
  isOverdue: boolean
  isToday: boolean
} {
  const status = resolvePaydayStatus(input)
  return {
    date: status.nextPayday,
    label: formatPaydayWithWeekday(status.nextPayday),
    periodYearMonth: status.periodYearMonth,
    isOverdue: status.status === 'overdue',
    isToday: status.status === 'payday_today',
  }
}
