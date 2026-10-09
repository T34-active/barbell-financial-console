import type { BaseCurrency, PoolAccount, UsStockHolding } from '@/types/finance'
import { div, mul, round, sub } from '@/utils/decimal'
import { holdingsFromFundLots } from '@/utils/fund-trade'

export function stockMarketValue(stock: UsStockHolding): number {
  const price = stock.market_price ?? stock.cost_price
  return mul(stock.shares, price)
}

export function stockCostBasis(stock: UsStockHolding): number {
  return mul(stock.shares, stock.cost_price)
}

/** 基金市值：已确认份额 × 净值 + 在途金额 */
export function fundMarketValue(account: PoolAccount): number {
  const lots = account.fund_lots
  if (lots?.length) return holdingsFromFundLots(lots, account.nav).market
  if (account.shares != null && account.shares > 0 && account.nav != null && account.nav > 0) {
    return round(mul(account.shares, account.nav), 2)
  }
  return account.amount
}

export function fundCostBasis(account: PoolAccount): number {
  if (account.cost_amount != null && account.cost_amount > 0) {
    return account.cost_amount
  }
  return 0
}

export function fundPnl(account: PoolAccount): { pnl: number; rate: number } {
  const cost = fundCostBasis(account)
  const market = fundMarketValue(account)
  const pnl = sub(market, cost)
  return {
    pnl,
    rate: cost > 0 ? div(pnl, cost) : 0,
  }
}

/** 将任意币种金额换算到目标币种（经 HKD 中转） */
export function convertCurrency(
  amount: number,
  from: BaseCurrency,
  to: BaseCurrency,
  fxToHkd: Record<BaseCurrency, number>,
): number {
  if (from === to) return amount
  const inHkd = mul(amount, fxToHkd[from])
  return div(inHkd, fxToHkd[to])
}

export function formatMoney(
  amount: number,
  currency: BaseCurrency,
  options?: { compact?: boolean; digits?: number },
): string {
  const digits = options?.digits ?? 2
  const value = options?.compact
    ? new Intl.NumberFormat('zh-HK', {
        notation: 'compact',
        maximumFractionDigits: 1,
      }).format(amount)
    : amount.toLocaleString('zh-HK', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })

  return `${currency} ${value}`
}

export function formatPercent(rate: number, digits = 1): string {
  return `${round(mul(rate, 100), digits).toFixed(digits)}%`
}
