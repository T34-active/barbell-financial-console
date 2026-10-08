import dayjs from 'dayjs'
import { computed } from 'vue'
import type { PoolAccount } from '@/types/finance'
import { createId } from '@/utils/salary-allocation'
import { add, mul, round } from '@/utils/decimal'
import {
  estimateHtxYieldAccrual,
  isHtxHighYield,
  planHtxOverflow,
  resolveHtxYieldRate,
} from '@/utils/htx-rebalance'
import type { FinanceRefs } from './state'

export function createCrypto(
  refs: FinanceRefs,
  shared: {
    findCryptoAccount: (id: string) => PoolAccount | undefined
    syncCryptoYieldRates: () => void
  },
) {
  const { settings, cryptoOps } = refs
  const { findCryptoAccount, syncCryptoYieldRates } = shared

  const htxEarnUsdt = computed(() => findCryptoAccount('htx_earn_usdt')?.amount ?? 0)

  const okxEarnUsdt = computed(() => findCryptoAccount('okx_earn_usdt')?.amount ?? 0)

  function htxYieldAt(now: Date = dayjs().toDate()) {
    const rules = settings.value.rules
    const htx = findCryptoAccount('htx_earn_usdt')
    const balance = htx?.amount ?? 0
    const high = isHtxHighYield(balance, rules.htx_high_yield_threshold)
    const rate = resolveHtxYieldRate(balance, rules)
    const plan = planHtxOverflow(balance, rules)
    const subscribedAt = htx?.amount_updated_at ? dayjs(htx.amount_updated_at) : null
    const accrual = estimateHtxYieldAccrual(
      balance,
      rate,
      now,
      subscribedAt?.isValid() ? subscribedAt.toDate() : null,
    )
    return {
      balance,
      highYield: high,
      rate,
      hourly: accrual.hourly,
      daily: accrual.daily,
      creditedToday: accrual.creditedToday,
      hourRate: accrual.hourRate,
      dayRate: accrual.dayRate,
      annual: accrual.annual,
      hour: accrual.hour,
      minute: accrual.minute,
      second: accrual.second,
      compoundedPrincipal: accrual.compoundedPrincipal,
      interestStartAt: accrual.interestStartAt,
      firstPayoutAt: accrual.firstPayoutAt,
      nextPayoutAt: accrual.nextPayoutAt,
      waitingFirstPayout: accrual.waitingFirstPayout,
      payoutsCompleted: accrual.payoutsCompleted,
      hourlyLedger: accrual.hourlyLedger,
      threshold: rules.htx_high_yield_threshold,
      plan,
      label: high
        ? `高息守护中 (${round(mul(rate, 100), 0).toFixed(0)}%)`
        : `即将降息 (${round(mul(rate, 100), 1).toFixed(1)}%)，请执行溢流转存`,
    }
  }

  const htxYieldStatus = computed(() => htxYieldAt())

  function updateHtxEarnAmount(amount: number) {
    const htx = findCryptoAccount('htx_earn_usdt')
    if (!htx) throw new Error('未找到 HTX 赚币账户')
    if (amount < 0) throw new Error('余额不能为负')
    const next = round(amount, 2)
    const changed = htx.amount !== next
    htx.amount = next
    if (changed || !htx.amount_updated_at) {
      htx.amount_updated_at = dayjs().toISOString()
    }
    syncCryptoYieldRates()
  }

  function updateOkxEarnAmount(amount: number) {
    const okx = findCryptoAccount('okx_earn_usdt')
    if (!okx) throw new Error('未找到 OKX 账户')
    if (amount < 0) throw new Error('余额不能为负')
    okx.amount = round(amount, 2)
    syncCryptoYieldRates()
  }

  /** HTX ≥ 阈值时将溢出转至 OKX，锁定 HTX 在 target（默认 199） */
  function rebalanceHtxOverflow(force = false) {
    const htx = findCryptoAccount('htx_earn_usdt')
    const okx = findCryptoAccount('okx_earn_usdt')
    if (!htx || !okx) throw new Error('加密账户不完整')

    const plan = planHtxOverflow(htx.amount, settings.value.rules)
    if (!plan.needsAction) {
      return { ...plan, executed: false as const }
    }
    if (!plan.canExecute && !force) {
      cryptoOps.value.overflow_log.unshift({
        id: createId('ovf'),
        from: 'htx_earn_usdt',
        to: 'okx_earn_usdt',
        amount: 0,
        htx_before: plan.htxBefore,
        htx_after: plan.htxBefore,
        okx_after: okx.amount,
        executed: false,
        reason: plan.reason,
        created_at: dayjs().toISOString(),
      })
      syncCryptoYieldRates()
      return { ...plan, executed: false as const }
    }
    if (!plan.canExecute && force) {
      throw new Error(plan.reason)
    }

    htx.amount = plan.htxAfter
    okx.amount = round(add(okx.amount, plan.transferAmount), 2)
    syncCryptoYieldRates()

    cryptoOps.value.overflow_log.unshift({
      id: createId('ovf'),
      from: 'htx_earn_usdt',
      to: 'okx_earn_usdt',
      amount: plan.transferAmount,
      htx_before: plan.htxBefore,
      htx_after: htx.amount,
      okx_after: okx.amount,
      executed: true,
      reason: plan.reason,
      created_at: dayjs().toISOString(),
    })

    return { ...plan, executed: true as const }
  }

  return {
    htxEarnUsdt,
    okxEarnUsdt,
    htxYieldAt,
    htxYieldStatus,
    updateHtxEarnAmount,
    updateOkxEarnAmount,
    rebalanceHtxOverflow,
  }
}
