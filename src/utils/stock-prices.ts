/**
 * 美股现价：新浪财经 hq.sinajs.cn（国内可访问）。
 * 雪球 stock.xueqiu.com 有阿里云 WAF，Node/Vite 代理经常被拦，故改用新浪。
 * 浏览器直连有 CORS，开发/预览走 Vite 代理 `/api/sina-hq`。
 *
 * gb_ 报文里 fields[1] 是常规交易时段价（盘中）。盘前/盘后实时价在 fields[21]，
 * 对应美东时间在 fields[24]，盘中收盘时间在 fields[25]。
 * 常规交易时段用盘中价；其余时段若盘前/盘后成交更晚，则用实时价。
 */

import dayjs from 'dayjs'
import type { UsQuoteSession } from '@/types/finance'
import { round } from '@/utils/decimal'

export interface StockQuote {
  symbol: string
  price: number
  currency: string
  as_of: string
  source: string
  name?: string
  /** 现价所属时段 */
  session: UsQuoteSession
  /** 最近一个常规交易时段价格 */
  regular_price: number
}

const US_QUOTE_SESSION_LABEL: Record<UsQuoteSession, string> = {
  pre: '盘前',
  regular: '盘中',
  post: '盘后',
}

export function usQuoteSessionLabel(session: UsQuoteSession | undefined): string {
  if (!session) return ''
  return US_QUOTE_SESSION_LABEL[session]
}

/** 东财检索命中的美股 */
export interface StockProfile {
  symbol: string
  name: string
  exchange?: string
  price?: number
  price_session?: UsQuoteSession
  price_as_of?: string
  regular_price?: number
}

function sinaBaseUrl() {
  return '/api/sina-hq'
}

/** KO → gb_ko（新浪美股代码） */
function toSinaUsCode(symbol: string): string {
  return `gb_${symbol.trim().toLowerCase()}`
}

function fromSinaUsCode(code: string): string {
  return code.replace(/^gb_/i, '').toUpperCase()
}

export function normalizeUsStockSymbol(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, '')
    .slice(0, 12)
}

export function isUsStockSymbol(symbol: string): boolean {
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)
}

async function readSinaBody(res: Response): Promise<string> {
  const buf = await res.arrayBuffer()
  try {
    return new TextDecoder('gb18030').decode(buf)
  } catch {
    return new TextDecoder('utf-8').decode(buf)
  }
}

