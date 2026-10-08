/**
 * HTX 高息守卫：余额 < threshold 享高息；>= threshold 降息。
 * 溢流转存：将超额转到 OKX，使 HTX 回到 target（默认 199）。
 * 溢出量 < minTransfer 时暂不转出（Gas ≈ 1U）。
 */

import dayjs from 'dayjs'
import { addBeijingHours, beijingClock, beijingWallTime, nextBeijingHour } from '@/utils/datetime'
import { D, Decimal, add, div, mul, round, sub } from '@/utils/decimal'

/** 按 365 天年化拆到小时 / 日（HTX 活期按小时计息、到账复投） */
export const HTX_DAYS_PER_YEAR = 365
export const HTX_HOURS_PER_YEAR = 365 * 24
/** HTX 先把时利率四舍五入到 9 位，再乘本金到 8 位 */
export const HTX_HOURLY_RATE_DP = 9
export const HTX_INTEREST_DP = 8

export type HtxHourlyLedgerStatus = 'credited' | 'pending'

export interface HtxHourlyLedgerRow {
  paidAt: Date
  hour: number
  interest: number
  principalAfter: number
  credited: boolean
  status: HtxHourlyLedgerStatus
}

export interface HtxYieldAccrual {
  /** 下一整点将到账的小时收益（HTX「每小时收益」） */
  hourly: number
  /** 当日 00:00–24:00 共 24 个整点的复投合计 */
  daily: number
  /** 今日已到账（未到首笔发放前为 0） */
  creditedToday: number
  hourRate: number
  dayRate: number
  annual: number
  hour: number
  minute: number
  second: number
  compoundedPrincipal: number
  interestStartAt: Date | null
  firstPayoutAt: Date | null
  nextPayoutAt: Date
  waitingFirstPayout: boolean
  payoutsCompleted: number
  hourlyLedger: HtxHourlyLedgerRow[]
}

export function htxHourlyRate(apr: number): number {
  return round(div(apr, HTX_HOURS_PER_YEAR), HTX_HOURLY_RATE_DP)
}

/** HTX 展示用小时收益：时利率 9 位 × 本金后，8 位进位（95.92 → 0.00109503） */
export function htxHourInterest(principal: number, apr: number): number {
  const raw = mul(principal, htxHourlyRate(apr))
  return D(raw).toDecimalPlaces(HTX_INTEREST_DP, Decimal.ROUND_UP).toNumber()
}

export function applyHtxHourlyPayouts(principal: number, apr: number, payouts: number) {
  let p = principal
  const interests: number[] = []
  let credited = 0
  const n = Math.max(0, Math.floor(payouts))
  for (let i = 0; i < n; i += 1) {
    const interest = htxHourInterest(p, apr)
    interests.push(interest)
    credited = add(credited, interest)
    p = round(add(p, interest), HTX_INTEREST_DP)
  }
  return {
    principal: p,
    credited: round(credited, HTX_INTEREST_DP),
    interests,
    nextHourly: htxHourInterest(p, apr),
  }
}

/** T 小时申购 → T+1 起息 → T+2 初次发放 */
export function htxEarnSchedule(subscribedAt: Date) {
  const interestStartAt = nextBeijingHour(subscribedAt)
  const firstPayoutAt = addBeijingHours(interestStartAt, 1)
  return { interestStartAt, firstPayoutAt }
}

export function htxCompletedPayouts(firstPayoutAt: Date, now: Date): number {
  const delta = now.getTime() - firstPayoutAt.getTime()
  if (delta < 0) return 0
  return Math.floor(delta / 3_600_000) + 1
}

/** 由复投后本金反推上一小时本金与利息 */
export function unwindHtxHour(
  principalAfter: number,
  apr: number,
): { before: number; interest: number } {
  const k = htxHourlyRate(apr)
  let before = div(principalAfter, add(1, k))
  for (let i = 0; i < 16; i += 1) {
    const interest = htxHourInterest(before, apr)
    const got = round(add(before, interest), HTX_INTEREST_DP)
    const delta = sub(got, principalAfter)
    if (Math.abs(delta) < 1e-12) {
      return { before: round(before, HTX_INTEREST_DP), interest }
    }
    before = sub(before, delta)
  }
  const interest = htxHourInterest(before, apr)
  return { before: round(before, HTX_INTEREST_DP), interest }
}

/** 北京当日 00:00–23:00。当前整点的小时收益对齐 HTX（95.92 → 0.00109503），此前倒推、此后复投 */
export function buildHtxHourlyLedger(options: { principal: number; apr: number; now?: Date }): {
  rows: HtxHourlyLedgerRow[]
  total: number
  creditedToday: number
} {
  const now = options.now ?? dayjs().toDate()
  const nowMs = now.getTime()
  const clock = beijingClock(now)
  const anchorHour = clock.hour
  const slotAt = (hour: number) => beijingWallTime(clock.year, clock.month, clock.day, hour)

  const before = Array<number>(24)
  before[anchorHour] = round(options.principal, HTX_INTEREST_DP)
  for (let hour = anchorHour - 1; hour >= 0; hour -= 1) {
    before[hour] = unwindHtxHour(before[hour + 1] ?? 0, options.apr).before
  }

  const rows: HtxHourlyLedgerRow[] = []
  let total = 0
  let creditedToday = 0
  let forward = before[anchorHour] ?? 0
  for (let hour = 0; hour < 24; hour += 1) {
    const paidAt = slotAt(hour)
    const principalBefore = hour <= anchorHour ? (before[hour] ?? 0) : forward
    const interest = htxHourInterest(principalBefore, options.apr)
    const principalAfter = round(add(principalBefore, interest), HTX_INTEREST_DP)
    forward = principalAfter
    total = add(total, interest)
    const credited = nowMs >= paidAt.getTime()
    if (credited) creditedToday = add(creditedToday, interest)
    rows.push({
      paidAt,
      hour,
      interest,
      principalAfter,
      credited,
      status: credited ? 'credited' : 'pending',
    })
  }

  return {
    rows,
    total: round(total, HTX_INTEREST_DP),
    creditedToday: round(creditedToday, HTX_INTEREST_DP),
  }
}

