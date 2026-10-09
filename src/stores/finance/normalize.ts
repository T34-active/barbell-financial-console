import dayjs from 'dayjs'
import { toRaw } from 'vue'
import { seedFinanceState } from '@/data/seed'
import type {
  AccountsState,
  AppSettings,
  CryptoOpsState,
  FinanceState,
  LoanFundSource,
  LoanRecord,
  LoanStatus,
  LoansState,
  SalaryState,
  YuanGouOutcome,
  YuanGouRecord,
  YuanGouState,
} from '@/types/finance'
import { createId } from '@/utils/salary-allocation'
import { add, div, mul, round, sub } from '@/utils/decimal'
import { isNavFundAccount } from '@/utils/fund-nav'
import { mergeFunFundCharges } from '@/utils/fun-fund-charge'

/** 深拷贝纯数据；兼容 Vue Proxy（structuredClone 无法克隆 Proxy） */
export function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(toRaw(value as object))) as T
}

export function cloneSeed(): FinanceState {
  return clonePlain(seedFinanceState)
}

export function normalizeSettings(raw: AppSettings | undefined): AppSettings {
  const seed = cloneSeed().settings
  if (!raw) return seed
  let neutral = [
    ...(raw.asset_classification?.neutral_assets ?? seed.asset_classification.neutral_assets),
  ]
  // 旧数据把 HTX 放在 neutral：迁到 crypto_assets
  neutral = neutral.filter((id) => id !== 'htx_earn_usdt' && id !== 'okx_earn_usdt')
  // gold_etf 是否留在中性端，由 alignNeutralFundClassification 按账户是否存在决定

  const cryptoAssets = [
    ...(raw.asset_classification?.crypto_assets ?? seed.asset_classification.crypto_assets),
  ]

  const safeAssets = [
    ...(raw.asset_classification?.safe_assets ?? seed.asset_classification.safe_assets),
  ]

  return {
    ...seed,
    ...raw,
    fx_to_hkd: {
      ...seed.fx_to_hkd,
      ...raw.fx_to_hkd,
      USDT: raw.fx_to_hkd?.USDT ?? raw.fx_to_hkd?.USD ?? seed.fx_to_hkd.USDT,
    },
    asset_classification: {
      ...seed.asset_classification,
      ...raw.asset_classification,
      safe_assets: safeAssets,
      offensive_assets:
        raw.asset_classification?.offensive_assets ?? seed.asset_classification.offensive_assets,
      neutral_assets: neutral,
      crypto_assets: cryptoAssets,
    },
    rules: { ...seed.rules, ...raw.rules },
    fx_live: raw.fx_live ?? seed.fx_live ?? null,
  }
}

/** 已保存的池按用户数据保留；种子账户被删掉后刷新不再补回。缺字段才用种子。 */
function savedPoolOrSeed<T>(saved: T[] | undefined, seed: T[]): T[] {
  return Array.isArray(saved) ? clonePlain(saved) : clonePlain(seed)
}

export function normalizeAccounts(raw: AccountsState | undefined): AccountsState {
  const seed = cloneSeed().accounts
  if (!raw) return seed
  const crypto = savedPoolOrSeed(raw.crypto_pool, seed.crypto_pool)
  const hkd = savedPoolOrSeed(raw.hkd_pool, seed.hkd_pool)
  const zabank = hkd.find((item) => item.id === 'zabank')
  if (zabank && zabank.yield_rate == null) {
    zabank.yield_rate = 0.003
  }

  const rmb = clonePlain(raw.rmb_pool ?? seed.rmb_pool)
  const yulibao = rmb.find((item) => item.id === 'yulibao')
  if (yulibao) {
    // 旧种子 1.8% 已脱离当前日开理财水位，迁移到 1.5% 参考年化
    if (yulibao.yield_rate == null || Math.abs(yulibao.yield_rate - 0.018) < 1e-9) {
      yulibao.yield_rate = 0.015
    }
  }
  for (const fund of rmb) {
    if (!isNavFundAccount(fund)) continue
    if (!(fund.shares! > 0) || !(fund.cost_amount! > 0)) {
      const lots = fund.fund_lots ?? []
      fund.shares = round(
        lots.reduce((sum, lot) => add(sum, lot.shares), 0),
        4,
      )
      fund.cost_amount = round(
        lots.reduce((sum, lot) => add(sum, lot.amount), 0),
        2,
      )
    }
    const nav = fund.nav
    const shares = fund.shares
    const costAmount = fund.cost_amount
    if (nav != null && nav > 0 && shares != null && shares > 0) {
      fund.amount = round(mul(shares, nav), 2)
      if (costAmount != null && costAmount > 0) {
        fund.profit_rate = round(div(sub(fund.amount, costAmount), costAmount), 4)
      }
    }
  }

  return {
    rmb_pool: rmb,
    hkd_pool: hkd,
    us_stock_pool: raw.us_stock_pool ?? seed.us_stock_pool,
    crypto_pool: crypto,
  }
}

