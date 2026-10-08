import type { FinanceState } from '@/types/finance'

/** 初始本地状态 / Schema 种子数据 */
export const seedFinanceState: FinanceState = {
  settings: {
    base_currency: 'HKD',
    hsbc_safety_line: 10000,
    fx_to_hkd: {
      HKD: 1,
      CNY: 1.08,
      USD: 7.8,
      /** USDT ≈ USD */
      USDT: 7.8,
      SGD: 6.1843,
    },
    fx_live: null,
    asset_classification: {
      safe_assets: ['hsbc', 'zabank', 'boc', 'starryblu', 'yulibao', 'cash_rmb'],
      offensive_assets: ['qqq', 'ko', 'schd'],
      neutral_assets: ['gold_etf'],
      crypto_assets: ['htx_earn_usdt', 'okx_earn_usdt'],
    },
    rules: {
      safety_cap: 20000,
      carryover_rule: 'split_50_50',
      pe_guard_enabled: true,
      nasdaq_pe_threshold: 30,
      nasdaq_pe_current: 28,
      /** 纳指估值平均中枢（历史中位附近参考） */
      avg_pivot: 25,
      /** CNN Fear & Greed：50 中性 */
      fear_greed_index: 50,
      fear_greed_rating: 'neutral',
      payday_day: 10,
      payday_postpone_weekend: true,
      htx_high_yield_threshold: 200,
      htx_high_yield_rate: 0.1,
      htx_low_yield_rate: 0.015,
      htx_target_balance: 199,
      htx_overflow_min_transfer: 2,
      okx_yield_rate: 0.0224,
    },
  },
  accounts: {
    rmb_pool: [
      {
        id: 'yulibao',
        name: '余利宝',
        type: 'cash',
        amount: 0,
        currency: 'CNY',
        /** 业绩比较基准参考（净值型，可手改；非承诺收益） */
        yield_rate: 0.015,
      },
      {
        id: 'cash_rmb',
        name: '手头现金',
        type: 'cash',
        amount: 0,
        currency: 'CNY',
      },
      {
        id: 'gold_etf',
        name: '博时黄金ETF联接C',
        type: 'gold',
        amount: 0,
        currency: 'CNY',
        fund_code: '002611',
        shares: 0,
        cost_amount: 0,
        fund_lots: [],
      },
    ],
    hkd_pool: [
      {
        id: 'hsbc',
        name: '汇丰银行',
        type: 'bank',
        amount: 0,
        currency: 'HKD',
        is_safety_line: true,
      },
      {
        id: 'zabank',
        name: '众安银行',
        type: 'bank',
        amount: 0,
        currency: 'HKD',
        /** 活期/储蓄参考年化，可手改 */
        yield_rate: 0.003,
      },
      {
        id: 'boc',
        name: '中银香港',
        type: 'bank',
        amount: 0,
        currency: 'HKD',
        note: '中国银行（香港）',
      },
      {
        id: 'starryblu',
        name: 'starryblu',
        type: 'bank',
        amount: 0,
        currency: 'SGD',
        yield_rate: 0.0036,
      },
    ],
    us_stock_pool: [],
    crypto_pool: [
      {
        id: 'htx_earn_usdt',
        name: 'HTX 赚币 USDT',
        type: 'crypto_earn',
        amount: 0,
        currency: 'USDT',
        yield_rate: 0.1,
        note: '火币/HTX · <200U 享 10% · 加密赌注池',
      },
      {
        id: 'okx_earn_usdt',
        name: 'OKX 活期 USDT',
        type: 'crypto_earn',
        amount: 0,
        currency: 'USDT',
        yield_rate: 0.0224,
        note: '欧易/OKX · 承接 HTX 溢流 · 年化 2.24%',
      },
    ],
  },
  salary: {
    settings: {
      currency: 'CNY',
      ratios: {
        parents: 0.3,
        safety_pad: 0.25,
        us_seed: 0.35,
        fun_fund: 0.1,
        travel_fund: 0,
      },
      safety_pad_target: 20000,
      us_seed_remit_months: 3,
      fun_fund_charges: [
        {
          id: 'cursor_pro',
          label: 'Cursor Pro',
          amount: 60,
          currency: 'USD',
          billing_day: 28,
          enabled: true,
        },
      ],
    },
    buckets: {
      emergency_reserve: 0,
      us_seed_parking: 0,
      cash_observation: 0,
      fun_fund_pocket: 0,
      travel_fund_pocket: 0,
    },
    history: [],
    extra_income_history: [],
    remit_history: [],
    carryover_history: [],
    fun_fund_charge_history: [],
    last_remit_at: null,
  },
  yuan_gou: {
    daily_cost_cny: 1,
    reward_usdt: 1,
    daily_cost_usdt: 1,
    history: [],
  },
  crypto_ops: {
    overflow_log: [],
  },
  loans: {
    items: [],
  },
}
