/**
 * GitHub 云仓同步：仓库内 `public/pbfc-finance/`（index + 各领域文件）。
 * 开发/预览态经 Vite `/api/finance-cloud` 读写整份信封；
 * 静态托管则先读 `/pbfc-finance/index.json` 再拼接各领域文件。
 */

import dayjs from 'dayjs'

export const FINANCE_CLOUD_DIR = 'public/pbfc-finance'
export const FINANCE_CLOUD_STAMP_KEY = 'pbfc-cloud-at'

/** 拉取/导入云仓时静音自动写回，避免循环 */
let autoSyncMute = 0

export function muteCloudAutoSync() {
  autoSyncMute += 1
}

export function unmuteCloudAutoSync() {
  autoSyncMute = Math.max(0, autoSyncMute - 1)
}

export function isCloudAutoSyncMuted() {
  return autoSyncMute > 0
}

export async function withCloudAutoSyncMuted<T>(fn: () => Promise<T> | T): Promise<T> {
  muteCloudAutoSync()
  try {
    return await fn()
  } finally {
    unmuteCloudAutoSync()
  }
}

export interface FinanceCloudBackup {
  version: 1
  exported_at: string
  key: 'pbfc-finance'
  source?: string
  data: unknown
}

interface FinanceCloudIndex {
  version: 1
  exported_at: string
  key?: string
  source?: string
  parts: string[]
}

function isBackup(raw: unknown): raw is FinanceCloudBackup {
  if (!raw || typeof raw !== 'object') return false
  const o = raw as Record<string, unknown>
  return o.version === 1 && typeof o.exported_at === 'string' && !!o.data
}

function isIndex(raw: unknown): raw is FinanceCloudIndex {
  if (!raw || typeof raw !== 'object') return false
  const o = raw as Record<string, unknown>
  return (
    o.version === 1 &&
    typeof o.exported_at === 'string' &&
    Array.isArray(o.parts) &&
    o.parts.length > 0 &&
    o.parts.every((part) => typeof part === 'string' && /^[a-z0-9_]+$/i.test(part))
  )
}

function normalizeBackup(json: unknown): FinanceCloudBackup | null {
  if (isBackup(json)) return json
  // 允许裸 FinanceState / Pinia persist 形态
  if (json && typeof json === 'object' && 'settings' in (json as object)) {
    return {
      version: 1,
      exported_at: dayjs(0).toISOString(),
      key: 'pbfc-finance',
      source: 'legacy-bare',
      data: json,
    }
  }
  return null
}

async function fetchBackupUrl(url: string): Promise<FinanceCloudBackup | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    return normalizeBackup((await res.json()) as unknown)
  } catch {
    return null
  }
}

/**
 * 读取拆分目录。index 不存在返回 null（可再试旧单文件）；
 * index 在但领域文件拼不齐返回 incomplete，避免用残缺或过期单文件覆盖本地。
 */
async function fetchSplitCloud(): Promise<FinanceCloudBackup | null | 'incomplete'> {
  const stamp = Date.now()
  let index: FinanceCloudIndex
  try {
    const res = await fetch(`/pbfc-finance/index.json?t=${stamp}`, { cache: 'no-store' })
    if (res.status === 404) return null
    if (!res.ok) return 'incomplete'
    const json = (await res.json()) as unknown
    if (!isIndex(json)) return 'incomplete'
    index = json
  } catch {
    return null
  }

  try {
    const entries = await Promise.all(
      index.parts.map(async (part) => {
        const res = await fetch(`/pbfc-finance/${part}.json?t=${stamp}`, { cache: 'no-store' })
        if (!res.ok) return null
        const json = (await res.json()) as unknown
        if (!json || typeof json !== 'object' || Array.isArray(json)) return null
        return [part, json] as const
      }),
    )
    if (entries.some((entry) => entry == null)) return 'incomplete'
    const data: Record<string, unknown> = {}
    for (const entry of entries) {
      if (!entry) return 'incomplete'
      data[entry[0]] = entry[1]
    }
    return {
      version: 1,
      exported_at: index.exported_at,
      key: 'pbfc-finance',
      ...(typeof index.source === 'string' ? { source: index.source } : {}),
      data,
    }
  } catch {
    return 'incomplete'
  }
}

/** 读取仓库云仓（优先 API 拼装结果，再读拆分目录，最后才读旧单文件） */
export async function fetchFinanceCloud(): Promise<FinanceCloudBackup | null> {
  const fromApi = await fetchBackupUrl('/api/finance-cloud')
  if (fromApi) return fromApi

  const split = await fetchSplitCloud()
  if (split === 'incomplete') return null
  if (split) return split

  return fetchBackupUrl(`/pbfc-finance.json?t=${Date.now()}`)
}

/** 写入仓库目录（仅开发/预览中间件可用） */
export async function pushFinanceCloud(backup: FinanceCloudBackup): Promise<void> {
  const res = await fetch('/api/finance-cloud', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json;charset=utf-8' },
    body: `${JSON.stringify(backup, null, 2)}\n`,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      text ||
        `写入仓库失败 (${res.status})。请确认在 pnpm dev 下运行，或改用「导出备份」后手动覆盖 ${FINANCE_CLOUD_DIR}/`,
    )
  }
}

export function getLocalCloudStamp(): string | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(FINANCE_CLOUD_STAMP_KEY)
}

export function setLocalCloudStamp(exportedAt: string) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(FINANCE_CLOUD_STAMP_KEY, exportedAt)
}

/** 仓库比本地上次同步更新 → 应拉取 */
export function isCloudNewer(cloud: FinanceCloudBackup): boolean {
  const local = getLocalCloudStamp()
  if (!local) return true
  return cloud.exported_at > local
}