const SEEDED_HKD_IDS = new Set(['hsbc', 'zabank', 'boc', 'starryblu'])
const SEEDED_CRYPTO_IDS = new Set(['htx_earn_usdt', 'okx_earn_usdt'])

/** 种子账户还在池里才留在分类名单；用户删掉的不再补回 */
function alignSeededClassIds(list: string[], seededIds: Set<string>, aliveIds: Set<string>) {
  const next = list.filter((id) => !seededIds.has(id) || aliveIds.has(id))
  for (const id of seededIds) {
    if (aliveIds.has(id) && !next.includes(id)) next.push(id)
  }
  return next
}

export function alignPoolClassification(settings: AppSettings, accounts: AccountsState) {
  const hkdIds = new Set(accounts.hkd_pool.map((item) => item.id))
  const cryptoIds = new Set(accounts.crypto_pool.map((item) => item.id))
  settings.asset_classification.safe_assets = alignSeededClassIds(
    settings.asset_classification.safe_assets,
    SEEDED_HKD_IDS,
    hkdIds,
  )
  settings.asset_classification.crypto_assets = alignSeededClassIds(
    settings.asset_classification.crypto_assets ?? [],
    SEEDED_CRYPTO_IDS,
    cryptoIds,
  )
}

/** 净值基金只进中性端；黄金账户已删除时不再把 gold_etf 补回去 */
export function alignNeutralFundClassification(settings: AppSettings, accounts: AccountsState) {
  const fundIds = accounts.rmb_pool.filter((item) => isNavFundAccount(item)).map((item) => item.id)
  const fundSet = new Set(fundIds)
  const neutral = settings.asset_classification.neutral_assets.filter(
    (id) => id !== 'gold_etf' || fundSet.has('gold_etf'),
  )
  for (const id of fundIds) {
    if (!neutral.includes(id)) neutral.push(id)
  }
  settings.asset_classification.neutral_assets = neutral
  settings.asset_classification.safe_assets = settings.asset_classification.safe_assets.filter(
    (id) => !fundSet.has(id),
  )
}

export function yuanGouOutcomeOf(item: YuanGouRecord): YuanGouOutcome {
  if (!item.participated || item.cost_cny <= 0) return 'none'
  return 'hit'
}

export function yuanGouNoteFor(
  outcome: YuanGouOutcome,
  costCny: number,
  rewardUsdt: number,
  isBackfill = false,
) {
  const base = outcome === 'none' ? '未购买' : `支付宝 ¥${costCny} → +${rewardUsdt}U`
  return isBackfill ? `${base}（补录）` : base
}