function sinaQuoteName(raw: string | undefined): string | undefined {
  const name = (raw ?? '').trim()
  if (!name) return undefined
  if (/[\u4e00-\u9fff]/.test(name) || /^[A-Za-z0-9 .&'+/-]+$/.test(name)) return name
  return undefined
}

/** 解析 `2026-08-10 19:45:18` 为 ISO（按北京时间理解） */
function parseSinaTime(raw: string | undefined): string {
  if (!raw) return dayjs().toISOString()
  const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/)
  if (!m) return dayjs().toISOString()
  const [, y, mo, d, h, mi, s] = m
  // 新浪美股时间戳多为北京时间展示
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}+08:00`
  const dt = dayjs(iso)
  return dt.isValid() ? dt.toISOString() : dayjs().toISOString()
}

const ET_MONTHS: Record<string, number> = {
  Jan: 1,
  Feb: 2,
  Mar: 3,
  Apr: 4,
  May: 5,
  Jun: 6,
  Jul: 7,
  Aug: 8,
  Sep: 9,
  Oct: 10,
  Nov: 11,
  Dec: 12,
}

interface EtClock {
  at: dayjs.Dayjs
  hour: number
  minute: number
  tz: 'EDT' | 'EST'
}

/** 解析 `Oct 12 05:28AM EDT`，年份取最接近行情刷新时刻的那个 */
function parseSinaEtClock(raw: string | undefined, hintMs: number): EtClock | null {
  if (!raw) return null
  const m = raw
    .trim()
    .match(/^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{1,2}):(\d{2})(AM|PM)\s+(EDT|EST)$/)
  if (!m) return null
  const month = ET_MONTHS[m[1]!]
  if (!month) return null
  const day = Number(m[2])
  let hour = Number(m[3]) % 12
  if (m[5] === 'PM') hour += 12
  const minute = Number(m[4])
  const tz = m[6] as 'EDT' | 'EST'
  const offset = tz === 'EDT' ? '-04:00' : '-05:00'
  const hintYear = new Date(hintMs).getUTCFullYear()
  let best: dayjs.Dayjs | null = null
  let bestDiff = Number.POSITIVE_INFINITY
  for (const year of [hintYear - 1, hintYear, hintYear + 1]) {
    const iso =
      `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` +
      `T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${offset}`
    const dt = dayjs(iso)
    if (!dt.isValid()) continue
    const diff = Math.abs(dt.valueOf() - hintMs)
    if (diff < bestDiff) {
      best = dt
      bestDiff = diff
    }
  }
  if (!best) return null
  return { at: best, hour, minute, tz }
}

function etParts(ms: number, tz: 'EDT' | 'EST') {
  const offsetHours = tz === 'EDT' ? -4 : -5
  const shifted = new Date(ms + offsetHours * 3_600_000)
  return {
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  }
}

/** 美东夏令时粗判：报文里没有 EDT/EST 时才用 */
function inferEasternTz(ms: number): 'EDT' | 'EST' {
  const date = new Date(ms)
  const month = date.getUTCMonth() + 1
  const day = date.getUTCDate()
  if (month >= 4 && month <= 10) return 'EDT'
  if (month <= 2 || month === 12) return 'EST'
  if (month === 3) return day >= 8 ? 'EDT' : 'EST'
  return day < 7 ? 'EDT' : 'EST'
}

function isRegularSession(ms: number, tz: 'EDT' | 'EST'): boolean {
  const { weekday, hour, minute } = etParts(ms, tz)
  if (weekday === 0 || weekday === 6) return false
  const mins = hour * 60 + minute
  return mins >= 9 * 60 + 30 && mins < 16 * 60
}

function sessionFromEtClock(hour: number, minute: number): UsQuoteSession {
  const mins = hour * 60 + minute
  if (mins >= 4 * 60 && mins < 9 * 60 + 30) return 'pre'
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) return 'regular'
  return 'post'
}

/**
 * 盘中价在 fields[1]。盘前/盘后价在 fields[21]，仅当行情时刻不在常规交易时段、
 * 且该笔成交晚于盘中收盘时采用。
 */
function pickSinaUsPrice(fields: string[]): {
  price: number
  session: UsQuoteSession
  as_of: string
  regular_price: number
} | null {
  const regularPrice = Number.parseFloat(fields[1] ?? '')
  if (!(regularPrice > 0)) return null

  const hint = dayjs(parseSinaTime(fields[3]))
  const hintMs = hint.isValid() ? hint.valueOf() : Date.now()
  const regularClock = parseSinaEtClock(fields[25], hintMs)
  const extClock = parseSinaEtClock(fields[24], hintMs)
  const extPrice = Number.parseFloat(fields[21] ?? '')
  const tz = extClock?.tz ?? regularClock?.tz ?? inferEasternTz(hintMs)
  const extFresh =
    extPrice > 0 &&
    extClock != null &&
    (regularClock == null || extClock.at.valueOf() > regularClock.at.valueOf())

  if (!isRegularSession(hintMs, tz) && extFresh && extClock) {
    return {
      price: extPrice,
      session: sessionFromEtClock(extClock.hour, extClock.minute),
      as_of: extClock.at.toISOString(),
      regular_price: regularPrice,
    }
  }

  const asOf = isRegularSession(hintMs, tz)
    ? new Date(hintMs).toISOString()
    : (regularClock?.at.toISOString() ?? new Date(hintMs).toISOString())

  return {
    price: regularPrice,
    session: 'regular',
    as_of: asOf,
    regular_price: regularPrice,
  }
}

/**
 * 批量拉取标的现价；部分失败时仍返回成功项，并汇总错误。
 * 新浪支持逗号拼接一次取多只。
 */
export async function fetchStockQuotes(symbols: string[]): Promise<{
  quotes: StockQuote[]
  errors: string[]
}> {
  const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))]
  if (!unique.length) return { quotes: [], errors: [] }

  const list = unique.map(toSinaUsCode).join(',')
  const url = `${sinaBaseUrl()}/list=${list}`
  const errors: string[] = []
  const quotes: StockQuote[] = []

  let text = ''
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'text/plain,*/*' },
    })
    if (!res.ok) {
      throw new Error(`行情请求失败 (${res.status})`)
    }
    text = await readSinaBody(res)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return {
      quotes: [],
      errors: unique.map((s) => `${s}: ${msg}`),
    }
  }

  const found = new Set<string>()
  const lineRe = /hq_str_(gb_[a-z0-9.-]+)\s*=\s*"([^"]*)"/gi
  let match: RegExpExecArray | null
  while ((match = lineRe.exec(text)) !== null) {
    const sinaCode = match[1]!
    const payload = match[2]!
    const symbol = fromSinaUsCode(sinaCode)
    if (!unique.includes(symbol)) continue

    if (!payload.trim()) {
      errors.push(`${symbol}: 新浪无行情数据`)
      continue
    }

    const fields = payload.split(',')
    const picked = pickSinaUsPrice(fields)
    if (!picked) {
      errors.push(`${symbol}: 未返回有效现价`)
      continue
    }

    found.add(symbol)
    quotes.push({
      symbol,
      price: round(picked.price, 2),
      currency: 'USD',
      as_of: picked.as_of,
      source: 'sina-finance',
      name: sinaQuoteName(fields[0]),
      session: picked.session,
      regular_price: round(picked.regular_price, 2),
    })
  }

  for (const symbol of unique) {
    if (!found.has(symbol)) {
      errors.push(`${symbol}: 未在行情响应中找到`)
    }
  }

  return { quotes, errors }
}

function emSuggestBaseUrl() {
  return '/api/em-suggest'
}

/** 东财网页检索公开 token，非密钥 */
const EASTMONEY_SUGGEST_TOKEN = 'FAKESECRET_s4t5u6v7w8x9y0z1a2b3'

interface EastmoneySuggestHit {
  Code?: string
  Name?: string
  JYS?: string
  Classify?: string
  SecurityTypeName?: string
  UnifiedCode?: string
}

interface EastmoneySuggestResponse {
  QuotationCodeTable?: {
    Data?: EastmoneySuggestHit[] | null
  }
}

async function fetchEastmoneyUsSuggest(query: string): Promise<EastmoneySuggestHit[]> {
  const url =
    `${emSuggestBaseUrl()}/api/suggest/get` +
    `?input=${encodeURIComponent(query)}` +
    `&type=14&token=${EASTMONEY_SUGGEST_TOKEN}&count=12`

  const res = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json,*/*' },
  })
  if (!res.ok) throw new Error(`股票查询失败 (${res.status})`)
  const json = (await res.json()) as EastmoneySuggestResponse
  return json.QuotationCodeTable?.Data ?? []
}

function isUsSuggestHit(item: EastmoneySuggestHit): boolean {
  return item.Classify === 'UsStock' || item.SecurityTypeName === '美股'
}

function mapUsSuggestHit(item: EastmoneySuggestHit): StockProfile | null {
  if (!isUsSuggestHit(item)) return null
  const symbol = (item.Code || item.UnifiedCode || '').toUpperCase()
  const name = (item.Name || '').trim()
  if (!isUsStockSymbol(symbol) || !name) return null
  return {
    symbol,
    name,
    exchange: item.JYS?.trim() || undefined,
  }
}

/** 按代码或中文名模糊检索美股，供候选列表 */
export async function searchUsStocks(query: string): Promise<StockProfile[]> {
  const key = query.trim()
  if (!key) return []
  const hits = await fetchEastmoneyUsSuggest(key)
  const seen = new Set<string>()
  const list: StockProfile[] = []
  for (const item of hits) {
    const stock = mapUsSuggestHit(item)
    if (!stock || seen.has(stock.symbol)) continue
    seen.add(stock.symbol)
    list.push(stock)
  }
  return list
}

/**
 * 按美股代码联网核对标的，带回东财中文简称与现价。
 */
export async function lookupStock(symbol: string): Promise<StockProfile> {
  const code = normalizeUsStockSymbol(symbol)
  if (!isUsStockSymbol(code)) {
    throw new Error('股票代码无效，例如 AAPL、QQQ')
  }

  let suggestError: Error | undefined
  let hit: StockProfile | undefined
  try {
    hit = (await searchUsStocks(code)).find((item) => item.symbol === code)
  } catch (error) {
    suggestError = error instanceof Error ? error : new Error(String(error))
  }

  const { quotes } = await fetchStockQuotes([code]).catch(() => ({ quotes: [] as StockQuote[] }))
  const quote = quotes[0]
  const name = hit?.name || quote?.name?.trim() || ''
  if (!name) {
    if (suggestError?.message.startsWith('股票查询失败')) throw suggestError
    throw new Error(`未找到股票 ${code}，请核对代码`)
  }

  return {
    symbol: code,
    name,
    exchange: hit?.exchange,
    price: quote?.price,
    price_session: quote?.session,
    price_as_of: quote?.as_of,
    regular_price: quote?.regular_price,
  }
}
