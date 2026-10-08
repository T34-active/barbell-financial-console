import dayjs from 'dayjs'
import type {
  SalaryAllocationLine,
  SalaryAllocationMode,
  SalaryAllocationPreview,
  SalaryLineKey,
  SalaryRatios,
} from '@/types/finance'
import { add, div, mul, round, sub } from '@/utils/decimal'

const LINE_META: Record<SalaryLineKey, { label: string; destination: string; note: string }> = {
  parents: {
    label: '给爸妈',
    destination: '微信转账（爸妈一人一半）',
    note: '家庭责任，也是你的「福报」储蓄，雷打不动。',
  },
  safety_pad: {
    label: '安全垫（硬存）',
    destination: '转入余利宝 · 应急备用金',
    note: '反脆弱的命根子。确保你永远不用在低位卖股票。',
  },
  us_seed: {
    label: '美股种子（攒着）',
    destination: '暂存余利宝（单独记账），每 3 个月汇出一次',
    note: '进攻的长矛。利用时间复利，对抗长期通胀。',
  },
  fun_fund: {
    label: '快乐基金',
    destination: '当月快乐口袋（月末必须结转，不得沉淀）',
    note: '维持人性的润滑剂；Cursor 月费先锁，剩余才可花，禁止装死在现金池。',
  },
  travel_fund: {
    label: '旅游基金',
    destination: '暂存余利宝（单独记账），出行时再花',
    note: '为出行预留的专项额度，先在余利宝吃利息；不计入储蓄率。',
  },
}

const ALLOCATE_ORDER: SalaryLineKey[] = [
  'parents',
  'safety_pad',
  'us_seed',
  'travel_fund',
  'fun_fund',
]

/** 分单位整数分摊，最后一项吃残差，保证合计等于总额 */
export function allocateByRatios(
  total: number,
  orderedKeys: SalaryLineKey[],
  ratios: Record<SalaryLineKey, number>,
): Record<SalaryLineKey, number> {
  const cents = round(mul(total, 100), 0)
  const result = {} as Record<SalaryLineKey, number>
  let allocatedCents = 0

  orderedKeys.forEach((key, index) => {
    if (index === orderedKeys.length - 1) {
      result[key] = div(sub(cents, allocatedCents), 100)
      return
    }
    const share = round(mul(cents, ratios[key]), 0)
    result[key] = div(share, 100)
    allocatedCents = add(allocatedCents, share)
  })

  return result
}

/** 额外收入跳过爸妈：把剩余项按原相对权重归一到 100% */
export function ratiosWithoutParents(ratios: SalaryRatios): SalaryRatios {
  const rest = add(ratios.safety_pad, ratios.us_seed, ratios.fun_fund, ratios.travel_fund ?? 0)
  if (rest <= 0) {
    return {
      parents: 0,
      safety_pad: 0,
      us_seed: 1,
      fun_fund: 0,
      travel_fund: 0,
    }
  }
  return {
    parents: 0,
    safety_pad: div(ratios.safety_pad, rest),
    us_seed: div(ratios.us_seed, rest),
    fun_fund: div(ratios.fun_fund, rest),
    travel_fund: div(ratios.travel_fund ?? 0, rest),
  }
}

export function sumRatios(ratios: SalaryRatios): number {
  return add(
    ratios.parents,
    ratios.safety_pad,
    ratios.us_seed,
    ratios.fun_fund,
    ratios.travel_fund ?? 0,
  )
}

export function ratiosAreValid(ratios: SalaryRatios, epsilon = 1e-6): boolean {
  return Math.abs(sub(sumRatios(ratios), 1)) <= epsilon
}

export function resolveAllocationMode(
  emergencyReserve: number,
  safetyPadTarget: number,
): SalaryAllocationMode {
  return emergencyReserve >= safetyPadTarget ? 'divert_to_seed' : 'refill_safety'
}

