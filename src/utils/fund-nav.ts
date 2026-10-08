/**
 * 国内公募基金净值：天天基金 / 东财 f10 历史净值接口。
 * 浏览器直连有 CORS，开发/预览走 Vite 代理 `/api/fund-eastmoney`。
 */

import type { FundLot, PoolAccount } from '@/types/finance'

/** 按净值记账的公募基金（含已有黄金账户） */
export function isNavFundAccount(account: Pick<PoolAccount, 'type' | 'fund_code'>): boolean {
  return account.type === 'gold' || account.type === 'fund' || Boolean(account.fund_code?.trim())
}
import { add, div, mul, round, sub } from '@/utils/decimal'

export interface FundNavQuote {
  fund_code: string
  /** 单位净值 */
  nav: number
  /** 上一交易日单位净值 */
  prev_nav?: number
  /** 日涨跌幅（小数，如 0.021 = +2.1%） */
  day_change?: number
  /** 净值日期 YYYY-MM-DD */
  as_of: string
  source: string
}

/** 由最新净值与日涨跌反推上日净值 */
export function derivePrevNav(nav: number, dayChange?: number): number {
  if (!(nav > 0) || dayChange == null || dayChange <= -1) return 0
  return round(div(nav, add(1, dayChange)), 4)
}

/**
 * 单笔当日盈亏：确认日晚于净值日不计；净值当日确认的从确认净值起算；
 * 更早持仓按 份额 × (最新净值 − 上日净值)。
 */
export function lotDailyPnl(lot: FundLot, nav: number, prevNav: number, asOf: string): number {
  if (!(lot.shares > 0) || !(nav > 0) || !asOf) return 0
  if (lot.confirm_date > asOf) return 0
  if (lot.confirm_date === asOf) {
    return round(mul(lot.shares, sub(nav, lot.confirm_nav)), 2)
  }
  if (!(prevNav > 0)) return 0
  return round(mul(lot.shares, sub(nav, prevNav)), 2)
}

export function fundDailyPnlFromLots(
  lots: FundLot[],
  nav: number,
  prevNav: number,
  asOf: string,
): { pnl: number; shares: number } {
  let pnl = 0
  let shares = 0
  for (const lot of lots) {
    pnl = add(pnl, lotDailyPnl(lot, nav, prevNav, asOf))
    if (lot.confirm_date <= asOf) shares = add(shares, lot.shares)
  }
  return { pnl: round(pnl, 2), shares: round(shares, 4) }
}

function fundEastmoneyBaseUrl() {
  return '/api/fund-eastmoney'
}

interface LsjzRow {
  FSRQ?: string
  DWJZ?: string
  JZZZL?: string
}

interface LsjzResponse {
  Data?: {
    LSJZList?: LsjzRow[]
  }
  TotalCount?: number
}

function mapNavRows(code: string, rows: LsjzRow[]): FundNavQuote[] {
  const quotes: FundNavQuote[] = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const nav = Number.parseFloat(row?.DWJZ ?? '')
    if (!(nav > 0) || !row?.FSRQ) continue
    const prevNavRaw = Number.parseFloat(rows[i + 1]?.DWJZ ?? '')
    const prev_nav = prevNavRaw > 0 ? round(prevNavRaw, 4) : undefined
    const chgRaw = Number.parseFloat(row.JZZZL ?? '')
    let day_change = Number.isFinite(chgRaw) ? round(chgRaw / 100, 6) : undefined
    if (day_change == null && prev_nav) {
      day_change = round(div(sub(nav, prev_nav), prev_nav), 6)
    }
    quotes.push({
      fund_code: code,
      nav: round(nav, 4),
      prev_nav,
      day_change,
      as_of: row.FSRQ,
      source: 'eastmoney-fund-lsjz',
    })
  }
  return quotes
}

