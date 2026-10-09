import dayjs from 'dayjs'
import type {
  AppSettings,
  BaseCurrency,
  FinanceRules,
  FundDailyPnl,
  LiveFxSnapshot,
  PoolAccount,
} from '@/types/finance'
import { div, round, sub } from '@/utils/decimal'
import { isNavFundAccount } from '@/utils/fund-nav'
import {
  applyFundHoldingsFromLots,
  confirmedFundShares,
  fundLotsCost,
  isPendingFundLot,
  settlePendingFundLots,
} from '@/utils/fund-trade'
import { fetchLiveFxQuotes, isFxStale } from '@/utils/fx-rates'
import type { FinanceRefs } from './state'

export function createMarket(
  refs: FinanceRefs,
  shared: {
    syncCryptoYieldRates: () => void
  },
) {
  const { settings, accounts, salary } = refs
  const { syncCryptoYieldRates } = shared

  /** 从行情源拉取全部美股现价并写入 market_price */
  async function refreshStockMarketPrices() {
    const { fetchStockQuotes } = await import('@/utils/stock-prices')
    const pool = accounts.value.us_stock_pool
    if (!pool.length) throw new Error('暂无美股持仓')

    const { quotes, errors } = await fetchStockQuotes(pool.map((item) => item.symbol))
    if (!quotes.length) {
      throw new Error(errors[0] ?? '拉取美股现价失败')
    }

    const bySymbol = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q] as const))
    const now = dayjs().toISOString()
    let updated = 0
    for (const stock of pool) {
      const quote = bySymbol.get(stock.symbol.toUpperCase())
      if (!quote) continue
      stock.market_price = quote.price
      stock.price_updated_at = quote.as_of || now
      updated += 1
    }

    return { updated, errors, quotes }
  }

  /**
   * 从东财分红历史 + 新浪现价计算 TTM 股息率，写入 est_div_yield。
   * 拉取失败的标的保留原估算。
   */
  async function refreshStockDividendYields(priceBySymbol?: Record<string, number>) {
    const { fetchStockDividendYields } = await import('@/utils/stock-dividends')
    const pool = accounts.value.us_stock_pool
    if (!pool.length) throw new Error('暂无美股持仓')

    const prices: Record<string, number> = { ...(priceBySymbol ?? {}) }
    for (const stock of pool) {
      const key = stock.symbol.toUpperCase()
      if (!(prices[key]! > 0) && stock.market_price && stock.market_price > 0) {
        prices[key] = stock.market_price
      }
    }

    const { yields, errors } = await fetchStockDividendYields(
      pool.map((item) => item.symbol),
      prices,
    )
    if (!yields.length) {
      throw new Error(errors[0] ?? '拉取美股股息率失败')
    }

    const bySymbol = new Map(yields.map((y) => [y.symbol.toUpperCase(), y] as const))
    const now = dayjs().toISOString()
    let updated = 0
    for (const stock of pool) {
      const row = bySymbol.get(stock.symbol.toUpperCase())
      if (!row) continue
      // 0 表示近一年无现金分红，仍写入以反映真实情况
      stock.est_div_yield = row.div_yield
      stock.div_yield_updated_at = row.as_of || now
      updated += 1
    }

    return { updated, errors, yields }
  }

  /** 同时拉取现价（新浪）+ TTM 股息率（东财分红） */
  async function refreshStockQuotesAndYields() {
    const priceResult = await refreshStockMarketPrices()
    const priceBySymbol: Record<string, number> = {}
    for (const q of priceResult.quotes) {
      priceBySymbol[q.symbol.toUpperCase()] = q.price
    }
    let yieldUpdated = 0
    const yieldErrors: string[] = []
    try {
      const yieldResult = await refreshStockDividendYields(priceBySymbol)
      yieldUpdated = yieldResult.updated
      yieldErrors.push(...yieldResult.errors)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      yieldErrors.push(msg)
    }
    return {
      priceUpdated: priceResult.updated,
      yieldUpdated,
      errors: [...priceResult.errors, ...yieldErrors],
      quotes: priceResult.quotes,
    }
  }

  function fundNeedsNavRefresh(fund: PoolAccount) {
    const lots = fund.fund_lots ?? []
    if (!fund.fund_code?.trim() || !(fund.shares! > 0 || lots.length)) return false
    const today = dayjs().toISOString().slice(0, 10)
    const lastFetchDay = fund.amount_updated_at?.slice(0, 10)
    const hasPrevNav = fund.prev_nav != null && fund.prev_nav > 0
    const ledger = fund.daily_pnl ?? []
    const hasDailyLedger = ledger.length > 0
    const firstLotDate = lots.reduce(
      (min, lot) => (!min || lot.confirm_date < min ? lot.confirm_date : min),
      '',
    )
    const oldestLedger = ledger.length
      ? ledger.reduce((min, row) => (row.date < min ? row.date : min), ledger[0]!.date)
      : ''
    const needsBackfill = Boolean(firstLotDate && oldestLedger && oldestLedger > firstLotDate)
    const pendingLots = lots.filter(isPendingFundLot)
    if (pendingLots.length) {
      const published = (fund.nav_updated_at ?? '').slice(0, 10)
      if (published && pendingLots.some((lot) => lot.confirm_date <= published)) return true
      return !(lastFetchDay === today && hasPrevNav)
    }
    return !(lastFetchDay === today && hasPrevNav && hasDailyLedger && !needsBackfill)
  }

  /**
   * 拉取指定基金最新净值，按份额重算市值与浮盈亏。
   * 在途加仓在对应净值日公布后回填份额；从该日起解冻日盈亏再重算。
   */
  async function refreshFundNav(accountId: string) {
    const fund = accounts.value.rmb_pool.find((item) => item.id === accountId)
    if (!fund || !isNavFundAccount(fund)) throw new Error('未找到基金账户')
    const code = fund.fund_code?.trim()
    if (!code) throw new Error(`${fund.name} 缺少基金代码`)

    const rawLots = fund.fund_lots ?? []
    const hasPending = rawLots.some(isPendingFundLot)
    if (rawLots.length) {
      fund.shares = confirmedFundShares(rawLots)
      fund.cost_amount = fundLotsCost(rawLots)
    }
    if (!((fund.shares ?? 0) > 0) && !hasPending) throw new Error(`${fund.name} 缺少持仓份额`)
    if (!((fund.cost_amount ?? 0) > 0) && !hasPending) throw new Error(`${fund.name} 缺少成本`)

    const firstLotDate = rawLots.reduce(
      (min, lot) => (!min || lot.confirm_date < min ? lot.confirm_date : min),
      '',
    )
    const { fetchFundNavHistory, fundDailyPnlFromLots } = await import('@/utils/fund-nav')
    const quotes = await fetchFundNavHistory(code, {
      since: firstLotDate || undefined,
    })
    const quote = quotes[0]
    if (!quote) throw new Error('未返回有效净值')

    const settled = settlePendingFundLots(rawLots, quotes)
    fund.fund_lots = settled.lots
    const lots = settled.lots
    fund.nav = quote.nav
    fund.nav_updated_at = quote.as_of
    fund.prev_nav = quote.prev_nav
    fund.nav_day_change = quote.day_change
    applyFundHoldingsFromLots(fund)
    fund.amount_updated_at = dayjs().toISOString()
    const cost = fund.cost_amount ?? 0

    const byDate = new Map((fund.daily_pnl ?? []).map((row) => [row.date, row] as const))
    if (settled.settledFrom) {
      for (const date of [...byDate.keys()]) {
        if (date >= settled.settledFrom) byDate.delete(date)
      }
    }
    const latestDate = quote.as_of
    for (const item of quotes) {
      if (!(item.prev_nav! > 0)) continue
      const frozen = byDate.get(item.as_of)
      if (frozen && item.as_of !== latestDate) continue
      const { pnl: dayPnl, shares: dayShares } = fundDailyPnlFromLots(
        lots,
        item.nav,
        item.prev_nav!,
        item.as_of,
      )
      if (!(dayShares > 0)) continue
      const row: FundDailyPnl = {
        date: item.as_of,
        nav: item.nav,
        prev_nav: item.prev_nav!,
        shares: dayShares,
        pnl: dayPnl,
        day_change: item.day_change ?? round(div(sub(item.nav, item.prev_nav!), item.prev_nav!), 6),
      }
      byDate.set(item.as_of, row)
    }
    fund.daily_pnl = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date))

    return {
      nav: quote.nav,
      as_of: quote.as_of,
      amount: fund.amount,
      cost,
      pnl: round(sub(fund.amount, cost), 2),
      profit_rate: fund.profit_rate ?? 0,
      day_change: quote.day_change,
      prev_nav: quote.prev_nav,
    }
  }

  /** 启动时每天最多自动拉一次净值（周末净值不更也会跳过重复请求） */
  async function ensureDailyFundNav() {
    const targets = accounts.value.rmb_pool.filter(
      (item) => isNavFundAccount(item) && fundNeedsNavRefresh(item),
    )
    const results = []
    for (const fund of targets) {
      try {
        results.push(await refreshFundNav(fund.id))
      } catch {
        /* 单只失败不影响其他产品 */
      }
    }
    return { updated: results.length > 0, results }
  }

  async function refreshGoldFundNav() {
    return refreshFundNav('gold_etf')
  }

  async function ensureDailyGoldFundNav() {
    const gold = accounts.value.rmb_pool.find((item) => item.id === 'gold_etf')
    if (!gold || !fundNeedsNavRefresh(gold)) {
      return { updated: false as const, result: null }
    }
    try {
      const result = await refreshFundNav('gold_etf')
      return { updated: true as const, result }
    } catch {
      return { updated: false as const, result: null }
    }
  }

  function updateRules(partial: Partial<FinanceRules>) {
    settings.value.rules = { ...settings.value.rules, ...partial }
    if (partial.safety_cap != null) {
      salary.value.settings.safety_pad_target = partial.safety_cap
    }
    syncCryptoYieldRates()
  }

  function updateSettings(partial: Partial<AppSettings>) {
    settings.value = {
      ...settings.value,
      ...partial,
      fx_to_hkd: partial.fx_to_hkd
        ? { ...settings.value.fx_to_hkd, ...partial.fx_to_hkd }
        : settings.value.fx_to_hkd,
      rules: partial.rules ? { ...settings.value.rules, ...partial.rules } : settings.value.rules,
      asset_classification: partial.asset_classification ?? settings.value.asset_classification,
    }
  }

  function updateFxRate(currency: BaseCurrency, rate: number) {
    if (currency === 'HKD') return
    settings.value.fx_to_hkd = {
      ...settings.value.fx_to_hkd,
      [currency]: rate,
    }
    // USDT 默认跟随 USD
    if (currency === 'USD') {
      settings.value.fx_to_hkd.USDT = rate
    }
  }

  function applyLiveFxQuotes(quotes: LiveFxSnapshot) {
    settings.value.fx_live = quotes
    // CNY/HKD 直接写入；USD/HKD 用 USD/CNH × CNY/HKD（离岸交叉）
    settings.value.fx_to_hkd = {
      ...settings.value.fx_to_hkd,
      CNY: quotes.cny_hkd,
      USD: quotes.usd_hkd,
      USDT: quotes.usd_hkd,
      ...(quotes.sgd_hkd ? { SGD: quotes.sgd_hkd } : {}),
    }
  }

  /** 拉取 USD/CNH + CNY/HKD + SGD/HKD 并更新本地汇率 */
  async function refreshLiveFxRates(force = false) {
    if (!force && settings.value.fx_live && !isFxStale(settings.value.fx_live.fetched_at)) {
      return {
        updated: false as const,
        quotes: settings.value.fx_live,
      }
    }
    const quotes = await fetchLiveFxQuotes()
    applyLiveFxQuotes(quotes)
    return { updated: true as const, quotes }
  }

  async function refreshNasdaqPe() {
    const { fetchNasdaqPe } = await import('@/utils/nasdaq-pe')
    const quote = await fetchNasdaqPe()
    updateRules({
      nasdaq_pe_current: quote.pe,
      nasdaq_pe_updated_at: quote.fetched_at,
      nasdaq_pe_as_of: quote.as_of,
    })
    return quote
  }

  async function refreshFearGreedIndex() {
    const { fetchFearGreedIndex } = await import('@/utils/fear-greed')
    const quote = await fetchFearGreedIndex()
    updateRules({
      fear_greed_index: quote.score,
      fear_greed_rating: quote.rating,
      fear_greed_updated_at: quote.fetched_at,
    })
    return quote
  }

  /** 启动时若跨日则自动刷新一次 */
  async function ensureDailyFxRates() {
    try {
      return await refreshLiveFxRates(false)
    } catch {
      return {
        updated: false as const,
        quotes: settings.value.fx_live ?? null,
      }
    }
  }

  return {
    refreshStockMarketPrices,
    refreshStockDividendYields,
    refreshStockQuotesAndYields,
    refreshFundNav,
    ensureDailyFundNav,
    refreshGoldFundNav,
    ensureDailyGoldFundNav,
    updateRules,
    updateSettings,
    updateFxRate,
    applyLiveFxQuotes,
    refreshLiveFxRates,
    refreshNasdaqPe,
    refreshFearGreedIndex,
    ensureDailyFxRates,
  }
}
