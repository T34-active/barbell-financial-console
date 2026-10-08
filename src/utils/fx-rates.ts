/**
 * 实时/日更汇率：USD/CNH（离岸人民币）、CNY/HKD、SGD/HKD。
 * 优先 fawazahmed0 CDN（浏览器 CORS 友好），失败再试 Frankfurter。
 */

import dayjs from 'dayjs'
import { div, mul, round } from '@/utils/decimal'

export interface LiveFxQuotes {
  /** 1 USD = ? CNH（离岸） */
  usd_cnh: number
  /** 1 CNY = ? HKD */
  cny_hkd: number
  /** 推导：1 USD ≈ usd_cnh × cny_hkd HKD（CNH≈CNY 交叉） */
  usd_hkd: number
  /** 1 SGD = ? HKD */
  sgd_hkd: number
  fetched_at: string
  as_of: string
  source: string
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`汇率请求失败 ${res.status}`)
  return res.json() as Promise<T>
}

async function fromFawaz(): Promise<LiveFxQuotes> {
  const [usdPack, cnyPack, sgdPack] = await Promise.all([
    fetchJson<{ date?: string; usd: Record<string, number> }>(
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json',
    ),
    fetchJson<{ date?: string; cny: Record<string, number> }>(
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/cny.min.json',
    ),
    fetchJson<{ date?: string; sgd: Record<string, number> }>(
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/sgd.min.json',
    ).catch(() => null),
  ])

  const usdCnh = usdPack.usd.cnh ?? usdPack.usd.cny
  const cnyHkd = cnyPack.cny.hkd
  if (!usdCnh || !cnyHkd) throw new Error('CDN 汇率缺少 CNH/HKD')

  const sgdHkd =
    sgdPack?.sgd.hkd ??
    (usdPack.usd.hkd && usdPack.usd.sgd ? div(usdPack.usd.hkd, usdPack.usd.sgd) : 0)
  if (!sgdHkd) throw new Error('CDN 汇率缺少 SGD/HKD')

  return {
    usd_cnh: round4(usdCnh),
    cny_hkd: round4(cnyHkd),
    usd_hkd: round4(mul(usdCnh, cnyHkd)),
    sgd_hkd: round4(sgdHkd),
    fetched_at: dayjs().toISOString(),
    as_of: usdPack.date ?? cnyPack.date ?? sgdPack?.date ?? todayKey(),
    source: 'fawazahmed0/currency-api',
  }
}

async function fromFrankfurter(): Promise<LiveFxQuotes> {
  const [usdCnhRes, cnyHkdRes, sgdHkdRes] = await Promise.all([
    fetchJson<{ date: string; rate: number }>('https://api.frankfurter.dev/v2/rate/USD/CNH'),
    fetchJson<{ date: string; rate: number }>('https://api.frankfurter.dev/v2/rate/CNY/HKD'),
    fetchJson<{ date: string; rate: number }>('https://api.frankfurter.dev/v2/rate/SGD/HKD').catch(
      () => null,
    ),
  ])

  const usdCnh = usdCnhRes.rate
  const cnyHkd = cnyHkdRes.rate
  if (!usdCnh || !cnyHkd) throw new Error('Frankfurter 汇率无效')
  const sgdHkd = sgdHkdRes?.rate
  if (!sgdHkd) throw new Error('Frankfurter 汇率缺少 SGD/HKD')

  return {
    usd_cnh: round4(usdCnh),
    cny_hkd: round4(cnyHkd),
    usd_hkd: round4(mul(usdCnh, cnyHkd)),
    sgd_hkd: round4(sgdHkd),
    fetched_at: dayjs().toISOString(),
    as_of: usdCnhRes.date || cnyHkdRes.date || sgdHkdRes?.date || todayKey(),
    source: 'frankfurter.dev',
  }
}

function round4(n: number) {
  return round(n, 4)
}

function todayKey() {
  return dayjs().format('YYYY-MM-DD')
}

/** 拉取 USD/CNH + CNY/HKD + SGD/HKD */
export async function fetchLiveFxQuotes(): Promise<LiveFxQuotes> {
  try {
    return await fromFawaz()
  } catch {
    return fromFrankfurter()
  }
}

export function isFxStale(fetchedAt: string | null | undefined): boolean {
  if (!fetchedAt) return true
  const fetchedDay = fetchedAt.slice(0, 10)
  return fetchedDay !== todayKey()
}
