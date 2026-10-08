import dayjs from 'dayjs'
import type {
  AppSettings,
  BaseCurrency,
  FinanceRules,
  FundDailyPnl,
  LiveFxSnapshot,
} from '@/types/finance'
import { add, div, mul, round, sub } from '@/utils/decimal'
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

  /**
   * 拉取黄金联接基金最新净值，按份额重算市值与浮盈亏。
   * 需账户已有 fund_code + shares（或 fund_lots）。
   */
  async function refreshGoldFundNav() {
    const gold = accounts.value.rmb_pool.find((item) => item.id === 'gold_etf')
    if (!gold) throw new Error('未找到黄金账户')
    const code = gold.fund_code?.trim()
    if (!code) throw new Error('黄金账户缺少基金代码')

    let shares = gold.shares ?? 0
    let cost = gold.cost_amount ?? 0
    if (!(shares > 0) && gold.fund_lots?.length) {
      shares = round(
        gold.fund_lots.reduce((sum, lot) => add(sum, lot.shares), 0),
        4,
      )
      cost = round(
        gold.fund_lots.reduce((sum, lot) => add(sum, lot.amount), 0),
        2,
      )
      gold.shares = shares
      gold.cost_amount = cost
    }
    if (!(shares > 0)) throw new Error('黄金账户缺少持仓份额')
    if (!(cost > 0)) throw new Error('黄金账户缺少成本')

    const lots = gold.fund_lots ?? []
    const firstLotDate = lots.reduce(
      (min, lot) => (!min || lot.confirm_date < min ? lot.confirm_date : min),
      '',
    )
    const { fetchFundNavHistory, fundDailyPnlFromLots } = await import('@/utils/fund-nav')
    const quotes = await fetchFundNavHistory(code, {
      since: firstLotDate || undefined,
    })
    const quote = quotes[0]
    if (!quote) throw new Error('未返回有效净值')
    const market = round(mul(shares, quote.nav), 2)
    const pnl = sub(market, cost)
    const rate = div(pnl, cost)

    gold.nav = quote.nav
    gold.nav_updated_at = quote.as_of
    gold.prev_nav = quote.prev_nav
    gold.nav_day_change = quote.day_change
    gold.shares = shares
    gold.cost_amount = cost
    gold.amount = market
    gold.profit_rate = round(rate, 4)
    gold.amount_updated_at = dayjs().toISOString()

    const byDate = new Map((gold.daily_pnl ?? []).map((row) => [row.date, row] as const))
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
    gold.daily_pnl = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date))

    return {
      nav: quote.nav,
      as_of: quote.as_of,
      amount: market,
      cost,
      pnl: round(pnl, 2),
      profit_rate: gold.profit_rate,
      day_change: quote.day_change,
      prev_nav: quote.prev_nav,
    }
  }

  /** 启动时每天最多自动拉一次净值（周末净值不更也会跳过重复请求） */
  async function ensureDailyGoldFundNav() {
    const gold = accounts.value.rmb_pool.find((item) => item.id === 'gold_etf')
    if (!gold?.fund_code || !(gold.shares! > 0 || gold.fund_lots?.length)) {
      return { updated: false as const, result: null }
    }
    const today = dayjs().toISOString().slice(0, 10)
    const lastFetchDay = gold.amount_updated_at?.slice(0, 10)
    const hasPrevNav = gold.prev_nav != null && gold.prev_nav > 0
    const ledger = gold.daily_pnl ?? []
    const hasDailyLedger = ledger.length > 0
    const firstLotDate = (gold.fund_lots ?? []).reduce(
      (min, lot) => (!min || lot.confirm_date < min ? lot.confirm_date : min),
      '',
    )
    const oldestLedger = ledger.length
      ? ledger.reduce((min, row) => (row.date < min ? row.date : min), ledger[0]!.date)
      : ''
    const needsBackfill = Boolean(firstLotDate && oldestLedger && oldestLedger > firstLotDate)
    if (lastFetchDay === today && hasPrevNav && hasDailyLedger && !needsBackfill) {
      return { updated: false as const, result: null }
    }
    try {
      const result = await refreshGoldFundNav()
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
