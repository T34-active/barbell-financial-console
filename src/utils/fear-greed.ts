/**
 * CNN Fear & Greed Index（美股恐贪指数 0–100）。
 * 浏览器直连有 CORS，开发/预览走 Vite 代理 `/api/cnn-fg`。
 */

import dayjs from 'dayjs'
import { round } from '@/utils/decimal'

export interface FearGreedQuote {
  score: number
  rating: string
  rating_zh: string
  fetched_at: string
  source: string
}

interface CnnFearGreedPayload {
  fear_and_greed?: {
    score?: number
    rating?: string
    timestamp?: string
  }
}

const RATING_ZH: Record<string, string> = {
  'extreme fear': '极度恐惧',
  fear: '恐惧',
  neutral: '中性',
  greed: '贪婪',
  'extreme greed': '极度贪婪',
}

/** 半圆色带：左恐惧绿 → 右贪婪红（昼夜同一套，避免两套观感） */
export const FEAR_GREED_BANDS = [
  { name: '极度恐惧', value: 25, min: 0, max: 24, color: '#22c55e', colorDark: '#22c55e' },
  { name: '恐惧', value: 20, min: 25, max: 44, color: '#84cc16', colorDark: '#84cc16' },
  { name: '中性', value: 11, min: 45, max: 55, color: '#eab308', colorDark: '#eab308' },
  { name: '贪婪', value: 20, min: 56, max: 75, color: '#f97316', colorDark: '#f97316' },
  { name: '极度贪婪', value: 24, min: 76, max: 100, color: '#ef4444', colorDark: '#ef4444' },
] as const

/** 半圆弧渐变停靠点（与色带同序） */
export const FEAR_GREED_GRADIENT = [
  { offset: '0%', color: '#22c55e', colorDark: '#22c55e' },
  { offset: '25%', color: '#84cc16', colorDark: '#84cc16' },
  { offset: '50%', color: '#eab308', colorDark: '#eab308' },
  { offset: '75%', color: '#f97316', colorDark: '#f97316' },
  { offset: '100%', color: '#ef4444', colorDark: '#ef4444' },
] as const

export function resolveFearGreedLabel(score: number, rating?: string): string {
  const fromScore = fearGreedBandZh(score)
  if (rating) {
    const fromRating = fearGreedRatingZh(rating)
    if (fromRating === fromScore) return fromRating
  }
  return fromScore
}

export function fearGreedRatingZh(rating: string | undefined): string {
  if (!rating) return '—'
  return RATING_ZH[rating.toLowerCase()] ?? rating
}

/** 按分数给出中文区间（无官方 rating 时兜底） */
export function fearGreedBandZh(score: number): string {
  if (score < 25) return '极度恐惧'
  if (score < 45) return '恐惧'
  if (score <= 55) return '中性'
  if (score <= 75) return '贪婪'
  return '极度贪婪'
}

function toQuote(score: number, rating: string, source: string): FearGreedQuote {
  const rounded = round(score, 1)
  const normalized = rating.toLowerCase() || 'neutral'
  return {
    score: rounded,
    rating: normalized,
    rating_zh: fearGreedRatingZh(normalized) || fearGreedBandZh(rounded),
    fetched_at: dayjs().toISOString(),
    source,
  }
}

async function fetchFromCnn(): Promise<FearGreedQuote> {
  const res = await fetch('/api/cnn-fg/index/fearandgreed/graphdata', {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`恐贪指数请求失败 (${res.status})`)
  }
  const json = (await res.json()) as CnnFearGreedPayload
  const score = json.fear_and_greed?.score
  if (!(typeof score === 'number' && score >= 0 && score <= 100)) {
    throw new Error('CNN 未返回有效恐贪指数')
  }
  return toQuote(score, json.fear_and_greed?.rating ?? '', 'cnn-fear-greed')
}

/** CNN 被拦时走 jsDelivr 镜像的历史 CSV 末行 */
async function fetchFromGithubCsv(): Promise<FearGreedQuote> {
  const res = await fetch(
    'https://cdn.jsdelivr.net/gh/whit3rabbit/fear-greed-data@main/datasets/cnn_fear_greed.csv',
    { cache: 'no-store', headers: { Accept: 'text/csv,text/plain' } },
  )
  if (!res.ok) {
    throw new Error(`恐贪指数备份源失败 (${res.status})`)
  }
  const lines = (await res.text())
    .trim()
    .split(/\r?\n/)
    .filter((line) => line && !/^date/i.test(line))
  const last = lines.at(-1)
  if (!last) throw new Error('恐贪指数备份源为空')
  const parts = last.split(',')
  const score = Number(parts[1])
  if (!(score >= 0 && score <= 100)) {
    throw new Error('恐贪指数备份源无效')
  }
  return toQuote(score, parts[2]?.trim() ?? '', 'cnn-fear-greed-csv')
}

export async function fetchFearGreedIndex(): Promise<FearGreedQuote> {
  try {
    return await fetchFromCnn()
  } catch {
    return await fetchFromGithubCsv()
  }
}
