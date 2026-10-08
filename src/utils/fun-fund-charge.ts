import dayjs from 'dayjs'
import type { BaseCurrency, FunFundChargePayment, FunFundRecurringCharge } from '@/types/finance'
import { convertCurrency } from '@/utils/currency'
import { beijingClock, beijingWallTime } from '@/utils/datetime'
import { add, round, sub } from '@/utils/decimal'

export const CURSOR_PRO_CHARGE_ID = 'cursor_pro'

export function defaultFunFundCharges(): FunFundRecurringCharge[] {
  return [
    {
      id: CURSOR_PRO_CHARGE_ID,
      label: 'Cursor Pro',
      amount: 60,
      currency: 'USD',
      billing_day: 28,
      enabled: true,
    },
  ]
}

export function mergeFunFundCharges(
  raw: FunFundRecurringCharge[] | undefined,
): FunFundRecurringCharge[] {
  const seed = defaultFunFundCharges()
  const incoming = (raw ?? []).map((item) => normalizeCharge(item, seed))
  const merged = incoming.length ? incoming : [...seed]
  for (const item of seed) {
    if (!merged.some((row) => row.id === item.id)) merged.push(item)
  }
  return merged
}

function normalizeCharge(
  item: FunFundRecurringCharge,
  seed: FunFundRecurringCharge[],
): FunFundRecurringCharge {
  const fallback = seed.find((row) => row.id === item.id) ?? seed[0] ?? defaultFunFundCharges()[0]
  const billingDay = Math.min(28, Math.max(1, Math.round(item.billing_day || 28)))
  return {
    id: String(item.id || fallback.id),
    label: String(item.label || fallback.label),
    amount: Number(item.amount) > 0 ? Number(item.amount) : fallback.amount,
    currency: item.currency || fallback.currency,
    billing_day: billingDay,
    enabled: item.enabled !== false,
  }
}

export function chargeAmountCny(
  charge: FunFundRecurringCharge,
  fxToHkd: Record<BaseCurrency, number>,
): number {
  return round(convertCurrency(charge.amount, charge.currency, 'CNY', fxToHkd), 2)
}

export function yearMonthFromBeijing(now = dayjs().toDate()): string {
  const clock = beijingClock(now)
  return `${clock.year}-${clock.month}`
}

export function shiftYearMonthKey(yearMonth: string, delta: number): string {
  const [year, month] = yearMonth.split('-').map(Number)
  return dayjs('2000-01-01')
    .year(year)
    .month(month - 1)
    .date(1)
    .add(delta, 'month')
    .format('YYYY-MM')
}

export function billingDateOf(period: string, billingDay: number): Date {
  const [year, month] = period.split('-').map(Number)
  const dim = dayjs('2000-01-01')
    .year(year)
    .month(month - 1)
    .date(1)
    .daysInMonth()
  const day = Math.min(Math.max(1, billingDay), dim)
  return beijingWallTime(year, month, day)
}

export function isChargePaid(
  chargeId: string,
  period: string,
  payments: FunFundChargePayment[],
): boolean {
  return payments.some((item) => item.charge_id === chargeId && item.period === period)
}

/** 当前未结清的账单账期：本月没扣就锁本月，扣完才轮到下月 */
export function nextUnpaidPeriod(
  charge: FunFundRecurringCharge,
  payments: FunFundChargePayment[],
  now = dayjs().toDate(),
): string {
  const thisPeriod = yearMonthFromBeijing(now)
  if (!isChargePaid(charge.id, thisPeriod, payments)) return thisPeriod
  return shiftYearMonthKey(thisPeriod, 1)
}

export function daysUntilBeijing(target: Date, now = dayjs().toDate()): number {
  const today = beijingClock(now).dateKey
  const due = beijingClock(target).dateKey
  const start = dayjs(`${today}T00:00:00+08:00`)
  const end = dayjs(`${due}T00:00:00+08:00`)
  return Math.round(end.diff(start) / 86_400_000)
}

export interface FunFundReserveLine {
  charge: FunFundRecurringCharge
  period: string
  billingDate: Date
  daysUntil: number
  due: boolean
  overdue: boolean
  paid: boolean
  reserveCny: number
}

export interface FunFundReserveSnapshot {
  lines: FunFundReserveLine[]
  reserveCny: number
  spendableCny: number
  shortfallCny: number
}

export function shouldReserveForPeriod(
  chargePeriod: string,
  openFunPeriod: string | null,
  todayPeriod: string,
): boolean {
  if (openFunPeriod) return chargePeriod === openFunPeriod
  return chargePeriod === todayPeriod
}

export function resolveFunFundReserve(input: {
  charges: FunFundRecurringCharge[]
  payments: FunFundChargePayment[]
  pocket: number
  openPeriod: string | null
  fxToHkd: Record<BaseCurrency, number>
  now?: Date
}): FunFundReserveSnapshot {
  const now = input.now ?? dayjs().toDate()
  const todayPeriod = yearMonthFromBeijing(now)
  const lines: FunFundReserveLine[] = []

  for (const charge of input.charges) {
    if (!charge.enabled) continue
    const period = nextUnpaidPeriod(charge, input.payments, now)
    if (!shouldReserveForPeriod(period, input.openPeriod, todayPeriod)) continue
    const billingDate = billingDateOf(period, charge.billing_day)
    const daysUntil = daysUntilBeijing(billingDate, now)
    lines.push({
      charge,
      period,
      billingDate,
      daysUntil,
      due: daysUntil <= 0,
      overdue: daysUntil < 0,
      paid: false,
      reserveCny: chargeAmountCny(charge, input.fxToHkd),
    })
  }

  const reserveCny = round(
    lines.reduce((sum, line) => add(sum, line.reserveCny), 0),
    2,
  )
  const spendableCny = round(Math.max(0, sub(input.pocket, reserveCny)), 2)
  const shortfallCny = round(Math.max(0, sub(reserveCny, input.pocket)), 2)

  return { lines, reserveCny, spendableCny, shortfallCny }
}
