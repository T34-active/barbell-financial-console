/** 计价币种（USDT 按与 USD 近似锚定计价） */
export type BaseCurrency = 'HKD' | 'CNY' | 'USD' | 'USDT' | 'SGD'

/** 账户资产类型 */
export type AccountAssetType = 'cash' | 'gold' | 'bank' | 'crypto_earn' | 'fund'

/** 公募基金加仓明细（confirm_date = 净值日） */
export interface FundLot {
  id: string
  /** 净值日 YYYY-MM-DD（15:00 切日后的成交净值所属日） */
  confirm_date: string
  /** 投入金额（本币） */
  amount: number
  /** 确认净值；在途为 0 */
  confirm_nav: number
  /** 确认份额；在途为 0 */
  shares: number
  note?: string
  /** 申购时间 ISO */
  apply_at?: string
  /** 净值未公布，待刷新后确认份额 */
  pending?: boolean
}

/** 黄金/基金按净值日冻结的当日盈亏 */
export interface FundDailyPnl {
  /** 净值日 YYYY-MM-DD */
  date: string
  nav: number
  prev_nav: number
  /** 当日参与计算的份额 */
  shares: number
  /** 当日盈亏（本币） */
  pnl: number
  /** 日涨跌幅（小数） */
  day_change: number
}

/** 人民币/港币/加密池账户 */
export interface PoolAccount {
  id: string
  name: string
  type: AccountAssetType
  amount: number
  currency: BaseCurrency
  yield_rate?: number
  profit_rate?: number
  /** 公募基金代码（如 002611），用于拉净值算浮盈 */
  fund_code?: string
  /** 持有份额 */
  shares?: number
  /** 投入成本（本币） */
  cost_amount?: number
  /** 最新单位净值 */
  nav?: number
  /** 净值对应日期 YYYY-MM-DD 或更新时间 ISO */
  nav_updated_at?: string
  /** 上一交易日单位净值 */
  prev_nav?: number
  /** 日涨跌幅（小数，如 0.021 = +2.1%） */
  nav_day_change?: number
  /** 按净值日累计的当日盈亏（已记录日冻结，不随之后买卖改写） */
  daily_pnl?: FundDailyPnl[]
  /** 加仓明细 */
  fund_lots?: FundLot[]
  /** 是否为汇丰安全红线账户 */
  is_safety_line?: boolean
  /** 备注（如交易所、产品名） */
  note?: string
  /** 余额上次手工修改时间（ISO） */
  amount_updated_at?: string
}

/** 美股持仓 */
export interface UsStockHolding {
  id: string
  symbol: string
  name: string
  shares: number
  cost_price: number
  currency: 'USD'
  /** 预估/最新股息率（小数，如 0.031 = 3.1%）；可由行情拉取 TTM */
  est_div_yield?: number
  /** 股息率上次更新时间 */
  div_yield_updated_at?: string
  /** 最新市价，缺省时用成本价估算 */
  market_price?: number
  /** 市价上次更新时间 */
  price_updated_at?: string
}

/** 资产分类：决定哑铃三端归属 */
export interface AssetClassification {
  safe_assets: string[]
  offensive_assets: string[]
  /** 中性另类（如黄金）——非安全、非美股进攻 */
  neutral_assets: string[]
  /** 加密赌注池（投机级）——严禁混入安全端/美股进取端 */
  crypto_assets: string[]
}

/** 快乐基金结转规则 */
export type FunFundCarryoverRule = 'split_50_50' | 'surplus_happy_fund_to_offensive'

