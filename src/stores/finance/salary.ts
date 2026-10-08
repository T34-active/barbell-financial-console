import dayjs from 'dayjs'
import { computed, type ComputedRef } from 'vue'
import type {
  ExtraIncomeMode,
  ExtraIncomeRecord,
  FunFundCarryoverRule,
  FunFundRecurringCharge,
  MonthlySavingsStat,
  PoolAccount,
  SalaryPlanSettings,
  SalaryRatios,
} from '@/types/finance'
import { add, div, round, sub } from '@/utils/decimal'
import { mergeFunFundCharges, resolveFunFundReserve } from '@/utils/fun-fund-charge'
import {
  buildSalaryAllocation,
  createId,
  currentYearMonth,
  ratiosAreValid,
  ratiosWithoutParents,
  splitHalf,
} from '@/utils/salary-allocation'
import type { FinanceRefs } from './state'

export function createSalary(
  refs: FinanceRefs,
  shared: {
    syncYulibaoFromBuckets: () => void
    findRmbAccount: (id: string) => PoolAccount | undefined
  },
  valuation: {
    safetyPadTarget: ComputedRef<number>
    isPeGuardActive: ComputedRef<boolean>
  },
  accountsApi: {
    updateStockPrices: (prices: Array<{ id: string; market_price: number }>) => void
  },
) {
  const { settings, accounts, salary } = refs
  const { syncYulibaoFromBuckets, findRmbAccount } = shared
  const { safetyPadTarget, isPeGuardActive } = valuation
  const { updateStockPrices } = accountsApi

  function savingsForPeriod(yearMonth: string): MonthlySavingsStat | null {
    const record = salary.value.history.find((item) => item.year_month === yearMonth)
    const extras = (salary.value.extra_income_history ?? []).filter(
      (item) => item.year_month === yearMonth,
    )
    if (!record && extras.length === 0) return null

    const salaryAmount = record?.salary ?? 0
    const extraAmount = extras.reduce((sum, item) => add(sum, item.amount), 0)
    const income = add(salaryAmount, extraAmount)
    if (income <= 0) return null

    const salarySaved = record
      ? add(
          record.lines.find((line) => line.key === 'safety_pad')?.amount ?? 0,
          record.lines.find((line) => line.key === 'us_seed')?.amount ?? 0,
        )
      : 0
    const extraSaved = extras.reduce((sum, item) => {
      if (item.mode === 'to_safety' || item.mode === 'to_seed') {
        return add(sum, item.amount)
      }
      if (item.mode === 'to_fun' || item.mode === 'to_cash' || item.mode === 'to_travel') return sum
      const safety = item.lines?.find((line) => line.key === 'safety_pad')?.amount ?? 0
      const seed = item.lines?.find((line) => line.key === 'us_seed')?.amount ?? 0
      return add(sum, safety, seed)
    }, 0)
    const saved = add(salarySaved, extraSaved)
    return {
      year_month: yearMonth,
      salary: income,
      extra: extraAmount,
      saved,
      rate: div(saved, income),
    }
  }

  /** 日历当月账期储蓄率（兼容旧调用；发薪顺延跨月时请用 savingsForPeriod） */
  const currentMonthSavings = computed<MonthlySavingsStat | null>(() =>
    savingsForPeriod(currentYearMonth()),
  )

  /**
   * 预览分配。注意：安全垫满额 / PE 高估等判定均基于「调用瞬间」的余额与设置，
   * 不会因名义发薪日提前自动切换；真正落账只发生在 confirmAllocation。
   */
  function previewAllocation(amount: number, yearMonth = currentYearMonth()) {
    const rules = settings.value.rules
    const reserveForPeriod = funFundReserve.value.lines
      .filter((line) => line.period === yearMonth)
      .reduce((sum, line) => add(sum, line.reserveCny), 0)
    return buildSalaryAllocation({
      salary: amount,
      ratios: salary.value.settings.ratios,
      emergencyReserve: salary.value.buckets.emergency_reserve,
      safetyPadTarget: safetyPadTarget.value,
      peGuardEnabled: rules.pe_guard_enabled,
      nasdaqPeCurrent: rules.nasdaq_pe_current,
      nasdaqPeThreshold: rules.nasdaq_pe_threshold,
      funFundReserveCny: reserveForPeriod,
    })
  }

  function getRecordByMonth(yearMonth: string) {
    return salary.value.history.find((item) => item.year_month === yearMonth)
  }

  function revokeAllocation(yearMonth: string): boolean {
    const index = salary.value.history.findIndex((item) => item.year_month === yearMonth)
    if (index < 0) return false

    const record = salary.value.history[index]!
    const safetyLine = record.lines.find((line) => line.key === 'safety_pad')
    const seedLine = record.lines.find((line) => line.key === 'us_seed')
    const funLine = record.lines.find((line) => line.key === 'fun_fund')
    const travelLine = record.lines.find((line) => line.key === 'travel_fund')

    const seedAmount = seedLine?.amount ?? 0
    const obsAmount = record.observation_amount ?? 0
    const parkingAmount = Math.max(0, sub(seedAmount, obsAmount))

    salary.value.buckets.emergency_reserve = Math.max(
      0,
      sub(salary.value.buckets.emergency_reserve, safetyLine?.amount ?? 0),
    )
    salary.value.buckets.us_seed_parking = Math.max(
      0,
      sub(salary.value.buckets.us_seed_parking, parkingAmount),
    )
    salary.value.buckets.cash_observation = Math.max(
      0,
      sub(salary.value.buckets.cash_observation, obsAmount),
    )

    // 回滚快乐口袋或已结转份额
    if (funLine) {
      if (record.fun_fund_carried) {
        const carry = salary.value.carryover_history.find((item) => item.year_month === yearMonth)
        if (carry) {
          salary.value.buckets.emergency_reserve = Math.max(
            0,
            sub(salary.value.buckets.emergency_reserve, carry.to_safety),
          )
          // 结转进攻端可能进了种子或观察仓，优先从种子扣，不足再扣观察仓
          let seedLeft = carry.to_seed
          const fromParking = Math.min(salary.value.buckets.us_seed_parking, seedLeft)
          salary.value.buckets.us_seed_parking = sub(
            salary.value.buckets.us_seed_parking,
            fromParking,
          )
          seedLeft = sub(seedLeft, fromParking)
          salary.value.buckets.cash_observation = Math.max(
            0,
            sub(salary.value.buckets.cash_observation, seedLeft),
          )
          salary.value.carryover_history = salary.value.carryover_history.filter(
            (item) => item.id !== carry.id,
          )
        }
      } else {
        const remaining = Math.max(0, sub(funLine.amount, record.fun_fund_spent ?? 0))
        salary.value.buckets.fun_fund_pocket = Math.max(
          0,
          sub(salary.value.buckets.fun_fund_pocket, remaining),
        )
      }
    }

    if (travelLine) {
      salary.value.buckets.travel_fund_pocket = Math.max(
        0,
        sub(salary.value.buckets.travel_fund_pocket ?? 0, travelLine.amount ?? 0),
      )
    }

    syncYulibaoFromBuckets()
    salary.value.history.splice(index, 1)
    return true
  }

  function confirmAllocation(amount: number, yearMonth = currentYearMonth()) {
    if (amount <= 0) throw new Error('工资必须大于 0')
    if (!ratiosAreValid(salary.value.settings.ratios)) {
      throw new Error('工资分配比例合计必须为 100%')
    }

    // 上月快乐基金未结转则禁止新入账
    const openFun = salary.value.history.find(
      (item) =>
        item.year_month !== yearMonth &&
        !item.fun_fund_carried &&
        sub(item.lines.find((l) => l.key === 'fun_fund')?.amount ?? 0, item.fun_fund_spent) > 0.001,
    )
    if (openFun && salary.value.buckets.fun_fund_pocket > 0.001) {
      throw new Error(`请先对 ${openFun.year_month} 的快乐基金余量做月末结转，禁止沉淀在现金池`)
    }

    const existing = getRecordByMonth(yearMonth)
    if (existing) revokeAllocation(yearMonth)

    // 硬约束：安全垫是否满额、进攻比例是否 60%、PE 观察仓——全部在「确认入账」瞬间按当时余额重算，
    // 绝不因名义发薪日（如 10 号周末）提前改比例。
    const emergencySnapshot = salary.value.buckets.emergency_reserve
    const rules = settings.value.rules
    const preview = buildSalaryAllocation({
      salary: amount,
      ratios: salary.value.settings.ratios,
      emergencyReserve: emergencySnapshot,
      safetyPadTarget: safetyPadTarget.value,
      peGuardEnabled: rules.pe_guard_enabled,
      nasdaqPeCurrent: rules.nasdaq_pe_current,
      nasdaqPeThreshold: rules.nasdaq_pe_threshold,
    })
    const safetyAmount = preview.lines.find((line) => line.key === 'safety_pad')?.amount ?? 0
    const funAmount = preview.lines.find((line) => line.key === 'fun_fund')?.amount ?? 0
    const travelAmount = preview.lines.find((line) => line.key === 'travel_fund')?.amount ?? 0

    salary.value.buckets.emergency_reserve = add(
      salary.value.buckets.emergency_reserve,
      safetyAmount,
    )
    salary.value.buckets.us_seed_parking = add(
      salary.value.buckets.us_seed_parking,
      preview.usSeedParkingAmount,
    )
    salary.value.buckets.cash_observation = add(
      salary.value.buckets.cash_observation,
      preview.observationAmount,
    )
    salary.value.buckets.fun_fund_pocket = add(salary.value.buckets.fun_fund_pocket, funAmount)
    salary.value.buckets.travel_fund_pocket = add(
      salary.value.buckets.travel_fund_pocket ?? 0,
      travelAmount,
    )
    syncYulibaoFromBuckets()

    salary.value.history.unshift({
      id: createId('sal'),
      year_month: yearMonth,
      salary: amount,
      mode: preview.mode,
      pe_guard_active: preview.peGuardActive,
      lines: preview.lines,
      observation_amount: preview.observationAmount,
      fun_fund_spent: 0,
      fun_fund_carried: funAmount <= 0,
      created_at: dayjs().toISOString(),
    })

    return preview
  }

  function extraIncomeRatios(mode: ExtraIncomeMode) {
    const ratios = salary.value.settings.ratios
    if (mode === 'skip_parents') return ratiosWithoutParents(ratios)
    return ratios
  }

  function previewExtraIncome(amount: number, mode: ExtraIncomeMode) {
    if (mode !== 'salary_split' && mode !== 'skip_parents') return null
    const rules = settings.value.rules
    return buildSalaryAllocation({
      salary: Math.max(0, amount),
      ratios: extraIncomeRatios(mode),
      emergencyReserve: salary.value.buckets.emergency_reserve,
      safetyPadTarget: safetyPadTarget.value,
      peGuardEnabled: rules.pe_guard_enabled,
      nasdaqPeCurrent: rules.nasdaq_pe_current,
      nasdaqPeThreshold: rules.nasdaq_pe_threshold,
    })
  }

  function recordExtraIncome(input: {
    amount: number
    note: string
    mode: ExtraIncomeMode
    yearMonth?: string
  }) {
    const amount = round(input.amount, 2)
    if (!(amount > 0)) throw new Error('额外收入必须大于 0')
    const note = input.note.trim()
    if (!note) throw new Error('请填写来源备注，例如「保险项目」')
    const yearMonth = input.yearMonth ?? currentYearMonth()
    const mode = input.mode
    const now = dayjs().toISOString()

    const record: ExtraIncomeRecord = {
      id: createId('xinc'),
      year_month: yearMonth,
      amount,
      note,
      mode,
      created_at: now,
    }

    if (mode === 'salary_split' || mode === 'skip_parents') {
      const preview = previewExtraIncome(amount, mode)
      if (!preview) throw new Error('无法预览额外收入分配')
      const safetyAmount = preview.lines.find((line) => line.key === 'safety_pad')?.amount ?? 0
      const funAmount = preview.lines.find((line) => line.key === 'fun_fund')?.amount ?? 0
      const travelAmount = preview.lines.find((line) => line.key === 'travel_fund')?.amount ?? 0
      salary.value.buckets.emergency_reserve = add(
        salary.value.buckets.emergency_reserve,
        safetyAmount,
      )
      salary.value.buckets.us_seed_parking = add(
        salary.value.buckets.us_seed_parking,
        preview.usSeedParkingAmount,
      )
      salary.value.buckets.cash_observation = add(
        salary.value.buckets.cash_observation,
        preview.observationAmount,
      )
      salary.value.buckets.fun_fund_pocket = add(salary.value.buckets.fun_fund_pocket, funAmount)
      salary.value.buckets.travel_fund_pocket = add(
        salary.value.buckets.travel_fund_pocket ?? 0,
        travelAmount,
      )
      syncYulibaoFromBuckets()
      record.lines = preview.lines
      record.observation_amount = preview.observationAmount
    } else if (mode === 'to_safety') {
      salary.value.buckets.emergency_reserve = add(salary.value.buckets.emergency_reserve, amount)
      syncYulibaoFromBuckets()
    } else if (mode === 'to_seed') {
      if (isPeGuardActive.value) {
        salary.value.buckets.cash_observation = add(salary.value.buckets.cash_observation, amount)
        record.observation_amount = amount
      } else {
        salary.value.buckets.us_seed_parking = add(salary.value.buckets.us_seed_parking, amount)
      }
      syncYulibaoFromBuckets()
    } else if (mode === 'to_fun') {
      salary.value.buckets.fun_fund_pocket = add(salary.value.buckets.fun_fund_pocket, amount)
    } else if (mode === 'to_travel') {
      salary.value.buckets.travel_fund_pocket = add(
        salary.value.buckets.travel_fund_pocket ?? 0,
        amount,
      )
      syncYulibaoFromBuckets()
    } else if (mode === 'to_cash') {
      const cash = findRmbAccount('cash_rmb')
      if (!cash) throw new Error('未找到手头现金账户')
      cash.amount = round(add(cash.amount, amount), 2)
      cash.amount_updated_at = now
    }

    if (!salary.value.extra_income_history) {
      salary.value.extra_income_history = []
    }
    salary.value.extra_income_history.unshift(record)
    return record
  }

  function revokeExtraIncome(id: string): boolean {
    const list = salary.value.extra_income_history ?? []
    const index = list.findIndex((item) => item.id === id)
    if (index < 0) return false
    const record = list[index]!
    const amount = record.amount
    const obs = record.observation_amount ?? 0

    if (record.mode === 'salary_split' || record.mode === 'skip_parents') {
      const safety = record.lines?.find((line) => line.key === 'safety_pad')?.amount ?? 0
      const seed = record.lines?.find((line) => line.key === 'us_seed')?.amount ?? 0
      const fun = record.lines?.find((line) => line.key === 'fun_fund')?.amount ?? 0
      const travel = record.lines?.find((line) => line.key === 'travel_fund')?.amount ?? 0
      const parking = Math.max(0, sub(seed, obs))
      salary.value.buckets.emergency_reserve = Math.max(
        0,
        sub(salary.value.buckets.emergency_reserve, safety),
      )
      salary.value.buckets.us_seed_parking = Math.max(
        0,
        sub(salary.value.buckets.us_seed_parking, parking),
      )
      salary.value.buckets.cash_observation = Math.max(
        0,
        sub(salary.value.buckets.cash_observation, obs),
      )
      salary.value.buckets.fun_fund_pocket = Math.max(
        0,
        sub(salary.value.buckets.fun_fund_pocket, fun),
      )
      salary.value.buckets.travel_fund_pocket = Math.max(
        0,
        sub(salary.value.buckets.travel_fund_pocket ?? 0, travel),
      )
      syncYulibaoFromBuckets()
    } else if (record.mode === 'to_safety') {
      salary.value.buckets.emergency_reserve = Math.max(
        0,
        sub(salary.value.buckets.emergency_reserve, amount),
      )
      syncYulibaoFromBuckets()
    } else if (record.mode === 'to_seed') {
      if (obs > 0) {
        salary.value.buckets.cash_observation = Math.max(
          0,
          sub(salary.value.buckets.cash_observation, obs),
        )
      } else {
        salary.value.buckets.us_seed_parking = Math.max(
          0,
          sub(salary.value.buckets.us_seed_parking, amount),
        )
      }
      syncYulibaoFromBuckets()
    } else if (record.mode === 'to_fun') {
      salary.value.buckets.fun_fund_pocket = Math.max(
        0,
        sub(salary.value.buckets.fun_fund_pocket, amount),
      )
    } else if (record.mode === 'to_travel') {
      salary.value.buckets.travel_fund_pocket = Math.max(
        0,
        sub(salary.value.buckets.travel_fund_pocket ?? 0, amount),
      )
      syncYulibaoFromBuckets()
    } else if (record.mode === 'to_cash') {
      const cash = findRmbAccount('cash_rmb')
      if (cash) {
        cash.amount = Math.max(0, round(sub(cash.amount, amount), 2))
        cash.amount_updated_at = dayjs().toISOString()
      }
    }

    list.splice(index, 1)
    return true
  }

  function funFundAllocatedForMonth(yearMonth: string) {
    const record = getRecordByMonth(yearMonth)
    const fromSalary = record?.lines.find((line) => line.key === 'fun_fund')?.amount ?? 0
    const fromExtra = (salary.value.extra_income_history ?? [])
      .filter((item) => item.year_month === yearMonth)
      .reduce((sum, item) => {
        if (item.mode === 'to_fun') return add(sum, item.amount)
        return add(sum, item.lines?.find((line) => line.key === 'fun_fund')?.amount ?? 0)
      }, 0)
    return round(add(fromSalary, fromExtra), 2)
  }

  /** 尚未结转、仍有额度的快乐基金账期（优先最近一条） */
  function openFunFundPeriod(): string | null {
    const open = salary.value.history.find(
      (item) =>
        !item.fun_fund_carried &&
        (item.lines.find((line) => line.key === 'fun_fund')?.amount ?? 0) > 0.001,
    )
    if (open) return open.year_month
    const extraOpen = (salary.value.extra_income_history ?? []).find((item) => {
      const fun =
        item.mode === 'to_fun'
          ? item.amount
          : (item.lines?.find((line) => line.key === 'fun_fund')?.amount ?? 0)
      return fun > 0.001
    })
    return extraOpen?.year_month ?? null
  }

  const funFundReserve = computed(() =>
    resolveFunFundReserve({
      charges: salary.value.settings.fun_fund_charges ?? [],
      payments: salary.value.fun_fund_charge_history ?? [],
      pocket: salary.value.buckets.fun_fund_pocket,
      openPeriod: openFunFundPeriod(),
      fxToHkd: settings.value.fx_to_hkd,
    }),
  )
  const funFundSpendable = computed(() => funFundReserve.value.spendableCny)

  function deductFunFund(amount: number, yearMonth = currentYearMonth()) {
    if (amount <= 0) throw new Error('花销金额必须大于 0')
    if (amount > salary.value.buckets.fun_fund_pocket + 1e-9) {
      throw new Error('快乐基金余量不足')
    }
    const record = getRecordByMonth(yearMonth)
    if (record?.fun_fund_carried) {
      throw new Error('本月快乐基金已结转，无法再支出')
    }

    salary.value.buckets.fun_fund_pocket = sub(salary.value.buckets.fun_fund_pocket, amount)
    if (record) {
      record.fun_fund_spent = add(record.fun_fund_spent, amount)
    }
    return salary.value.buckets.fun_fund_pocket
  }

  function spendFunFund(amount: number, yearMonth = currentYearMonth()) {
    const reserve = funFundReserve.value
    if (amount > reserve.spendableCny + 1e-9) {
      const locked = reserve.lines
        .map((line) => `${line.charge.label} ${line.reserveCny.toFixed(2)}`)
        .join('、')
      throw new Error(
        reserve.reserveCny > 0
          ? `可支配余额不足：须先锁 ${locked}，最多还能花 ${reserve.spendableCny.toFixed(2)}`
          : '快乐基金余量不足',
      )
    }
    return deductFunFund(amount, yearMonth)
  }

  function spendTravelFund(amount: number) {
    if (amount <= 0) throw new Error('花销金额必须大于 0')
    const pocket = salary.value.buckets.travel_fund_pocket ?? 0
    if (amount > pocket) {
      throw new Error('旅游基金余量不足')
    }
    salary.value.buckets.travel_fund_pocket = sub(pocket, amount)
    syncYulibaoFromBuckets()
    return salary.value.buckets.travel_fund_pocket
  }

  /** 按「现在还剩多少」对账：花销 = 本月额度 − 剩余 */
  function setFunFundRemaining(remaining: number, yearMonth = currentYearMonth()) {
    const next = round(Math.max(0, remaining), 2)
    const record = getRecordByMonth(yearMonth)
    if (record?.fun_fund_carried) {
      throw new Error('本月快乐基金已结转，无法再改余额')
    }
    const allocated = funFundAllocatedForMonth(yearMonth)
    const cap = allocated > 0 ? allocated : salary.value.buckets.fun_fund_pocket
    const reserve = funFundReserve.value.reserveCny
    if (next > cap + 1e-9) {
      throw new Error(
        `剩余不能超过本月额度 ${cap.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      )
    }
    if (reserve > 0 && next + 1e-9 < reserve) {
      throw new Error(
        `剩余不能低于已锁订阅 ${reserve.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      )
    }
    salary.value.buckets.fun_fund_pocket = next
    const spent = Math.max(0, round(sub(cap, next), 2))
    if (record) record.fun_fund_spent = spent
    return { remaining: next, spent, allocated: cap }
  }

  function carryOverFunFund(yearMonth = currentYearMonth()) {
    const record = getRecordByMonth(yearMonth)
    if (!record) throw new Error('该月无工资入账记录')
    if (record.fun_fund_carried) throw new Error('该月快乐基金已结转')

    const unpaid = funFundReserve.value.lines.filter((line) => line.period === yearMonth)
    if (unpaid.length) {
      const names = unpaid.map((line) => line.charge.label).join('、')
      throw new Error(`请先扣除 ${names}，禁止把订阅预算结转走`)
    }

    const remaining = salary.value.buckets.fun_fund_pocket
    if (remaining <= 0) {
      record.fun_fund_carried = true
      return { amount: 0, toSafety: 0, toSeed: 0 }
    }

    const rule = settings.value.rules.carryover_rule
    let toSafety = 0
    let toSeed = 0
    if (rule === 'surplus_happy_fund_to_offensive') {
      toSeed = remaining
    } else {
      ;({ toSafety, toSeed } = splitHalf(remaining))
    }

    salary.value.buckets.fun_fund_pocket = 0
    salary.value.buckets.emergency_reserve = add(salary.value.buckets.emergency_reserve, toSafety)
    // 结转进攻端：若 PE 高估则进观察仓，否则进美股种子
    if (isPeGuardActive.value) {
      salary.value.buckets.cash_observation = add(salary.value.buckets.cash_observation, toSeed)
    } else {
      salary.value.buckets.us_seed_parking = add(salary.value.buckets.us_seed_parking, toSeed)
    }
    syncYulibaoFromBuckets()

    record.fun_fund_carried = true
    salary.value.carryover_history.unshift({
      id: createId('carry'),
      year_month: yearMonth,
      amount: remaining,
      rule,
      to_safety: toSafety,
      to_seed: toSeed,
      created_at: dayjs().toISOString(),
    })

    return { amount: remaining, toSafety, toSeed }
  }

  function payFunFundCharge(chargeId: string, yearMonth = currentYearMonth()) {
    const charge = (salary.value.settings.fun_fund_charges ?? []).find(
      (item) => item.id === chargeId && item.enabled,
    )
    if (!charge) throw new Error('没有这笔快乐基金订阅')

    const line = funFundReserve.value.lines.find((item) => item.charge.id === chargeId)
    if (!line) {
      throw new Error(`${charge.label} 本账期无需再锁，或已扣除`)
    }

    const amountCny = line.reserveCny
    if (amountCny > salary.value.buckets.fun_fund_pocket + 1e-9) {
      throw new Error(
        `快乐基金不够扣 ${charge.label}：还差 ${round(sub(amountCny, salary.value.buckets.fun_fund_pocket), 2).toFixed(2)}`,
      )
    }

    const period = line.period
    deductFunFund(amountCny, getRecordByMonth(period) ? period : yearMonth)
    if (!salary.value.fun_fund_charge_history) {
      salary.value.fun_fund_charge_history = []
    }
    salary.value.fun_fund_charge_history.unshift({
      id: createId('ffc'),
      charge_id: charge.id,
      period,
      amount_cny: amountCny,
      amount: charge.amount,
      currency: charge.currency,
      paid_at: dayjs().toISOString(),
    })

    return {
      period,
      amountCny,
      remaining: salary.value.buckets.fun_fund_pocket,
    }
  }

  /** 公司退款：退回快乐基金口袋，并冲掉这笔已记花销 */
  function markFunFundChargeReimbursed(paymentId: string) {
    const payment = (salary.value.fun_fund_charge_history ?? []).find(
      (item) => item.id === paymentId,
    )
    if (!payment?.reimburse_due) throw new Error('没有这笔待报销')
    if (payment.reimbursed_at) {
      return {
        amountCny: payment.amount_cny,
        remaining: salary.value.buckets.fun_fund_pocket,
        already: true,
      }
    }

    const amountCny = round(payment.amount_cny, 2)
    if (amountCny <= 0) throw new Error('报销金额无效')

    const record = getRecordByMonth(payment.period)
    salary.value.buckets.fun_fund_pocket = add(salary.value.buckets.fun_fund_pocket, amountCny)
    if (record && !record.fun_fund_carried) {
      record.fun_fund_spent = round(Math.max(0, sub(record.fun_fund_spent ?? 0, amountCny)), 2)
    }
    payment.reimbursed_at = dayjs().toISOString()

    return {
      amountCny,
      remaining: salary.value.buckets.fun_fund_pocket,
      already: false,
    }
  }

  function updateFunFundCharge(chargeId: string, partial: Partial<FunFundRecurringCharge>) {
    const charges = [...(salary.value.settings.fun_fund_charges ?? [])]
    const index = charges.findIndex((item) => item.id === chargeId)
    if (index < 0) {
      charges.push(
        mergeFunFundCharges([{ ...(partial as FunFundRecurringCharge), id: chargeId }])[0]!,
      )
    } else {
      charges[index] = {
        ...charges[index]!,
        ...partial,
        id: chargeId,
      }
    }
    salary.value.settings.fun_fund_charges = mergeFunFundCharges(charges)
  }

  function withdrawEmergency(amount: number) {
    if (amount <= 0) throw new Error('取用金额必须大于 0')
    if (amount > salary.value.buckets.emergency_reserve) {
      throw new Error('应急备用金余额不足')
    }
    salary.value.buckets.emergency_reserve = sub(salary.value.buckets.emergency_reserve, amount)
    syncYulibaoFromBuckets()
    return salary.value.buckets.emergency_reserve
  }

  function releaseObservationToSeed(amount?: number) {
    const available = salary.value.buckets.cash_observation
    const move = amount ?? available
    if (move <= 0) throw new Error('观察仓余额为 0')
    if (move > available) throw new Error('观察仓余额不足')
    if (isPeGuardActive.value) {
      throw new Error('纳指仍高于阈值，请先下调当前 PE 或关闭高估保险丝后再释放')
    }
    salary.value.buckets.cash_observation = sub(salary.value.buckets.cash_observation, move)
    salary.value.buckets.us_seed_parking = add(salary.value.buckets.us_seed_parking, move)
    syncYulibaoFromBuckets()
    return move
  }

  function markUsSeedRemitted(
    prices: Array<{ id: string; market_price: number }>,
    note = '换汇入金，标记已汇出',
  ) {
    const amount = salary.value.buckets.us_seed_parking
    if (amount <= 0) throw new Error('美股种子暂存余额为 0')
    if (!prices.length) {
      throw new Error('汇出前必须更新美股市价')
    }
    for (const row of prices) {
      if (!(row.market_price > 0)) {
        throw new Error('请为全部持仓填写有效市价后再汇出')
      }
    }

    updateStockPrices(prices)

    salary.value.buckets.us_seed_parking = 0
    syncYulibaoFromBuckets()

    const remittedAt = dayjs().toISOString()
    salary.value.last_remit_at = remittedAt
    salary.value.remit_history.unshift({
      id: createId('remit'),
      amount,
      remitted_at: remittedAt,
      note,
      price_snapshot: prices.map((row) => {
        const stock = accounts.value.us_stock_pool.find((s) => s.id === row.id)
        return {
          id: row.id,
          symbol: stock?.symbol ?? row.id,
          market_price: row.market_price,
        }
      }),
      fx_to_hkd: { ...settings.value.fx_to_hkd },
    })

    return amount
  }

  function updateSalarySettings(partial: Partial<SalaryPlanSettings>) {
    salary.value.settings = {
      ...salary.value.settings,
      ...partial,
      ratios: partial.ratios
        ? { ...salary.value.settings.ratios, ...partial.ratios }
        : salary.value.settings.ratios,
    }
    if (partial.safety_pad_target != null) {
      settings.value.rules.safety_cap = partial.safety_pad_target
    }
  }

  function updateSalaryRatios(ratios: SalaryRatios) {
    if (!ratiosAreValid(ratios)) {
      throw new Error('工资分配比例合计必须为 100%')
    }
    salary.value.settings.ratios = { ...ratios }
  }

  function updateCarryoverRule(rule: FunFundCarryoverRule) {
    settings.value.rules.carryover_rule = rule
  }

  return {
    savingsForPeriod,
    currentMonthSavings,
    previewAllocation,
    getRecordByMonth,
    revokeAllocation,
    confirmAllocation,
    previewExtraIncome,
    recordExtraIncome,
    revokeExtraIncome,
    funFundAllocatedForMonth,
    openFunFundPeriod,
    funFundReserve,
    funFundSpendable,
    spendFunFund,
    spendTravelFund,
    setFunFundRemaining,
    carryOverFunFund,
    payFunFundCharge,
    markFunFundChargeReimbursed,
    updateFunFundCharge,
    withdrawEmergency,
    releaseObservationToSeed,
    markUsSeedRemitted,
    updateSalarySettings,
    updateSalaryRatios,
    updateCarryoverRule,
  }
}
