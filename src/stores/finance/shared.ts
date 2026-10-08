import { computed } from 'vue'
import type { BaseCurrency } from '@/types/finance'
import { convertCurrency, stockMarketValue } from '@/utils/currency'
import { add, round, sub } from '@/utils/decimal'
import { resolveHtxYieldRate } from '@/utils/htx-rebalance'
import type { FinanceRefs } from './state'

export function createShared(refs: FinanceRefs) {
  const { settings, accounts, salary } = refs

  const baseCurrency = computed(() => settings.value.base_currency)

  function toBase(amount: number, currency: BaseCurrency): number {
    return convertCurrency(amount, currency, settings.value.base_currency, settings.value.fx_to_hkd)
  }

  function findAccountById(id: string) {
    return (
      accounts.value.rmb_pool.find((item) => item.id === id) ||
      accounts.value.hkd_pool.find((item) => item.id === id) ||
      accounts.value.crypto_pool.find((item) => item.id === id) ||
      accounts.value.us_stock_pool.find((item) => item.id === id)
    )
  }

  function findCryptoAccount(id: string) {
    return accounts.value.crypto_pool.find((item) => item.id === id)
  }

  function syncCryptoYieldRates() {
    const rules = settings.value.rules
    const htx = findCryptoAccount('htx_earn_usdt')
    if (htx) {
      htx.yield_rate = resolveHtxYieldRate(htx.amount, rules)
    }
    const okx = findCryptoAccount('okx_earn_usdt')
    if (okx) {
      okx.yield_rate = rules.okx_yield_rate
    }
  }

  function findRmbAccount(id: string) {
    return accounts.value.rmb_pool.find((item) => item.id === id)
  }

  function yulibaoBucketTotal() {
    const b = salary.value.buckets
    return add(
      b.emergency_reserve,
      b.us_seed_parking,
      b.cash_observation,
      b.travel_fund_pocket ?? 0,
    )
  }

  function syncYulibaoFromBuckets() {
    const yulibao = findRmbAccount('yulibao')
    if (!yulibao) return
    yulibao.amount = round(yulibaoBucketTotal(), 2)
  }

  /** 改余利宝总额：总额含旅游暂存 / 种子 / 观察仓，差额归应急金 */
  function applyYulibaoTotal(next: number) {
    const b = salary.value.buckets
    const parking = b.us_seed_parking
    const observation = b.cash_observation
    const travel = b.travel_fund_pocket ?? 0
    const reserved = add(parking, observation, travel)
    if (next >= reserved) {
      b.emergency_reserve = round(sub(next, reserved), 2)
    } else {
      b.emergency_reserve = 0
      let short = round(sub(reserved, next), 2)
      const cutObs = Math.min(observation, short)
      b.cash_observation = round(sub(observation, cutObs), 2)
      short = round(sub(short, cutObs), 2)
      const cutTravel = Math.min(travel, short)
      b.travel_fund_pocket = round(sub(travel, cutTravel), 2)
      short = round(sub(short, cutTravel), 2)
      b.us_seed_parking = round(Math.max(0, sub(parking, short)), 2)
    }
    syncYulibaoFromBuckets()
  }

  function accountValueInBase(id: string): number {
    const account = findAccountById(id)
    if (!account) return 0
    if ('symbol' in account) {
      return toBase(stockMarketValue(account), account.currency)
    }
    // 余利宝按分桶拆分，避免整桶重复计入
    if (id === 'yulibao') return 0
    return toBase(account.amount, account.currency)
  }

  return {
    baseCurrency,
    toBase,
    findAccountById,
    findCryptoAccount,
    findRmbAccount,
    syncCryptoYieldRates,
    syncYulibaoFromBuckets,
    applyYulibaoTotal,
    accountValueInBase,
  }
}
