/**
 * 美股 TTM 股息率：东方财富美股分红历史 + 新浪现价。
 * - 雪球 stock.xueqiu.com 有阿里云 WAF，服务端代理不稳定
 * - 新浪 hq 的 dividend 字段对美股/ETF 多为 0，不可用
 * - 东财 RPT_USF10_INFO_DIVIDEND 国内可访问；开发走 `/api/eastmoney` 代理
 */

import dayjs from 'dayjs'
import { add, div, round } from '@/utils/decimal'
import { fetchStockQuotes } from '@/utils/stock-prices'

export interface StockDividendYield {
  symbol: string
  /** 小数，如 0.031 = 3.1% */
  div_yield: number
  /** 近 12 个月已除权现金分红合计（USD / 股） */
  ttm_div: number
  price: number
  as_of: string
  source: string
}

interface EastmoneyDividendRow {
  PLAN_EXPLAIN?: string
  EX_DIVIDEND_DATE?: string
  ASSIGN_TYPE?: string
  SECUCODE?: string
  SECURITY_CODE?: string
}

interface EastmoneyDividendResponse {
  success?: boolean
  message?: string
  result?: {
    data?: EastmoneyDividendRow[] | null
  } | null
}

/** 交易所后缀：NYSE=.N NASDAQ=.O AMEX=.A */
const SECU_SUFFIXES = ['.N', '.O', '.A'] as const

function eastmoneyBaseUrl() {
  return '/api/eastmoney'
}

function parseDividendAmount(explain: string | undefined): number {
  if (!explain) return 0
  // 每1股派0.53美元股息
  const m = explain.match(/派\s*([0-9]+(?:\.[0-9]+)?)/)
  if (m) {
    const n = Number.parseFloat(m[1]!)
    return n > 0 ? n : 0
  }
  const m2 = explain.match(/([0-9]+\.[0-9]+)/)
  if (m2) {
    const n = Number.parseFloat(m2[1]!)
    return n > 0 ? n : 0
  }
  return 0
}

function parseExDate(raw: string | undefined): Date | null {
  if (!raw) return null
  // "2026-06-15 00:00:00"
  const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const dt = dayjs(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`)
  return dt.isValid() ? dt.toDate() : null
}

/** 近 365 天、已除权现金分红合计 */
function sumTtmDividends(rows: EastmoneyDividendRow[], now: Date): number {
  const cutoff = dayjs(now)
    .subtract(365 * 24 * 60 * 60 * 1000, 'millisecond')
    .toDate()
  let total = 0
  for (const row of rows) {
    const assign = (row.ASSIGN_TYPE || 'Cash').trim()
    if (assign && assign.toLowerCase() !== 'cash') continue
    const ex = parseExDate(row.EX_DIVIDEND_DATE)
    if (!ex || ex > now || ex < cutoff) continue
    const amount = parseDividendAmount(row.PLAN_EXPLAIN)
    if (amount <= 0) continue
    total = add(total, amount)
  }
  return round(total, 4)
}

async function fetchDividendRows(secuCode: string): Promise<EastmoneyDividendRow[]> {
  const filter = encodeURIComponent(`(SECUCODE="${secuCode}")`)
  const url =
    `${eastmoneyBaseUrl()}/securities/api/data/v1/get` +
    `?reportName=RPT_USF10_INFO_DIVIDEND` +
    `&columns=SECUCODE,SECURITY_CODE,PLAN_EXPLAIN,EX_DIVIDEND_DATE,ASSIGN_TYPE` +
    `&filter=${filter}` +
    `&pageNumber=1&pageSize=20&sortTypes=-1&sortColumns=EX_DIVIDEND_DATE` +
    `&source=SECURITIES&client=PC`

  const res = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`股息请求失败 (${res.status})`)
  }
  const json = (await res.json()) as EastmoneyDividendResponse
  const data = json.result?.data
  if (!Array.isArray(data) || !data.length) {
    return []
  }
  return data
}

/**
 * 解析 SECUCODE：依次尝试 .N / .O / .A，命中有分红记录的代码即返回；
 * 皆无记录则 rows=[]（按 0 股息，非错误）。
 */
async function resolveSecuCode(symbol: string): Promise<{
  secuCode: string
  rows: EastmoneyDividendRow[]
}> {
  const sym = symbol.trim().toUpperCase()
  let lastError: unknown
  let hadSuccess = false
  for (const suffix of SECU_SUFFIXES) {
    const secuCode = `${sym}${suffix}`
    try {
      const rows = await fetchDividendRows(secuCode)
      hadSuccess = true
      if (rows.length > 0) return { secuCode, rows }
    } catch (error) {
      lastError = error
    }
  }
  // 三次都网络失败才抛；有成功但无数据则 0 股息
  if (!hadSuccess && lastError instanceof Error) throw lastError
  return { secuCode: `${sym}.N`, rows: [] }
}

async function fetchOneDividendYield(
  symbol: string,
  price: number | undefined,
): Promise<StockDividendYield> {
  const sym = symbol.trim().toUpperCase()
  const { rows } = await resolveSecuCode(sym)
  const now = dayjs().toDate()
  const ttm = sumTtmDividends(rows, now)

  let px = price
  if (!(typeof px === 'number' && px > 0)) {
    const { quotes, errors } = await fetchStockQuotes([sym])
    px = quotes[0]?.price
    if (!(typeof px === 'number' && px > 0)) {
      throw new Error(errors[0] ?? '未返回有效现价')
    }
  }

  const divYield = ttm > 0 ? round(div(ttm, px), 4) : 0

  return {
    symbol: sym,
    div_yield: divYield,
    ttm_div: ttm,
    price: round(px, 2),
    as_of: now.toISOString(),
    source: 'eastmoney-us-dividend+sina',
  }
}

/**
 * 批量拉取标的 TTM 股息率；部分失败时仍返回成功项。
 * 可选传入已知现价（来自新浪），避免重复请求。
 */
export async function fetchStockDividendYields(
  symbols: string[],
  priceBySymbol?: Record<string, number>,
): Promise<{
  yields: StockDividendYield[]
  errors: string[]
}> {
  const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))]
  if (!unique.length) return { yields: [], errors: [] }

  // 无传入现价时批量补一次新浪
  const prices = { ...(priceBySymbol ?? {}) }
  const missing = unique.filter((s) => !(prices[s]! > 0))
  if (missing.length) {
    const { quotes } = await fetchStockQuotes(missing)
    for (const q of quotes) {
      prices[q.symbol.toUpperCase()] = q.price
    }
  }

  const yields: StockDividendYield[] = []
  const errors: string[] = []

  const results = await Promise.allSettled(
    unique.map((symbol) => fetchOneDividendYield(symbol, prices[symbol])),
  )

  for (let i = 0; i < unique.length; i += 1) {
    const symbol = unique[i]!
    const settled = results[i]!
    if (settled.status === 'fulfilled') {
      yields.push(settled.value)
    } else {
      const msg = settled.reason instanceof Error ? settled.reason.message : String(settled.reason)
      errors.push(`${symbol}: ${msg}`)
    }
  }

  return { yields, errors }
}
