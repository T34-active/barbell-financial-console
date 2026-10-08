import dayjs from 'dayjs'
import { type ComputedRef } from 'vue'
import type { PoolAccount, YuanGouOutcome, YuanGouRecord } from '@/types/finance'
import { convertCurrency } from '@/utils/currency'
import { add, round, sub } from '@/utils/decimal'
import { planHtxOverflow, type OverflowPlan } from '@/utils/htx-rebalance'
import { createId, currentYearMonth } from '@/utils/salary-allocation'
import { todayDateKey, yuanGouNoteFor, yuanGouOutcomeOf } from './normalize'
import type { FinanceRefs } from './state'

export function createYuanGou(
  refs: FinanceRefs,
  shared: {
    findCryptoAccount: (id: string) => PoolAccount | undefined
    syncCryptoYieldRates: () => void
  },
  crypto: {
    rebalanceHtxOverflow: (force?: boolean) => OverflowPlan & { executed: boolean }
    htxEarnUsdt: ComputedRef<number>
    okxEarnUsdt: ComputedRef<number>
  },
) {
  const { settings, yuanGou } = refs
  const { findCryptoAccount, syncCryptoYieldRates } = shared
  const { rebalanceHtxOverflow, htxEarnUsdt, okxEarnUsdt } = crypto

  const yuanGouToday = computed(() => {
    const key = todayDateKey()
    return yuanGou.value.history.find((item) => item.date === key) ?? null
  })

  /** 本月抢到的 USDT 合计（兼容旧命名） */
  const yuanGouMonthSpendUsdt = computed(() => {
    const prefix = currentYearMonth()
    return yuanGou.value.history
      .filter((item) => item.date.startsWith(prefix))
      .reduce((sum, item) => add(sum, item.got_usdt ?? 0), 0)
  })

  function summarizeYuanGou(records: typeof yuanGou.value.history) {
    const seen = new Set<string>()
    const unique = records.filter((item) => {
      if (seen.has(item.date)) return false
      seen.add(item.date)
      return true
    })
    let spendCny = 0
    let gotUsdt = 0
    let hitDays = 0
    let noneDays = 0
    for (const item of unique) {
      const outcome = yuanGouOutcomeOf(item)
      spendCny = add(spendCny, outcome === 'none' ? 0 : (item.cost_cny ?? 0))
      gotUsdt = add(gotUsdt, outcome === 'none' ? 0 : (item.got_usdt ?? 0))
      if (outcome === 'hit') hitDays += 1
      else noneDays += 1
    }
    const gotUsdtInCny = convertCurrency(gotUsdt, 'USDT', 'CNY', settings.value.fx_to_hkd)
    const netCny = round(sub(gotUsdtInCny, spendCny), 2)
    return {
      spendCny: round(spendCny, 2),
      gotUsdt: round(gotUsdt, 2),
      netCny,
      hitDays,
      missDays: 0,
      noneDays,
      days: unique.length,
      /** @deprecated 旧 UI 字段 */
      spend: round(spendCny, 2),
      win: round(gotUsdt, 2),
      net: netCny,
      buyDays: hitDays,
      skipDays: noneDays,
      winDays: hitDays,
    }
  }

  /** 一元购：指定账期 vs 累计（¥1 抢 1U 额度） */
  function yuanGouStatsForMonth(monthKey: string) {
    const [, monthNum] = monthKey.split('-')
    const monthLabel = `${Number(monthNum)}月`
    const monthRecords = yuanGou.value.history.filter((item) => item.date.startsWith(monthKey))
    return {
      monthKey,
      monthLabel,
      isCurrentMonth: monthKey === currentYearMonth(),
      month: summarizeYuanGou(monthRecords),
      total: summarizeYuanGou(yuanGou.value.history),
      holdingsUsdt: round(add(htxEarnUsdt.value, okxEarnUsdt.value), 2),
      dailyCostCny: yuanGou.value.daily_cost_cny ?? 1,
      rewardUsdt: yuanGou.value.reward_usdt ?? 1,
    }
  }

  /** 一元购：当前自然月 vs 累计 */
  const yuanGouPeriodStats = computed(() => yuanGouStatsForMonth(currentYearMonth()))

  function isValidDateKey(date: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(date)
  }

  /**
   * 记录一元购（支持补录）。仅两态：
   * - hit（买了）：支付宝付 ¥1，HTX +1U
   * - none（未购买）：备注「未购买」，不计花费
   */
  function recordYuanGou(input?: {
    date?: string
    /** hit=买了 / none=未购买 */
    outcome?: YuanGouOutcome
    /** true→买了；false→未购买（outcome 未传时） */
    gotQuota?: boolean
    /** @deprecated 使用 outcome / gotQuota */
    purchased?: boolean
    note?: string
  }) {
    const date = input?.date ?? todayDateKey()
    if (!isValidDateKey(date)) {
      throw new Error('日期格式须为 YYYY-MM-DD')
    }
    if (date > todayDateKey()) {
      throw new Error('不能打卡未来日期')
    }
    if (yuanGou.value.history.some((item) => item.date === date)) {
      throw new Error(`${date} 一元购已记录，请勿重复打卡`)
    }

    const isBackfill = date !== todayDateKey()
    const outcome: YuanGouOutcome =
      input?.outcome === 'none' || input?.outcome === 'hit'
        ? input.outcome
        : (input?.gotQuota ?? input?.purchased)
          ? 'hit'
          : 'none'
    const participated = outcome === 'hit'
    const costCny = participated ? (yuanGou.value.daily_cost_cny ?? 1) : 0
    const rewardUsdt = yuanGou.value.reward_usdt ?? 1
    const gotUsdt = participated ? rewardUsdt : 0
    const htx = findCryptoAccount('htx_earn_usdt')
    if (!htx) throw new Error('未找到 HTX 赚币账户')

    // 支付宝外付：只记账，不扣快乐基金 / 手头现金
    const fundedFrom: YuanGouRecord['funded_from'] = participated ? 'alipay' : 'none'

    if (gotUsdt > 0) {
      htx.amount = round(add(htx.amount, gotUsdt), 2)
    }

    yuanGou.value.history.unshift({
      id: createId('yg'),
      date,
      cost_cny: costCny,
      participated,
      got_quota: participated,
      got_usdt: gotUsdt,
      funded_from: fundedFrom,
      note:
        input?.note ??
        yuanGouNoteFor(
          outcome,
          costCny || (yuanGou.value.daily_cost_cny ?? 1),
          rewardUsdt,
          isBackfill,
        ),
      created_at: dayjs().toISOString(),
    })
    yuanGou.value.history.sort((a, b) => (a.date < b.date ? 1 : -1))

    syncCryptoYieldRates()
    let overflow = {
      ...planHtxOverflow(htx.amount, settings.value.rules),
      executed: false as boolean,
    }
    if (participated && overflow.canExecute) {
      const result = rebalanceHtxOverflow()
      overflow = { ...result, executed: result.executed }
    }

    return {
      costCny,
      gotUsdt,
      gotQuota: participated,
      outcome,
      participated,
      fundedFrom,
      overflow,
      date,
      isBackfill,
      /** @deprecated */
      cost: costCny,
      winAmount: gotUsdt,
      purchased: participated,
    }
  }

  function updateYuanGouDailyCost(costUsdt: number) {
    if (costUsdt <= 0) throw new Error('每日成本须大于 0')
    yuanGou.value.daily_cost_cny = costUsdt
    yuanGou.value.daily_cost_usdt = costUsdt
  }

  /**
   * 修正已有一元购打卡（买了 ↔ 未购买），并回滚/补记 HTX 到账。
   */
  function reviseYuanGou(date: string, outcome: YuanGouOutcome) {
    if (!isValidDateKey(date)) {
      throw new Error('日期格式须为 YYYY-MM-DD')
    }
    const row = yuanGou.value.history.find((item) => item.date === date)
    if (!row) throw new Error(`${date} 无一元购记录`)

    const nextParticipated = outcome === 'hit'
    const prevParticipated = row.participated && row.cost_cny > 0
    if (prevParticipated === nextParticipated) {
      return { date, outcome, changed: false }
    }

    const htx = findCryptoAccount('htx_earn_usdt')
    if (!htx) throw new Error('未找到 HTX 赚币账户')

    const rewardUsdt = yuanGou.value.reward_usdt ?? 1
    const costCny = yuanGou.value.daily_cost_cny ?? 1
    const prevGot = row.got_usdt ?? 0

    if (prevParticipated && !nextParticipated && prevGot > 0) {
      htx.amount = Math.max(0, round(sub(htx.amount, prevGot), 2))
    }
    if (!prevParticipated && nextParticipated) {
      htx.amount = round(add(htx.amount, rewardUsdt), 2)
    }

    const isBackfill = date !== todayDateKey() || /补录/.test(String(row.note ?? ''))
    row.participated = nextParticipated
    row.got_quota = nextParticipated
    row.cost_cny = nextParticipated ? costCny : 0
    row.got_usdt = nextParticipated ? rewardUsdt : 0
    row.funded_from = nextParticipated ? 'alipay' : 'none'
    row.note = yuanGouNoteFor(outcome, costCny, rewardUsdt, isBackfill)

    syncCryptoYieldRates()
    return { date, outcome, changed: true }
  }

  function applyYuanGouKnownFixes() {
    const key = 'yg-2026-08-08-none'
    const applied = yuanGou.value.applied_fixes ?? []
    if (applied.includes(key)) return
    const row = yuanGou.value.history.find((item) => item.date === '2026-08-08')
    if (row && row.participated && row.cost_cny > 0) {
      reviseYuanGou('2026-08-08', 'none')
    }
    yuanGou.value.applied_fixes = [...applied, key]
  }

  return {
    yuanGouToday,
    yuanGouMonthSpendUsdt,
    yuanGouStatsForMonth,
    yuanGouPeriodStats,
    recordYuanGou,
    updateYuanGouDailyCost,
    reviseYuanGou,
    applyYuanGouKnownFixes,
  }
}
