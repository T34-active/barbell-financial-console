/**
 * A 股场外公募申购切日：交易日 15:00 前按当日净值，之后或非交易日按下一交易日净值。
 * 交易日按周一到周五，不含法定节假日。
 */

import dayjs from 'dayjs'
import type { FundLot, PoolAccount } from '@/types/finance'
import { beijingClock } from '@/utils/datetime'
import { add, div, mul, round, sub } from '@/utils/decimal'

export const ASHARE_NAV_CUTOFF_HOUR = 15
export const ASHARE_NAV_CUTOFF_MINUTE = 0

export interface FundBuySettlement {
  applyAt: Date
  applyDate: string
  beforeClose: boolean
  tradingDay: boolean
  navDate: string
}

export interface FundLotHoldings {
  shares: number
  cost: number
  pending: number
  market: number
  profit_rate: number
}

export function isAshareTradingDay(ymd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false
  const weekday = new Date(`${ymd}T12:00:00+08:00`).getUTCDay()
  return weekday >= 1 && weekday <= 5
}

function addCalendarDaysYmd(ymd: string, days: number): string {
  return dayjs(`${ymd}T12:00:00+08:00`).add(days, 'day').format('YYYY-MM-DD')
}

/** 严格下一交易日（不含当天） */
export function nextAshareTradingDay(ymd: string): string {
  let cursor = addCalendarDaysYmd(ymd, 1)
  for (let i = 0; i < 14; i++) {
    if (isAshareTradingDay(cursor)) return cursor
    cursor = addCalendarDaysYmd(cursor, 1)
  }
  return cursor
}

export function resolveFundBuySettlement(applyAt: Date = dayjs().toDate()): FundBuySettlement {
  const clock = beijingClock(applyAt)
  const applyDate = clock.dateKey
  const tradingDay = isAshareTradingDay(applyDate)
  const minutes = clock.hour * 60 + clock.minute
  const cutoff = ASHARE_NAV_CUTOFF_HOUR * 60 + ASHARE_NAV_CUTOFF_MINUTE
  const beforeClose = tradingDay && minutes < cutoff
  const navDate = beforeClose ? applyDate : nextAshareTradingDay(applyDate)
  return { applyAt, applyDate, beforeClose, tradingDay, navDate }
}

export function fundBuyCutoffHint(settlement: FundBuySettlement): string {
  const clock = beijingClock(settlement.applyAt)
  const time = `${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`
  if (settlement.beforeClose) {
    return `北京时间 ${time} 未到 15:00，按当日净值（${settlement.navDate}）确认`
  }
  if (!settlement.tradingDay) {
    return `北京时间 ${time} 非交易日，按下一交易日 ${settlement.navDate} 净值确认`
  }
  return `北京时间 ${time} 已过 15:00，按下一交易日 ${settlement.navDate} 净值确认`
}

export function isPendingFundLot(lot: Pick<FundLot, 'pending'>): boolean {
  return lot.pending === true
}

export function pendingFundAmount(lots: FundLot[]): number {
  return round(
    lots.filter(isPendingFundLot).reduce((sum, lot) => add(sum, lot.amount), 0),
    2,
  )
}

export function confirmedFundShares(lots: FundLot[]): number {
  return round(
    lots.filter((lot) => !isPendingFundLot(lot)).reduce((sum, lot) => add(sum, lot.shares), 0),
    4,
  )
}

export function fundLotsCost(lots: FundLot[]): number {
  return round(
    lots.reduce((sum, lot) => add(sum, lot.amount), 0),
    2,
  )
}

export function holdingsFromFundLots(lots: FundLot[], nav?: number): FundLotHoldings {
  const pending = pendingFundAmount(lots)
  const shares = confirmedFundShares(lots)
  const cost = fundLotsCost(lots)
  const confirmedMarket =
    nav != null && nav > 0 && shares > 0 ? round(mul(shares, nav), 2) : round(sub(cost, pending), 2)
  const market = round(add(confirmedMarket, pending), 2)
  const profit_rate = cost > 0 ? round(div(sub(market, cost), cost), 4) : 0
  return { shares, cost, pending, market, profit_rate }
}

export function applyFundHoldingsFromLots(fund: PoolAccount) {
  const lots = fund.fund_lots ?? []
  const { shares, cost, market, profit_rate } = holdingsFromFundLots(lots, fund.nav)
  fund.shares = shares
  fund.cost_amount = cost
  if (cost > 0) {
    fund.amount = market
    fund.profit_rate = profit_rate
  } else {
    fund.amount = 0
    fund.profit_rate = 0
  }
}

export function findPublishedNav(
  account: Pick<PoolAccount, 'nav' | 'nav_updated_at' | 'daily_pnl'>,
  navDate: string,
): number {
  const asOf = (account.nav_updated_at ?? '').slice(0, 10)
  if (asOf === navDate && account.nav != null && account.nav > 0) return account.nav
  const row = (account.daily_pnl ?? []).find((item) => item.date === navDate)
  if (row && row.nav > 0) return row.nav
  return 0
}

export function settlePendingFundLots(
  lots: FundLot[],
  quotes: Array<{ as_of: string; nav: number }>,
): { lots: FundLot[]; settledFrom: string | null } {
  const navByDate = new Map<string, number>()
  for (const quote of quotes) {
    if (quote.nav > 0) navByDate.set(quote.as_of, quote.nav)
  }
  let settledFrom: string | null = null
  const nextLots = lots.map((lot) => {
    if (!isPendingFundLot(lot)) return lot
    const nav = navByDate.get(lot.confirm_date)
    if (!(nav! > 0)) return lot
    const shares = round(div(lot.amount, nav!), 4)
    if (!(shares > 0)) return lot
    if (!settledFrom || lot.confirm_date < settledFrom) settledFrom = lot.confirm_date
    return {
      id: lot.id,
      confirm_date: lot.confirm_date,
      amount: lot.amount,
      confirm_nav: round(nav!, 4),
      shares,
      note: lot.note,
      apply_at: lot.apply_at,
    }
  })
  return { lots: nextLots, settledFrom }
}
