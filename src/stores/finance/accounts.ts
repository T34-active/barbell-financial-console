import dayjs from 'dayjs'
import type { FundLot, PoolAccount, PoolKey, UsStockHolding } from '@/types/finance'
import { parseBeijingDateTime } from '@/utils/datetime'
import { add, div, mul, round, sub } from '@/utils/decimal'
import { isNavFundAccount } from '@/utils/fund-nav'
import {
  applyFundHoldingsFromLots,
  findPublishedNav,
  isPendingFundLot,
  resolveFundBuySettlement,
} from '@/utils/fund-trade'
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

    // 港币池、人民币现金/银行账户默认计入安全端
    const isRmbCash = pool === 'rmb_pool' && next.type !== 'fund' && next.type !== 'gold'
    if (pool === 'hkd_pool' || isRmbCash) {
      ensureClassId(settings.value.asset_classification.safe_assets, id)
      if (pool === 'rmb_pool') {
        dropClassId(settings.value.asset_classification.neutral_assets, id)
      }
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

  /**
   * 池内转账。同币种到账等于转出；跨币种必须填写银行实际到账，不用中间汇率估算。
   */
  function transferPoolAmount(input: {
    fromPool: Exclude<PoolKey, 'us_stock_pool'>
    fromId: string
    toPool: Exclude<PoolKey, 'us_stock_pool'>
    toId: string
    amount: number
    received?: number
  }) {
    if (input.fromPool === input.toPool && input.fromId === input.toId) {
      throw new Error('不能转到同一账户')
    }
    const amount = round(input.amount, 2)
    if (!(amount > 0)) throw new Error('转出金额须大于 0')
    const from = accounts.value[input.fromPool].find((item) => item.id === input.fromId)
    const to = accounts.value[input.toPool].find((item) => item.id === input.toId)
    if (!from) throw new Error(`未找到账户 ${input.fromId}`)
    if (!to) throw new Error(`未找到账户 ${input.toId}`)
    if (from.amount + 1e-9 < amount) throw new Error('转出金额超过余额')
    const sameCurrency = from.currency === to.currency
    const received = sameCurrency ? amount : round(input.received ?? 0, 2)
    if (!sameCurrency && !(received > 0)) {
      throw new Error('跨币种请填写实际到账金额')
    }
    updatePoolAmount(input.fromPool, input.fromId, round(sub(from.amount, amount), 2))
    updatePoolAmount(input.toPool, input.toId, round(add(to.amount, received), 2))
    return { amount, received, fromCurrency: from.currency, toCurrency: to.currency }
  }

  function getFundAccount(id: string) {
    const fund = accounts.value.rmb_pool.find((item) => item.id === id)
    if (!fund || !isNavFundAccount(fund)) throw new Error('未找到基金账户')
    if (!fund.fund_lots) fund.fund_lots = []
    return fund
  }

  /** 按加仓明细重算份额/成本/市值/浮盈（在途金额按 1:1 暂估） */
  function syncFundFromLots(fund: PoolAccount) {
    applyFundHoldingsFromLots(fund)
    fund.amount_updated_at = dayjs().toISOString()
  }

  /**
   * 基金加仓：按申购时间 15:00 切日得到净值日。
   * 该日净值已公布则立刻确认份额，否则记在途，刷新净值后再回填。
   */
  function addFundLot(
    accountId: string,
    input: {
      amount: number
      applyAt?: string | Date
      confirmNav?: number
      confirmDate?: string
      note?: string
    },
  ) {
    const fund = getFundAccount(accountId)
    const amount = round(input.amount, 2)
    if (!(amount > 0)) throw new Error('加仓金额须大于 0')
    const applyAtRaw = parseBeijingDateTime(input.applyAt ?? dayjs().toISOString())
    const applyAt = applyAtRaw.getTime() > Date.now() ? new Date() : applyAtRaw
    const settlement = resolveFundBuySettlement(applyAt)
    const confirmDate = input.confirmDate?.trim() || settlement.navDate
    if (!/^\d{4}-\d{2}-\d{2}$/.test(confirmDate)) {
      throw new Error('净值日格式无效')
    }
    const publishedNav = findPublishedNav(fund, confirmDate)
    const confirmNav = round(input.confirmNav ?? publishedNav, 4)
    const pending = !(confirmNav > 0)
    const shares = pending ? 0 : round(div(amount, confirmNav), 4)
    if (!pending && !(shares > 0)) throw new Error('计算出的份额无效')
    const lot: FundLot = {
      id: `lot_${confirmDate.replace(/-/g, '')}_${Date.now().toString(36)}`,
      confirm_date: confirmDate,
      amount,
      confirm_nav: pending ? 0 : confirmNav,
      shares,
      note: input.note?.trim() || undefined,
      apply_at: applyAt.toISOString(),
      pending: pending || undefined,
    }
    fund.fund_lots = [...(fund.fund_lots ?? []), lot].sort((a, b) =>
      a.confirm_date.localeCompare(b.confirm_date),
    )
    syncFundFromLots(fund)
    return lot
  }

  /**
   * 基金卖出（FIFO）：按确认日从早到晚扣份额与对应成本。
   * redeemNav 用于估算到账金额（不计入浮盈成本，仅返回）。
   */
  function sellFundShares(
    accountId: string,
    input: { shares: number; redeemNav?: number; note?: string },
  ) {
    const fund = getFundAccount(accountId)
    const sellShares = round(input.shares, 4)
    if (!(sellShares > 0)) throw new Error('卖出份额须大于 0')
    const lots = [...(fund.fund_lots ?? [])].sort((a, b) =>
      a.confirm_date.localeCompare(b.confirm_date),
    )
    const totalShares = round(
      lots.filter((lot) => !isPendingFundLot(lot)).reduce((sum, lot) => add(sum, lot.shares), 0),
      4,
    )
    if (sellShares > totalShares + 1e-8) {
      throw new Error(`卖出份额超过持仓（持有 ${totalShares.toFixed(4)}）`)
    }

    let remain = sellShares
    let costRemoved = 0
    const nextLots: FundLot[] = []
    for (const lot of lots) {
      if (isPendingFundLot(lot)) {
        nextLots.push(lot)
        continue
      }
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

    fund.fund_lots = nextLots
    syncFundFromLots(fund)

    const redeemNav = round(input.redeemNav ?? fund.nav ?? 0, 4)
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

  function addGoldFundLot(input: {
    amount: number
    applyAt?: string | Date
    confirmNav?: number
    confirmDate?: string
    note?: string
  }) {
    return addFundLot('gold_etf', input)
  }

  function sellGoldFundShares(input: { shares: number; redeemNav?: number; note?: string }) {
    return sellFundShares('gold_etf', input)
  }

  /** 新增一只人民币公募基金，归入中性端 */
  function addFundProduct(input: { name: string; fundCode: string }) {
    const name = input.name.trim()
    if (!name) throw new Error('请填写基金名称')
    const fundCode = input.fundCode.trim()
    if (!/^\d{6}$/.test(fundCode)) throw new Error('基金代码须为 6 位数字')
    const dup = accounts.value.rmb_pool.find((item) => item.fund_code?.trim() === fundCode)
    if (dup) throw new Error(`基金代码 ${fundCode} 已被「${dup.name}」占用`)
    const id = `fund_${fundCode}`
    if (accounts.value.rmb_pool.some((item) => item.id === id)) {
      throw new Error(`账户 id「${id}」已存在`)
    }
    const account: PoolAccount = {
      id,
      name,
      type: 'fund',
      amount: 0,
      currency: 'CNY',
      fund_code: fundCode,
      shares: 0,
      cost_amount: 0,
      fund_lots: [],
    }
    accounts.value.rmb_pool.push(account)
    ensureClassId(settings.value.asset_classification.neutral_assets, id)
    dropClassId(settings.value.asset_classification.safe_assets, id)
    return account
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
    transferPoolAmount,
    addFundLot,
    sellFundShares,
    addFundProduct,
    addGoldFundLot,
    sellGoldFundShares,
    updatePoolYieldRate,
    upsertStock,
    removeAccount,
  }
}