export function normalizeYuanGouRecord(
  item: YuanGouRecord & Record<string, unknown>,
): YuanGouRecord {
  const legacyCost = Number(item.cost_usdt ?? 0)
  const legacyWon = Boolean(item.won)
  const legacyWin = Number(item.win_amount_usdt ?? 0)
  const noteRaw = String(item.note ?? '')
  const noteSaysNone =
    /没有购买|未购买|^没有$|没有（|当天没买/.test(noteRaw) &&
    !/抢到|中奖|→\s*\+?\d|->\s*\+?\d/.test(noteRaw)
  const noteSaysHit = /中奖|抢到额度|抢到\s*\d|→\s*\+?\d|->\s*\+?\d|支付宝/.test(noteRaw)

  let costCny = Number(item.cost_cny ?? (legacyCost <= 0 && !legacyWon ? 0 : 1))
  let gotUsdt = Number(
    item.got_usdt ?? (legacyWin > 0 ? legacyWin : item.got_quota || legacyWon ? 1 : 0),
  )

  // 仅两态：有花费或到账 / 备注像买过 → 买了；否则未购买
  let participated =
    typeof item.participated === 'boolean'
      ? item.participated
      : noteSaysNone
        ? false
        : costCny > 0 || gotUsdt > 0 || noteSaysHit || Boolean(item.got_quota)

  if (noteSaysNone && gotUsdt <= 0 && !noteSaysHit) {
    participated = false
  }
  // 旧「未抢到」已废弃：若曾扣过钱或有到账，仍算买了
  if (!participated && (gotUsdt > 0 || (costCny > 0 && noteSaysHit))) {
    participated = true
  }

  if (!participated) {
    costCny = 0
    gotUsdt = 0
  } else {
    costCny = costCny > 0 ? costCny : 1
    gotUsdt = gotUsdt > 0 ? gotUsdt : 1
  }

  const outcome: YuanGouOutcome = participated ? 'hit' : 'none'
  const looksLegacy =
    !noteRaw || /中奖|未中|没有购买|未购买|抢到额度|未抢到|没有|去抢但/.test(noteRaw)
  const note = looksLegacy
    ? yuanGouNoteFor(outcome, costCny || 1, gotUsdt || 1, /补录/.test(noteRaw))
    : noteRaw

  return {
    id: item.id,
    date: item.date,
    cost_cny: costCny,
    participated,
    got_quota: participated,
    got_usdt: round(gotUsdt, 2),
    funded_from: participated ? 'alipay' : 'none',
    note,
    created_at: item.created_at,
  }
}

export function normalizeYuanGou(raw: YuanGouState | undefined): YuanGouState {
  const seed = cloneSeed().yuan_gou
  if (!raw) return seed
  const dailyCostCny = raw.daily_cost_cny ?? raw.daily_cost_usdt ?? seed.daily_cost_cny
  return {
    daily_cost_cny: dailyCostCny,
    reward_usdt: raw.reward_usdt ?? seed.reward_usdt,
    daily_cost_usdt: raw.daily_cost_usdt ?? dailyCostCny,
    history: (raw.history ?? []).map((item) =>
      normalizeYuanGouRecord(item as YuanGouRecord & Record<string, unknown>),
    ),
    applied_fixes: raw.applied_fixes ?? [],
  }
}

export function normalizeCryptoOps(raw: CryptoOpsState | undefined): CryptoOpsState {
  const seed = cloneSeed().crypto_ops
  if (!raw) return seed
  return { overflow_log: raw.overflow_log ?? [] }
}

export function resolveLoanStatus(remaining: number, amount: number): LoanStatus {
  if (remaining <= 0) return 'repaid'
  if (remaining < amount) return 'partial'
  return 'open'
}

export function normalizeLoanRecord(item: LoanRecord & Record<string, unknown>): LoanRecord {
  const amount = round(Number(item.amount) || 0, 2)
  const remaining = round(Math.max(0, Number(item.remaining ?? amount) || 0), 2)
  const fundedFrom: LoanFundSource = item.funded_from === 'cash_rmb' ? 'cash_rmb' : 'yulibao'
  const statusRaw = item.status
  const status: LoanStatus =
    statusRaw === 'written_off' ||
    statusRaw === 'repaid' ||
    statusRaw === 'partial' ||
    statusRaw === 'open'
      ? statusRaw
      : resolveLoanStatus(remaining, amount)

  return {
    id: String(item.id || createId('loan')),
    direction: 'lend_out',
    counterparty: String(item.counterparty || '').trim() || '未命名',
    amount,
    remaining,
    currency: 'CNY',
    lent_at: String(item.lent_at || todayDateKey()),
    due_at: String(item.due_at || ''),
    funded_from: fundedFrom,
    note: String(item.note || ''),
    status,
    repayments: Array.isArray(item.repayments)
      ? item.repayments.map((row) => {
          const r = row as unknown as Record<string, unknown>
          return {
            id: String(r.id || createId('repay')),
            amount: round(Number(r.amount) || 0, 2),
            repaid_at: String(r.repaid_at || ''),
            to_account: r.to_account === 'cash_rmb' ? 'cash_rmb' : ('yulibao' as const),
            note: r.note ? String(r.note) : undefined,
          }
        })
      : [],
    created_at: String(item.created_at || dayjs().toISOString()),
    written_off_at: item.written_off_at ? String(item.written_off_at) : undefined,
  }
}

