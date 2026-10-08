/**
 * 纳指 100 PE：蛋卷基金指数估值（国内可访问）。
 * 浏览器直连有 CORS，开发/预览走 Vite 代理 `/api/danjuan`。
 */

import dayjs from 'dayjs'
import { round } from '@/utils/decimal'

export interface NasdaqPeQuote {
  pe: number
  name: string
  as_of: string
  fetched_at: string
  source: string
}

interface DanjuanIndexEva {
  result_code?: number
  data?: {
    index_code?: string
    name?: string
    pe?: number
    date?: string
    ts?: number
  }
}

export async function fetchNasdaqPe(): Promise<NasdaqPeQuote> {
  const res = await fetch('/api/danjuan/djapi/index_eva/detail/NDX', {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`纳指 PE 请求失败 (${res.status})`)
  }
  const json = (await res.json()) as DanjuanIndexEva
  const pe = json.data?.pe
  if (!(typeof pe === 'number' && pe > 0)) {
    throw new Error('蛋卷未返回有效纳指 PE')
  }

  const parsedTs = json.data?.ts ? dayjs(json.data.ts) : null
  const asOf = parsedTs?.isValid() ? parsedTs.toISOString() : dayjs().toISOString()

  return {
    pe: round(pe, 1),
    name: json.data?.name ?? '纳指100',
    as_of: asOf,
    fetched_at: dayjs().toISOString(),
    source: 'danjuan-index-eva',
  }
}
