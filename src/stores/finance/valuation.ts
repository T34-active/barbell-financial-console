import dayjs from 'dayjs'
import { computed, type ComputedRef } from 'vue'
import type {
  BarbellBreakdown,
  BaseCurrency,
  EstimatedAnnualIncomeBreakdown,
  PoolAccount,
  UsStockHolding,
} from '@/types/finance'
import { stockCostBasis, stockMarketValue } from '@/utils/currency'
import { isNavFundAccount } from '@/utils/fund-nav'
import { add, div, mul, sub } from '@/utils/decimal'
import type { FinanceRefs } from './state'

export function createValuation(
  refs: FinanceRefs,
  shared: {
    toBase: (amount: number, currency: BaseCurrency) => number
    findAccountById: (id: string) => PoolAccount | UsStockHolding | undefined
    accountValueInBase: (id: string) => number
  },
  loans: {
    openLendReceivableValue: ComputedRef<number>
  },
) {
  const { settings, accounts, salary } = refs
  const { toBase, findAccountById, accountValueInBase } = shared
  const { openLendReceivableValue } = loans

  const rmbPoolValue = computed(() =>
    accounts.value.rmb_pool.reduce((sum, item) => add(sum, toBase(item.amount, item.currency)), 0),
  )

  const hkdPoolValue = computed(() =>
    accounts.value.hkd_pool.reduce((sum, item) => add(sum, toBase(item.amount, item.currency)), 0),
  )

  const usStockValue = computed(() =>
    accounts.value.us_stock_pool.reduce(
      (sum, item) => add(sum, toBase(stockMarketValue(item), item.currency)),
      0,
    ),
  )

  const usStockCost = computed(() =>
    accounts.value.us_stock_pool.reduce(
      (sum, item) => add(sum, toBase(stockCostBasis(item), item.currency)),
      0,
    ),
  )

  const cryptoPoolValue = computed(() =>
    accounts.value.crypto_pool.reduce(
      (sum, item) => add(sum, toBase(item.amount, item.currency)),
      0,
    ),
  )

  /** 净资产：账户存量 + 未收回借出（快乐基金口袋独立记账，不进账户故不虚增） */
  const netWorth = computed(() =>
    add(
      rmbPoolValue.value,
      hkdPoolValue.value,
      usStockValue.value,
      cryptoPoolValue.value,
      openLendReceivableValue.value,
    ),
  )

  const hsbcAccount = computed(() =>
    accounts.value.hkd_pool.find((item) => item.is_safety_line || item.id === 'hsbc'),
  )

  const isSafetyLineBreached = computed(() => {
    const hsbc = hsbcAccount.value
    if (!hsbc) return false
    return hsbc.amount < settings.value.hsbc_safety_line
  })

  const safetyGap = computed(() => {
    const hsbc = hsbcAccount.value
    if (!hsbc) return 0
    return sub(settings.value.hsbc_safety_line, hsbc.amount)
  })

  /** 哑铃三端：安全 / 进取 / 中性（黄金 + HTX 赚币等） */
  const barbell = computed<BarbellBreakdown>(() => {
    const cls = settings.value.asset_classification
    const buckets = salary.value.buckets
    const parts: BarbellBreakdown['parts'] = []

    const pushPart = (
      sleeve: BarbellBreakdown['parts'][number]['sleeve'],
      id: string,
      name: string,
      value: number,
    ) => {
      if (value <= 0) return
      parts.push({ sleeve, id, name, value })
    }

    const accountLabel = (id: string) => {
      const account = findAccountById(id)
      if (!account) return id
      if ('symbol' in account) return account.symbol || account.name
      return account.name
    }

    let safeValue = 0
    for (const id of cls.safe_assets) {
      if (id === 'yulibao') {
        const emergency = toBase(buckets.emergency_reserve, 'CNY')
        const observation = toBase(buckets.cash_observation, 'CNY')
        const travel = toBase(buckets.travel_fund_pocket ?? 0, 'CNY')
        pushPart('safe', 'emergency_reserve', '应急金', emergency)
        pushPart('safe', 'cash_observation', '观察仓', observation)
        pushPart('safe', 'travel_fund_pocket', '旅游暂存', travel)
        safeValue = add(safeValue, emergency, observation, travel)
      } else {
        const value = accountValueInBase(id)
        pushPart('safe', id, accountLabel(id), value)
        safeValue = add(safeValue, value)
      }
    }

    let riskValue = 0
    for (const id of cls.offensive_assets) {
      const value = accountValueInBase(id)
      pushPart('risk', id, accountLabel(id), value)
      riskValue = add(riskValue, value)
    }
    // 美股种子暂存视为已承诺的进攻端
    const seedParking = toBase(buckets.us_seed_parking, 'CNY')
    pushPart('risk', 'us_seed_parking', '种子暂存', seedParking)
    riskValue = add(riskValue, seedParking)

    let neutralValue = 0
    for (const id of cls.neutral_assets) {
      const value = accountValueInBase(id)
      pushPart('neutral', id, accountLabel(id), value)
      neutralValue = add(neutralValue, value)
    }
    // 加密赌注池计入中性/另类统计，严禁混入安全或美股进攻
    for (const id of cls.crypto_assets ?? []) {
      const value = accountValueInBase(id)
      pushPart('neutral', id, accountLabel(id), value)
      neutralValue = add(neutralValue, value)
    }

    const receivable = openLendReceivableValue.value
    pushPart('safe', 'lend_receivable', '借出应收', receivable)
    safeValue = add(safeValue, receivable)

    const totalValue = add(safeValue, riskValue, neutralValue)
    return {
      safeValue,
      riskValue,
      neutralValue,
      totalValue,
      safeRatio: totalValue ? div(safeValue, totalValue) : 0,
      riskRatio: totalValue ? div(riskValue, totalValue) : 0,
      neutralRatio: totalValue ? div(neutralValue, totalValue) : 0,
      parts,
    }
  })

  const estimatedAnnualIncomeBreakdown = computed<EstimatedAnnualIncomeBreakdown>(() => {
    const lines: EstimatedAnnualIncomeBreakdown['lines'] = []

    const pushCash = (item: {
      id: string
      name: string
      amount: number
      currency: BaseCurrency
      yield_rate?: number
    }) => {
      if (!item.yield_rate) return 0
      const principal = toBase(item.amount, item.currency)
      const amount = toBase(mul(item.amount, item.yield_rate), item.currency)
      if (amount <= 0) return 0
      lines.push({
        id: item.id,
        name: item.name,
        kind: 'cash',
        principal,
        rate: item.yield_rate,
        amount,
      })
      return amount
    }

    const cashYield = accounts.value.rmb_pool.reduce((sum, item) => {
      if (isNavFundAccount(item)) return sum
      return add(sum, pushCash(item))
    }, 0)

    const hkdYield = accounts.value.hkd_pool.reduce((sum, item) => add(sum, pushCash(item)), 0)

    const cryptoYield = accounts.value.crypto_pool.reduce(
      (sum, item) => add(sum, pushCash(item)),
      0,
    )

    const dividend = accounts.value.us_stock_pool.reduce((sum, item) => {
      if (!item.est_div_yield) return sum
      const market = stockMarketValue(item)
      const principal = toBase(market, item.currency)
      const amount = toBase(mul(market, item.est_div_yield), item.currency)
      if (amount <= 0) return sum
      lines.push({
        id: item.id,
        name: `${item.symbol} · ${item.name}`,
        kind: 'dividend',
        principal,
        rate: item.est_div_yield,
        amount,
      })
      return add(sum, amount)
    }, 0)

    return {
      total: add(cashYield, hkdYield, cryptoYield, dividend),
      cashYield,
      hkdYield,
      cryptoYield,
      dividend,
      lines,
    }
  })

  const estimatedAnnualIncome = computed(() => estimatedAnnualIncomeBreakdown.value.total)

  const emergencyReserve = computed(() => salary.value.buckets.emergency_reserve)
  const usSeedParking = computed(() => salary.value.buckets.us_seed_parking)
  const cashObservation = computed(() => salary.value.buckets.cash_observation)
  const funFundPocket = computed(() => salary.value.buckets.fun_fund_pocket)
  const travelFundPocket = computed(() => salary.value.buckets.travel_fund_pocket ?? 0)
  const safetyPadTarget = computed(
    () => settings.value.rules.safety_cap || salary.value.settings.safety_pad_target,
  )
  const isSafetyPadFull = computed(() => emergencyReserve.value >= safetyPadTarget.value)
  const isPeGuardActive = computed(() => {
    const rules = settings.value.rules
    return rules.pe_guard_enabled && rules.nasdaq_pe_current > rules.nasdaq_pe_threshold
  })
  const safetyPadProgress = computed(() => ({
    current: emergencyReserve.value,
    target: safetyPadTarget.value,
    ratio: safetyPadTarget.value
      ? Math.min(div(emergencyReserve.value, safetyPadTarget.value), 1)
      : 0,
    gap: Math.max(sub(safetyPadTarget.value, emergencyReserve.value), 0),
  }))

  const allocationModeLabel = computed(() => {
    if (isPeGuardActive.value) {
      return isSafetyPadFull.value
        ? '已满 · 进攻份额暂扣观察仓（高估）'
        : '补仓中 · 且进攻份额暂扣观察仓（高估）'
    }
    return isSafetyPadFull.value ? '已满 · 安全垫份额转美股种子' : '补仓中 · 优先恢复安全垫'
  })

  const monthsSinceLastRemit = computed(() => {
    const since = salary.value.last_remit_at
    const history = salary.value.history
    if (!since) return history.length
    const sinceTime = dayjs(since).valueOf()
    return history.filter((item) => dayjs(item.created_at).valueOf() > sinceTime).length
  })

  const monthsUntilRemit = computed(() => {
    const cycle = salary.value.settings.us_seed_remit_months
    return Math.max(cycle - monthsSinceLastRemit.value, 0)
  })

  return {
    rmbPoolValue,
    hkdPoolValue,
    usStockValue,
    usStockCost,
    cryptoPoolValue,
    netWorth,
    hsbcAccount,
    isSafetyLineBreached,
    safetyGap,
    barbell,
    estimatedAnnualIncome,
    estimatedAnnualIncomeBreakdown,
    emergencyReserve,
    usSeedParking,
    cashObservation,
    funFundPocket,
    travelFundPocket,
    safetyPadTarget,
    isSafetyPadFull,
    isPeGuardActive,
    safetyPadProgress,
    allocationModeLabel,
    monthsSinceLastRemit,
    monthsUntilRemit,
  }
}