export interface FinanceRules {
  /** 安全垫目标（CNY） */
  safety_cap: number
  /** 快乐基金剩余结转去向 */
  carryover_rule: FunFundCarryoverRule
  /** 是否启用纳指高估保险丝 */
  pe_guard_enabled: boolean
  /** 纳指 PE 高估阈值 */
  nasdaq_pe_threshold: number
  /** 当前纳指 PE（蛋卷基金估值，可手改） */
  nasdaq_pe_current: number
  /** 上次拉取 PE 的时间 ISO */
  nasdaq_pe_updated_at?: string
  /** 估值数据日期（蛋卷返回） */
  nasdaq_pe_as_of?: string
  /** 纳指估值平均中枢（参考 PE，可手改） */
  avg_pivot: number
  /** CNN 恐贪指数 0–100（可手改） */
  fear_greed_index: number
  /** 恐贪文案（extreme fear / fear / …） */
  fear_greed_rating?: string
  /** 上次拉取恐贪指数时间 ISO */
  fear_greed_updated_at?: string
  /** 名义发薪日（每月几号，默认 10） */
  payday_day: number
  /** 发薪日落在周末时是否顺延到下周一 */
  payday_postpone_weekend: boolean
  /** HTX 高息阈值：余额 < 该值享高息，>= 则降息 */
  htx_high_yield_threshold: number
  /** HTX 高息年化（默认 10%） */
  htx_high_yield_rate: number
  /** HTX 降息后年化（默认 1.5%） */
  htx_low_yield_rate: number
  /** 溢流转存后 HTX 目标余额（默认 199） */
  htx_target_balance: number
  /** 溢出量低于此值不转（覆盖约 1U Gas，默认 2） */
  htx_overflow_min_transfer: number
  /** OKX 活期年化（默认 2.24%） */
  okx_yield_rate: number
}

/** 实时汇率报价（USD/CNH、CNY/HKD、SGD/HKD） */
export interface LiveFxSnapshot {
  usd_cnh: number
  cny_hkd: number
  usd_hkd: number
  /** 1 SGD = ? HKD；旧快照可能没有 */
  sgd_hkd?: number
  fetched_at: string
  as_of: string
  source: string
}

export interface AppSettings {
  base_currency: BaseCurrency
  /** 汇丰银行红线预警值（HKD） */
  hsbc_safety_line: number
  /** 相对 HKD 的汇率：1 unit = x HKD */
  fx_to_hkd: Record<BaseCurrency, number>
  /** 最近一次实时汇率快照 */
  fx_live?: LiveFxSnapshot | null
  asset_classification: AssetClassification
  rules: FinanceRules
}

export interface AccountsState {
  rmb_pool: PoolAccount[]
  hkd_pool: PoolAccount[]
  us_stock_pool: UsStockHolding[]
  /** 加密/交易所资产（默认归中性） */
  crypto_pool: PoolAccount[]
}

/** 一元购当日结果：买了（¥1→1U）/ 未购买 */
export type YuanGouOutcome = 'hit' | 'none'

/** 火币一元购单日记录：支付宝 ¥1 买 1U 额度 */
export interface YuanGouRecord {
  id: string
  date: string
  /** 当日花费人民币；买了默认 ¥1，未购买为 0 */
  cost_cny: number
  /** 是否当天购买（false = 未购买，不计花费） */
  participated: boolean
  /** 是否买到额度（与 participated 同步：买了即 true） */
  got_quota: boolean
  /** 买到时到账 USDT（默认 1；未购买为 0） */
  got_usdt: number
  /** 扣款来源：支付宝外付；未购买为 none */
  funded_from: 'alipay' | 'fun_fund' | 'htx_earn' | 'cash_rmb' | 'none'
  note: string
  created_at: string
  /** @deprecated 旧字段，hydrate 时迁移 */
  cost_usdt?: number
  /** @deprecated 旧「中奖」字段 */
  won?: boolean
  /** @deprecated */
  win_amount_usdt?: number
}

export interface YuanGouState {
  /** 每日参与花费（CNY），默认 1 */
  daily_cost_cny: number
  /** 抢到额度时获得的 USDT，默认 1 */
  reward_usdt: number
  /** @deprecated 兼容旧 LocalStorage */
  daily_cost_usdt?: number
  history: YuanGouRecord[]
  /** 已应用的一次性数据修正（如补录纠错） */
  applied_fixes?: string[]
}

/** HTX → OKX 溢流转存日志 */
export interface CryptoOverflowRecord {
  id: string
  from: 'htx_earn_usdt'
  to: 'okx_earn_usdt'
  amount: number
  htx_before: number
  htx_after: number
  okx_after: number
  executed: boolean
  reason: string
  created_at: string
}

