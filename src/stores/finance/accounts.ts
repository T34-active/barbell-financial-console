import dayjs from 'dayjs'
import type { FundLot, PoolAccount, PoolKey, UsStockHolding } from '@/types/finance'
import { todayBeijingDate } from '@/utils/datetime'
import { add, div, mul, round, sub } from '@/utils/decimal'
import type { FinanceRefs } from './state'

export function createAccounts(
  refs: FinanceRefs,
  shared: {
    applyYulibaoTotal: (next: number) => void
  },
) {
  const { settings, accounts } = refs
  const { applyYulibaoTotal } = shared

  function updateStockPrices(prices: Array<{ id: string; market_price: number }>) {
    const now = dayjs().toISOString()
    for (const row of prices) {
      const stock = accounts.value.us_stock_pool.find((item) => item.id === row.id)
      if (!stock) continue
      if (row.market_price <= 0) continue
      stock.market_price = row.market_price
      stock.price_updated_at = now
    }
  }

  /** 更新美股数量与持仓价（现价只允许行情拉取写入） */
  function updateStockHoldings(
    rows: Array<{
      id: string
      shares: number
      cost_price: number
    }>,
  ) {
    for (const row of rows) {
      const stock = accounts.value.us_stock_pool.find((item) => item.id === row.id)
      if (!stock) continue
      if (!(row.shares > 0)) throw new Error(`${stock.symbol} 数量须大于 0`)
      if (!(row.cost_price > 0)) {
        throw new Error(`${stock.symbol} 持仓价须大于 0`)
      }
      stock.shares = round(row.shares, 4)
      stock.cost_price = round(row.cost_price, 2)
    }
  }

  function ensureClassId(list: string[], id: string) {
    if (!list.includes(id)) list.push(id)
  }

  function dropClassId(list: string[], id: string) {
    const idx = list.indexOf(id)
    if (idx >= 0) list.splice(idx, 1)
  }

  function upsertPoolAccount(pool: Exclude<PoolKey, 'us_stock_pool'>, account: PoolAccount) {
    const id = account.id.trim()
    if (!id) throw new Error('账户 id 不能为空')
    if (!account.name.trim()) throw new Error('账户名称不能为空')
    if (!(account.amount >= 0)) throw new Error('余额不能为负')

    const next: PoolAccount = {
      ...account,
      id,
      name: account.name.trim(),
      amount: round(account.amount, 2),
      amount_updated_at: account.amount_updated_at ?? dayjs().toISOString(),
    }
    if (next.yield_rate != null) {
      if (!(next.yield_rate >= 0) || next.yield_rate > 1) {
        throw new Error('年化收益率须在 0%–100% 之间')
      }
      next.yield_rate = round(next.yield_rate, 4)
    }

    const list = accounts.value[pool]
    const index = list.findIndex((item) => item.id === id)
    if (index >= 0) list[index] = { ...list[index], ...next }
    else list.push(next)

    // 港币池默认计入安全端
    if (pool === 'hkd_pool') {
      ensureClassId(settings.value.asset_classification.safe_assets, id)
    }
  }

  function updatePoolAmount(pool: Exclude<PoolKey, 'us_stock_pool'>, id: string, amount: number) {
    if (!(amount >= 0)) throw new Error('余额不能为负')
    const target = accounts.value[pool].find((item) => item.id === id)
    if (!target) throw new Error(`未找到账户 ${id}`)
    const next = round(amount, 2)
    target.amount = next
    target.amount_updated_at = dayjs().toISOString()
    if (pool === 'rmb_pool' && id === 'yulibao') {
      applyYulibaoTotal(next)
    }
  }

  function getGoldAccount() {
    const gold = accounts.value.rmb_pool.find((item) => item.id === 'gold_etf')
    if (!gold) throw new Error('未找到黄金账户')
    if (!gold.fund_lots) gold.fund_lots = []
    return gold
  }

  /** 按加仓明细重算份额/成本/市值/浮盈 */
  function syncGoldFromLots(gold: PoolAccount) {
    const lots = gold.fund_lots ?? []
    const shares = round(
      lots.reduce((sum, lot) => add(sum, lot.shares), 0),
      4,
    )
    const cost = round(
      lots.reduce((sum, lot) => add(sum, lot.amount), 0),
      2,
    )
    gold.shares = shares
    gold.cost_amount = cost
    const nav = gold.nav
    if (nav != null && nav > 0 && shares > 0) {
      gold.amount = round(mul(shares, nav), 2)
    } else {
      gold.amount = cost
    }
    if (cost > 0) {
      gold.profit_rate = round(div(sub(gold.amount, cost), cost), 4)
    } else {
      gold.profit_rate = 0
      gold.amount = 0
    }
    gold.amount_updated_at = dayjs().toISOString()
  }

  /**
   * 黄金加仓：金额 ÷ 确认净值 = 份额，写入 fund_lots。
   * confirmNav 缺省时用当前最新净值。
   */
  function addGoldFundLot(input: {
    amount: number
    confirmNav?: number
    confirmDate?: string
    note?: string
  }) {
    const gold = getGoldAccount()
    const amount = round(input.amount, 2)
    if (!(amount > 0)) throw new Error('加仓金额须大于 0')
    const confirmNav = round(input.confirmNav ?? gold.nav ?? 0, 4)
    if (!(confirmNav > 0)) throw new Error('请填写确认净值（或先刷新最新净值）')
    const shares = round(div(amount, confirmNav), 4)
    if (!(shares > 0)) throw new Error('计算出的份额无效')
    const confirmDate = input.confirmDate?.trim() || todayBeijingDate()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(confirmDate)) {
      throw new Error('确认日格式无效')
    }
    if (confirmDate > todayBeijingDate()) {
      throw new Error('确认日不能选择未来日期')
    }
    const lot: FundLot = {
      id: `lot_${confirmDate.replace(/-/g, '')}_${Date.now().toString(36)}`,
      confirm_date: confirmDate,
      amount,
      confirm_nav: confirmNav,
      shares,
      note: input.note?.trim() || undefined,
    }
    gold.fund_lots = [...(gold.fund_lots ?? []), lot].sort((a, b) =>
      a.confirm_date.localeCompare(b.confirm_date),
    )
    syncGoldFromLots(gold)
    return lot
  }

  /**
   * 黄金卖出（FIFO）：按确认日从早到晚扣份额与对应成本。
   * redeemNav 用于估算到账金额（不计入浮盈成本，仅返回）。
   */
  function sellGoldFundShares(input: { shares: number; redeemNav?: number; note?: string }) {
    const gold = getGoldAccount()
    const sellShares = round(input.shares, 4)
    if (!(sellShares > 0)) throw new Error('卖出份额须大于 0')
    const lots = [...(gold.fund_lots ?? [])].sort((a, b) =>
      a.confirm_date.localeCompare(b.confirm_date),
    )
    const totalShares = round(
      lots.reduce((sum, lot) => add(sum, lot.shares), 0),
      4,
    )
    if (sellShares > totalShares + 1e-8) {
      throw new Error(`卖出份额超过持仓（持有 ${totalShares.toFixed(4)}）`)
    }

    let remain = sellShares
    let costRemoved = 0
    const nextLots: FundLot[] = []
    for (const lot of lots) {
      if (remain <= 1e-8) {
        nextLots.push(lot)
        continue
      }
      if (lot.shares <= remain + 1e-8) {
        costRemoved = add(costRemoved, lot.amount)
        remain = round(sub(remain, lot.shares), 4)
      } else {
        const ratio = div(remain, lot.shares)
        const takeCost = round(mul(lot.amount, ratio), 2)
        costRemoved = add(costRemoved, takeCost)
        nextLots.push({
          ...lot,
          shares: round(sub(lot.shares, remain), 4),
          amount: round(sub(lot.amount, takeCost), 2),
          note: lot.note,
        })
        remain = 0
      }
    }

    gold.fund_lots = nextLots
    syncGoldFromLots(gold)

    const redeemNav = round(input.redeemNav ?? gold.nav ?? 0, 4)
    const proceeds = redeemNav > 0 ? round(mul(sellShares, redeemNav), 2) : 0
    const realized = round(sub(proceeds, costRemoved), 2)
    return {
      sold_shares: sellShares,
      cost_removed: round(costRemoved, 2),
      proceeds,
      realized_pnl: realized,
      redeem_nav: redeemNav || undefined,
      note: input.note?.trim() || undefined,
    }
  }

  /** 更新账户年化收益率（小数，如 0.015 = 1.5%） */
  function updatePoolYieldRate(
    pool: Exclude<PoolKey, 'us_stock_pool'>,
    id: string,
    yieldRate: number,
  ) {
    if (!(yieldRate >= 0) || yieldRate > 1) {
      throw new Error('年化收益率须在 0%–100% 之间')
    }
    const target = accounts.value[pool].find((item) => item.id === id)
    if (!target) throw new Error(`未找到账户 ${id}`)
    target.yield_rate = round(yieldRate, 4)
    target.amount_updated_at = dayjs().toISOString()
  }

  function upsertStock(stock: UsStockHolding) {
    const symbol = stock.symbol.trim().toUpperCase()
    if (!symbol) throw new Error('股票代码不能为空')
    if (!stock.name.trim()) throw new Error('股票名称不能为空')
    if (!(stock.shares > 0)) throw new Error('持股数量须大于 0')
    if (!(stock.cost_price > 0)) throw new Error('持仓价须大于 0')

    const id = (stock.id || symbol.toLowerCase()).trim()
    const list = accounts.value.us_stock_pool
    const dupSymbol = list.find((item) => item.symbol.toUpperCase() === symbol && item.id !== id)
    if (dupSymbol) throw new Error(`${symbol} 已在持仓中`)

    const next: UsStockHolding = {
      ...stock,
      id,
      symbol,
      name: stock.name.trim(),
      shares: round(stock.shares, 4),
      cost_price: round(stock.cost_price, 2),
      currency: 'USD',
    }
    if (next.market_price != null && next.market_price > 0) {
      next.market_price = round(next.market_price, 2)
    }
    if (next.est_div_yield != null) {
      next.est_div_yield = round(next.est_div_yield, 4)
    }

    const index = list.findIndex((item) => item.id === id)
    if (index >= 0) list[index] = { ...list[index], ...next }
    else list.push(next)

    ensureClassId(settings.value.asset_classification.offensive_assets, id)
  }

  function removeAccount(pool: PoolKey, id: string) {
    if (pool === 'us_stock_pool') {
      accounts.value.us_stock_pool = accounts.value.us_stock_pool.filter((item) => item.id !== id)
      dropClassId(settings.value.asset_classification.offensive_assets, id)
      return
    }
    accounts.value[pool] = accounts.value[pool].filter((item) => item.id !== id)
    if (pool === 'hkd_pool') {
      dropClassId(settings.value.asset_classification.safe_assets, id)
    } else if (pool === 'rmb_pool') {
      dropClassId(settings.value.asset_classification.safe_assets, id)
      dropClassId(settings.value.asset_classification.neutral_assets, id)
    } else if (pool === 'crypto_pool') {
      const cryptoIds = settings.value.asset_classification.crypto_assets
      if (cryptoIds) dropClassId(cryptoIds, id)
    }
  }

  return {
    updateStockPrices,
    updateStockHoldings,
    upsertPoolAccount,
    updatePoolAmount,
    addGoldFundLot,
    sellGoldFundShares,
    updatePoolYieldRate,
    upsertStock,
    removeAccount,
  }
}