export function buildSalaryAllocation(input: {
  salary: number
  ratios: SalaryRatios
  emergencyReserve: number
  safetyPadTarget: number
  peGuardEnabled?: boolean
  nasdaqPeCurrent?: number
  nasdaqPeThreshold?: number
  /** 快乐基金须先锁住的订阅额度（CNY） */
  funFundReserveCny?: number
}): SalaryAllocationPreview {
  const {
    salary,
    ratios,
    emergencyReserve,
    safetyPadTarget,
    peGuardEnabled = false,
    nasdaqPeCurrent = 0,
    nasdaqPeThreshold = 30,
    funFundReserveCny = 0,
  } = input

  const mode = resolveAllocationMode(emergencyReserve, safetyPadTarget)
  const isSafetyPadFull = mode === 'divert_to_seed'
  const peGuardActive = peGuardEnabled && nasdaqPeCurrent > nasdaqPeThreshold

  const travelRatio = ratios.travel_fund ?? 0
  const effectiveRatios: Record<SalaryLineKey, number> = isSafetyPadFull
    ? {
        parents: ratios.parents,
        safety_pad: 0,
        us_seed: add(ratios.us_seed, ratios.safety_pad),
        fun_fund: ratios.fun_fund,
        travel_fund: travelRatio,
      }
    : {
        parents: ratios.parents,
        safety_pad: ratios.safety_pad,
        us_seed: ratios.us_seed,
        fun_fund: ratios.fun_fund,
        travel_fund: travelRatio,
      }

  const amounts = allocateByRatios(Math.max(0, salary), ALLOCATE_ORDER, effectiveRatios)

  const observationAmount = peGuardActive ? amounts.us_seed : 0
  const usSeedParkingAmount = peGuardActive ? 0 : amounts.us_seed

  // 给爸妈：金额列仍记比例总额（保证各项合计=工资）；一人一半拆成两笔转账
  const parentsSplit = splitParentsHalf(amounts.parents)
  const fmt = (n: number) =>
    n.toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })

  const lines: SalaryAllocationLine[] = [
    {
      key: 'parents',
      label: LINE_META.parents.label,
      destination: LINE_META.parents.destination,
      note: `一人一半：${fmt(parentsSplit[0])} + ${fmt(parentsSplit[1])}。${LINE_META.parents.note}`,
      ratio: ratios.parents,
      amount: amounts.parents,
      split_amounts: parentsSplit,
    },
    {
      key: 'safety_pad',
      label: LINE_META.safety_pad.label,
      destination: isSafetyPadFull
        ? peGuardActive
          ? '并入进攻份额 → 因高估转入现金观察仓'
          : '并入美股种子（暂存余利宝）'
        : LINE_META.safety_pad.destination,
      note: isSafetyPadFull
        ? `应急备用金已达 ${safetyPadTarget.toLocaleString('zh-CN')} 元，本月安全垫份额并入进攻份额。`
        : LINE_META.safety_pad.note,
      ratio: isSafetyPadFull ? 0 : ratios.safety_pad,
      amount: amounts.safety_pad,
      diverted: isSafetyPadFull,
    },
    {
      key: 'us_seed',
      label: LINE_META.us_seed.label,
      destination: peGuardActive
        ? '现金观察仓（余利宝，待 PE 回落再释放）'
        : LINE_META.us_seed.destination,
      note: peGuardActive
        ? `纳指 PE ${nasdaqPeCurrent} > 阈值 ${nasdaqPeThreshold}，进攻份额暂扣观察仓，避免高位梭哈。`
        : isSafetyPadFull
          ? `${LINE_META.us_seed.note}（含安全垫并入的 ${round(mul(ratios.safety_pad, 100), 0).toFixed(0)}%）`
          : LINE_META.us_seed.note,
      ratio: effectiveRatios.us_seed,
      amount: amounts.us_seed,
      parked_observation: peGuardActive,
    },
    {
      key: 'fun_fund',
      ...LINE_META.fun_fund,
      destination:
        funFundReserveCny > 0
          ? `当月快乐口袋 · 先锁 Cursor ${fmt(funFundReserveCny)}`
          : LINE_META.fun_fund.destination,
      note:
        funFundReserveCny > 0
          ? `先锁 Cursor 月费 ${fmt(funFundReserveCny)}，剩余才可花；这笔禁止结转走。${LINE_META.fun_fund.note}`
          : LINE_META.fun_fund.note,
      ratio: ratios.fun_fund,
      amount: amounts.fun_fund,
      reserved_amount: funFundReserveCny > 0 ? funFundReserveCny : undefined,
    },
    {
      key: 'travel_fund',
      ...LINE_META.travel_fund,
      ratio: travelRatio,
      amount: amounts.travel_fund,
    },
  ]

  const totalAllocated = lines.reduce((sum, line) => add(sum, line.amount), 0)
  const saved = add(amounts.safety_pad, usSeedParkingAmount, observationAmount)
  const projectedSavingsRate = salary > 0 ? div(saved, salary) : 0

  return {
    salary,
    mode,
    isSafetyPadFull,
    peGuardActive,
    emergencyReserve,
    safetyPadTarget,
    lines,
    observationAmount,
    usSeedParkingAmount,
    totalAllocated,
    projectedSavingsRate,
  }
}

export function currentYearMonth(date = dayjs().toDate()): string {
  return dayjs(date).format('YYYY-MM')
}

/** 按月偏移 YYYY-MM，delta 可为负 */
export function shiftYearMonth(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split('-').map(Number)
  return dayjs('2000-01-01')
    .year(y)
    .month(m - 1)
    .date(1)
    .add(delta, 'month')
    .format('YYYY-MM')
}

export function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/** 50/50 分摊，奇数分归进攻端 */
export function splitHalf(amount: number): { toSafety: number; toSeed: number } {
  const cents = round(mul(amount, 100), 0)
  const half = Math.floor(div(cents, 2))
  const toSafety = div(half, 100)
  const toSeed = div(sub(cents, half), 100)
  return { toSafety, toSeed }
}

/** 给爸妈一人一半；奇数分归第二笔，保证两笔合计等于总额 */
export function splitParentsHalf(gross: number): [number, number] {
  const cents = round(mul(Math.max(0, gross), 100), 0)
  const first = Math.floor(div(cents, 2))
  return [div(first, 100), div(sub(cents, first), 100)]
}