/**
 * 对齐 HTX 活期：时利率 round(年化/8760, 9)，小时收益 round(本金×时利率, 8)。
 * 不满一小时不计息；到账后自动复投，下一小时本金变大。
 */
export function estimateHtxYieldAccrual(
  balance: number,
  rate: number,
  now: Date = dayjs().toDate(),
  subscribedAt?: Date | null,
): HtxYieldAccrual {
  const clock = beijingClock(now)
  const annual = round(mul(balance, rate), 4)
  const snapshotHourly = htxHourInterest(balance, rate)

  if (subscribedAt && !Number.isNaN(subscribedAt.getTime())) {
    const { interestStartAt, firstPayoutAt } = htxEarnSchedule(subscribedAt)
    const n = htxCompletedPayouts(firstPayoutAt, now)
    const sim = applyHtxHourlyPayouts(balance, rate, n)
    const waitingFirstPayout = n === 0
    const hourly = sim.nextHourly
    const nextPayoutAt = waitingFirstPayout ? firstPayoutAt : addBeijingHours(firstPayoutAt, n)
    const compoundedPrincipal = waitingFirstPayout ? round(balance, HTX_INTEREST_DP) : sim.principal
    const ledger = buildHtxHourlyLedger({
      principal: round(balance, HTX_INTEREST_DP),
      apr: rate,
      now,
    })
    return {
      hourly,
      daily: ledger.total,
      creditedToday: ledger.creditedToday,
      hourRate: hourly,
      dayRate: ledger.total,
      annual,
      hour: clock.hour,
      minute: clock.minute,
      second: clock.second,
      compoundedPrincipal,
      interestStartAt,
      firstPayoutAt,
      nextPayoutAt,
      waitingFirstPayout,
      payoutsCompleted: n,
      hourlyLedger: ledger.rows,
    }
  }

  const nextPayoutAt = nextBeijingHour(now)
  const ledger = buildHtxHourlyLedger({
    principal: round(balance, HTX_INTEREST_DP),
    apr: rate,
    now,
  })
  return {
    hourly: snapshotHourly,
    daily: ledger.total,
    creditedToday: ledger.creditedToday,
    hourRate: snapshotHourly,
    dayRate: ledger.total,
    annual,
    hour: clock.hour,
    minute: clock.minute,
    second: clock.second,
    compoundedPrincipal: round(balance, HTX_INTEREST_DP),
    interestStartAt: null,
    firstPayoutAt: null,
    nextPayoutAt,
    waitingFirstPayout: false,
    payoutsCompleted: clock.hour + 1,
    hourlyLedger: ledger.rows,
  }
}

export interface HtxYieldRules {
  htx_high_yield_threshold: number
  htx_high_yield_rate: number
  htx_low_yield_rate: number
  htx_target_balance: number
  htx_overflow_min_transfer: number
}

export function resolveHtxYieldRate(
  balance: number,
  rules: Pick<
    HtxYieldRules,
    'htx_high_yield_threshold' | 'htx_high_yield_rate' | 'htx_low_yield_rate'
  >,
): number {
  return balance < rules.htx_high_yield_threshold
    ? rules.htx_high_yield_rate
    : rules.htx_low_yield_rate
}

export function isHtxHighYield(balance: number, threshold: number): boolean {
  return balance < threshold
}

export interface OverflowPlan {
  needsAction: boolean
  canExecute: boolean
  overflow: number
  htxBefore: number
  htxAfter: number
  transferAmount: number
  reason: string
}

/** 计算溢流转存方案（不改余额） */
export function planHtxOverflow(htxBalance: number, rules: HtxYieldRules): OverflowPlan {
  const threshold = rules.htx_high_yield_threshold
  const target = rules.htx_target_balance
  const minTransfer = rules.htx_overflow_min_transfer

  if (htxBalance < threshold) {
    return {
      needsAction: false,
      canExecute: false,
      overflow: 0,
      htxBefore: htxBalance,
      htxAfter: htxBalance,
      transferAmount: 0,
      reason: `HTX ${htxBalance.toFixed(2)} < ${threshold}，高息守护中`,
    }
  }

  const overflow = round(sub(htxBalance, target), 2)
  if (overflow <= 0) {
    return {
      needsAction: false,
      canExecute: false,
      overflow: 0,
      htxBefore: htxBalance,
      htxAfter: htxBalance,
      transferAmount: 0,
      reason: '无需转存',
    }
  }

  if (overflow < minTransfer) {
    return {
      needsAction: true,
      canExecute: false,
      overflow,
      htxBefore: htxBalance,
      htxAfter: htxBalance,
      transferAmount: 0,
      reason: `溢出 ${overflow.toFixed(2)} U < ${minTransfer} U，暂扣以覆盖 Gas≈1U`,
    }
  }

  return {
    needsAction: true,
    canExecute: true,
    overflow,
    htxBefore: htxBalance,
    htxAfter: target,
    transferAmount: overflow,
    reason: `溢出 ${overflow.toFixed(2)} U → OKX，HTX 锁定 ${target}`,
  }
}
