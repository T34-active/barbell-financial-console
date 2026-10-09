/**
 * 美股现价：新浪财经 hq.sinajs.cn（国内可访问）。
 * 雪球 stock.xueqiu.com 有阿里云 WAF，Node/Vite 代理经常被拦，故改用新浪。
 * 浏览器直连有 CORS，开发/预览走 Vite 代理 `/api/sina-hq`。
 */

import dayjs from 'dayjs'
import { round } from '@/utils/decimal'

export interface StockQuote {
  symbol: string
  price: number
  currency: string
  as_of: string
  source: string
  name?: string
}

/** 东财检索命中的美股 */
export interface StockProfile {
  symbol: string
  name: string
  exchange?: string
  price?: number
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
    const price = Number.parseFloat(fields[1] ?? '')
    if (!(price > 0)) {
      errors.push(`${symbol}: 未返回有效现价`)
      continue
    }

    found.add(symbol)
    quotes.push({
      symbol,
      price: round(price, 2),
      currency: 'USD',
      as_of: parseSinaTime(fields[3]),
      source: 'sina-finance',
      name: sinaQuoteName(fields[0]),
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
  }
}