async function fetchFundLsjzPage(
  code: string,
  pageIndex: number,
  pageSize: number,
): Promise<{ rows: LsjzRow[]; total: number }> {
  const url =
    `${fundEastmoneyBaseUrl()}/f10/lsjz` +
    `?fundCode=${encodeURIComponent(code)}&pageIndex=${pageIndex}&pageSize=${pageSize}`

  let json: LsjzResponse
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json,*/*' },
    })
    if (!res.ok) throw new Error(`净值请求失败 (${res.status})`)
    json = (await res.json()) as LsjzResponse
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    throw new Error(`${code}: ${msg}`)
  }

  return {
    rows: json.Data?.LSJZList ?? [],
    total: json.TotalCount ?? 0,
  }
}

/**
 * 拉取历史已公布单位净值（新→旧）。
 * 东财单页最多 20 条；传入 since（建仓确认日）会翻页直到覆盖该日及再早一天（用于上日净值）。
 */
export async function fetchFundNavHistory(
  fundCode: string,
  options?: { since?: string; pageSize?: number },
): Promise<FundNavQuote[]> {
  const code = fundCode.trim()
  if (!/^\d{6}$/.test(code)) {
    throw new Error(`无效基金代码: ${fundCode}`)
  }

  const pageSize = Math.min(options?.pageSize ?? 20, 20)
  const since = options?.since
  const allRows: LsjzRow[] = []
  const maxPages = 30

  for (let page = 1; page <= maxPages; page++) {
    const { rows, total } = await fetchFundLsjzPage(code, page, pageSize)
    if (!rows.length) break
    allRows.push(...rows)
    if (!since) break
    const oldest = rows[rows.length - 1]?.FSRQ
    if (oldest && oldest < since) break
    if (total > 0 && allRows.length >= total) break
    if (rows.length < pageSize) break
  }

  return mapNavRows(code, allRows)
}

/** 拉取最新已公布单位净值（非盘中估算） */
export async function fetchFundLatestNav(fundCode: string): Promise<FundNavQuote> {
  const quotes = await fetchFundNavHistory(fundCode)
  const latest = quotes[0]
  if (!latest) throw new Error(`${fundCode.trim()}: 未返回有效净值`)
  return latest
}

function fundSuggestBaseUrl() {
  return '/api/fund-suggest'
}

/** 天天基金检索命中的公募产品 */
export interface FundProfile {
  fund_code: string
  name: string
  fund_type?: string
  company?: string
}

interface FundSearchHit {
  CODE?: string
  NAME?: string
  FundBaseInfo?: {
    FCODE?: string
    SHORTNAME?: string
    FTYPE?: string
    JJGS?: string
  } | null
}

interface FundSearchResponse {
  Datas?: FundSearchHit[]
}

/**
 * 按 6 位代码联网核对公募基金。
 * 检索是模糊匹配，必须 CODE 与 FundBaseInfo.FCODE 都等于输入，否则视为无效代码。
 */
export async function lookupFund(fundCode: string): Promise<FundProfile> {
  const code = fundCode.trim()
  if (!/^\d{6}$/.test(code)) {
    throw new Error('基金代码须为 6 位数字')
  }

  const url =
    `${fundSuggestBaseUrl()}/FundSearch/api/FundSearchAPI.ashx` +
    `?m=1&key=${encodeURIComponent(code)}`

  let json: FundSearchResponse
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json,*/*' },
    })
    if (!res.ok) throw new Error(`基金查询失败 (${res.status})`)
    json = (await res.json()) as FundSearchResponse
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('基金查询失败')) throw error
    const msg = error instanceof Error ? error.message : String(error)
    throw new Error(`基金查询失败: ${msg}`)
  }

  const hit = (json.Datas ?? []).find(
    (item) => item.CODE === code && item.FundBaseInfo?.FCODE === code,
  )
  const name = (hit?.FundBaseInfo?.SHORTNAME || hit?.NAME || '').trim()
  if (!hit || !name) throw new Error(`未找到基金 ${code}，请核对代码`)

  return {
    fund_code: code,
    name,
    fund_type: hit.FundBaseInfo?.FTYPE?.trim() || undefined,
    company: hit.FundBaseInfo?.JJGS?.trim() || undefined,
  }
}