export interface CryptoOpsState {
  overflow_log: CryptoOverflowRecord[]
}

/** 借出资金来源（人民币安全池） */
export type LoanFundSource = 'yulibao' | 'cash_rmb'

/** 借出状态 */
export type LoanStatus = 'open' | 'partial' | 'repaid' | 'written_off'

/** 还款记录 */
export interface LoanRepayment {
  id: string
  amount: number
  repaid_at: string
  to_account: LoanFundSource
  note?: string
}

/** 借出 / 应收记录（别人欠我） */
export interface LoanRecord {
  id: string
  direction: 'lend_out'
  counterparty: string
  amount: number
  remaining: number
  currency: 'CNY'
  lent_at: string
  due_at: string
  funded_from: LoanFundSource
  note: string
  status: LoanStatus
  repayments: LoanRepayment[]
  created_at: string
  written_off_at?: string
}

export interface LoansState {
  items: LoanRecord[]
}

/** 工资分配比例键 */
export type SalaryLineKey = 'parents' | 'safety_pad' | 'us_seed' | 'fun_fund' | 'travel_fund'

/** 分配模式：补安全垫 / 安全垫份额并入美股种子 */
export type SalaryAllocationMode = 'refill_safety' | 'divert_to_seed'

export interface SalaryRatios {
  parents: number
  safety_pad: number
  us_seed: number
  fun_fund: number
  /** 旅游专项：暂存余利宝吃利息；默认 0，不计入储蓄率 */
  travel_fund: number
}

/** 快乐基金按月硬预留（如 Cursor Pro 60 USD） */
export interface FunFundRecurringCharge {
  id: string
  label: string
  amount: number
  currency: BaseCurrency
  /** 每月扣款日（1–28） */
  billing_day: number
  enabled: boolean
}

/** 已从快乐基金扣除的订阅账期 */
export interface FunFundChargePayment {
  id: string
  charge_id: string
  /** 账单所属账期 YYYY-MM */
  period: string
  /** 实扣人民币 */
  amount_cny: number
  amount: number
  currency: BaseCurrency
  paid_at: string
  /** 可向公司报销的日期 YYYY-MM-DD */
  reimburse_due?: string
  /** 报销说明 */
  reimburse_note?: string
  /** 公司已退款的时间；同时把实扣金额退回快乐基金并冲掉花销 */
  reimbursed_at?: string
}

export interface SalaryPlanSettings {
  currency: 'CNY'
  ratios: SalaryRatios
  /** 应急备用金目标（CNY），与 rules.safety_cap 同步 */
  safety_pad_target: number
  /** 美股种子汇出周期（月） */
  us_seed_remit_months: number
  /** 快乐基金按月硬预留，先锁再花 */
  fun_fund_charges: FunFundRecurringCharge[]
}

/** 余利宝分桶：总额应等于 yulibao.amount */
export interface YulibaoBuckets {
  /** 应急备用金（安全垫） */
  emergency_reserve: number
  /** 美股种子暂存（待汇出） */
  us_seed_parking: number
  /** 现金观察仓：高估时暂扣的进攻份额，仍在余利宝 */
  cash_observation: number
  /** 快乐基金当月余量（不计入安全端净资产，不进余利宝） */
  fun_fund_pocket: number
  /** 旅游基金：暂存余利宝吃利息，出行时再花；不计入储蓄率 */
  travel_fund_pocket: number
}

export interface SalaryAllocationLine {
  key: SalaryLineKey
  label: string
  ratio: number
  amount: number
  destination: string
  note: string
  /** divert 模式下安全垫份额是否并入美股种子 */
  diverted?: boolean
  /** PE 高估时美股种子是否转入观察仓 */
  parked_observation?: boolean
  /** 给爸妈：一人一半两笔（合计等于 amount，奇数分归第二笔） */
  split_amounts?: [number, number]
  /** 快乐基金中须先锁住的订阅额度（CNY） */
  reserved_amount?: number
}