export function normalizeLoans(raw: LoansState | undefined): LoansState {
  const seed = cloneSeed().loans
  if (!raw) return seed
  return {
    items: (raw.items ?? []).map((item) =>
      normalizeLoanRecord(item as LoanRecord & Record<string, unknown>),
    ),
  }
}

export function todayDateKey(date = dayjs().toDate()): string {
  return dayjs(date).format('YYYY-MM-DD')
}

export function normalizeSalary(raw: SalaryState | undefined, yulibaoAmount: number): SalaryState {
  const seed = cloneSeed().salary
  if (!raw) {
    return {
      ...seed,
      buckets: {
        emergency_reserve: yulibaoAmount,
        us_seed_parking: 0,
        cash_observation: 0,
        fun_fund_pocket: 0,
        travel_fund_pocket: 0,
      },
    }
  }

  const emergency = raw.buckets?.emergency_reserve
  const parking = raw.buckets?.us_seed_parking ?? 0
  const observation = raw.buckets?.cash_observation ?? 0
  const funPocket = raw.buckets?.fun_fund_pocket ?? 0
  const travelPocket = raw.buckets?.travel_fund_pocket ?? 0

  return {
    settings: {
      ...seed.settings,
      ...raw.settings,
      ratios: {
        ...seed.settings.ratios,
        ...raw.settings?.ratios,
        travel_fund: raw.settings?.ratios?.travel_fund ?? seed.settings.ratios.travel_fund,
      },
      safety_pad_target: raw.settings?.safety_pad_target ?? seed.settings.safety_pad_target,
      fun_fund_charges: mergeFunFundCharges(raw.settings?.fun_fund_charges),
    },
    buckets: {
      emergency_reserve: emergency ?? Math.max(0, sub(sub(yulibaoAmount, parking), observation)),
      us_seed_parking: parking,
      cash_observation: observation,
      fun_fund_pocket: funPocket,
      travel_fund_pocket: travelPocket,
    },
    history: (raw.history ?? []).map((item) => ({
      ...item,
      pe_guard_active: item.pe_guard_active ?? false,
      observation_amount: item.observation_amount ?? 0,
      fun_fund_spent: item.fun_fund_spent ?? 0,
      fun_fund_carried: item.fun_fund_carried ?? false,
    })),
    extra_income_history: raw.extra_income_history ?? [],
    remit_history: raw.remit_history ?? [],
    carryover_history: raw.carryover_history ?? [],
    fun_fund_charge_history: (raw.fun_fund_charge_history ?? []).map((item) => {
      const due = String(item.reimburse_due || '')
      const note = String(item.reimburse_note || '').trim()
      const reimbursedAt = String(item.reimbursed_at || '')
      return {
        id: String(item.id || createId('ffc')),
        charge_id: String(item.charge_id || ''),
        period: String(item.period || ''),
        amount_cny: Number(item.amount_cny ?? item.amount ?? 0),
        amount: Number(item.amount ?? 0),
        currency: item.currency || 'USD',
        paid_at: String(item.paid_at || dayjs().toISOString()),
        ...(/^\d{4}-\d{2}-\d{2}$/.test(due) ? { reimburse_due: due } : {}),
        ...(note ? { reimburse_note: note } : {}),
        ...(reimbursedAt ? { reimbursed_at: reimbursedAt } : {}),
      }
    }),
    last_remit_at: raw.last_remit_at ?? null,
  }
}