export interface SalaryAllocationRecord {
  id: string
  year_month: string
  salary: number
  mode: SalaryAllocationMode
  pe_guard_active: boolean
  lines: SalaryAllocationLine[]
  /** 实际进入观察仓的金额（从 us_seed 划出） */
  observation_amount: number
  fun_fund_spent: number
  fun_fund_carried: boolean
  created_at: string
}

export type ExtraIncomeMode =
  'salary_split' | 'skip_parents' | 'to_safety' | 'to_seed' | 'to_fun' | 'to_travel' | 'to_cash'

export interface ExtraIncomeRecord {
  id: string
  year_month: string
  amount: number
  note: string
  mode: ExtraIncomeMode
  /** 按比例拆分时的明细 */
  lines?: SalaryAllocationLine[]
  observation_amount?: number
  created_at: string
}

export interface FunFundCarryoverRecord {
  id: string
  year_month: string
  amount: number
  rule: FunFundCarryoverRule
  to_safety: number
  to_seed: number
  created_at: string
}

export interface UsSeedRemitRecord {
  id: string
  amount: number
  remitted_at: string
  note: string
  /** 汇出时强制刷新的市价快照 */
  price_snapshot: Array<{
    id: string
    symbol: string
    market_price: number
  }>
  fx_to_hkd: Record<BaseCurrency, number>
}

export interface SalaryState {
  settings: SalaryPlanSettings
  buckets: YulibaoBuckets
  history: SalaryAllocationRecord[]
  extra_income_history: ExtraIncomeRecord[]
  remit_history: UsSeedRemitRecord[]
  carryover_history: FunFundCarryoverRecord[]
  /** 快乐基金订阅实扣记录 */
  fun_fund_charge_history: FunFundChargePayment[]
  /** 上次标记汇出时间 ISO */
  last_remit_at: string | null
}

/** 应用根数据 Schema */
export interface FinanceState {
  settings: AppSettings
  accounts: AccountsState
  salary: SalaryState
  yuan_gou: YuanGouState
  crypto_ops: CryptoOpsState
  loans: LoansState
}

export type PoolKey = keyof AccountsState

export type BarbellSleeve = 'safe' | 'neutral' | 'risk'

/** 哑铃饼图外环细分项 */
export interface BarbellPart {
  sleeve: BarbellSleeve
  id: string
  name: string
  value: number
}

export interface BarbellBreakdown {
  /** 安全端：现金 / 银行 / 应急金 / 观察仓 */
  safeValue: number
  /** 进取端：美股 + 美股种子暂存 */
  riskValue: number
  /** 中性/另类：黄金等 */
  neutralValue: number
  totalValue: number
  safeRatio: number
  riskRatio: number
  neutralRatio: number
  /** 三端内部明细（用于饼图外环） */
  parts: BarbellPart[]
}

/** 预估年化收益分项（金额均为基准币种） */
export interface EstimatedYieldLine {
  id: string
  name: string
  /** cash=余额×利率；dividend=市值×股息率 */
  kind: 'cash' | 'dividend'
  principal: number
  rate: number
  amount: number
}

export interface EstimatedAnnualIncomeBreakdown {
  total: number
  cashYield: number
  hkdYield: number
  cryptoYield: number
  dividend: number
  lines: EstimatedYieldLine[]
}

export interface SalaryAllocationPreview {
  salary: number
  mode: SalaryAllocationMode
  isSafetyPadFull: boolean
  peGuardActive: boolean
  emergencyReserve: number
  safetyPadTarget: number
  lines: SalaryAllocationLine[]
  /** 将进入观察仓而非美股种子的金额 */
  observationAmount: number
  /** 实际进入美股种子暂存的金额 */
  usSeedParkingAmount: number
  totalAllocated: number
  /** 本月预期储蓄率（安全垫+种子+观察仓）/工资 */
  projectedSavingsRate: number
}

export interface MonthlySavingsStat {
  year_month: string
  salary: number
  extra: number
  saved: number
  rate: number
}
