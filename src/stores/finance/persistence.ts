import dayjs from 'dayjs'
import type {
  AccountsState,
  AppSettings,
  CryptoOpsState,
  FinanceState,
  LoansState,
  PoolAccount,
  SalaryState,
  YuanGouState,
} from '@/types/finance'
import {
  fetchFinanceCloud,
  isCloudNewer,
  pushFinanceCloud,
  setLocalCloudStamp,
  withCloudAutoSyncMuted,
  type FinanceCloudBackup,
} from '@/utils/finance-cloud'
import {
  alignNeutralFundClassification,
  alignPoolClassification,
  clonePlain,
  cloneSeed,
  normalizeAccounts,
  normalizeCryptoOps,
  normalizeLoans,
  normalizeSalary,
  normalizeSettings,
  normalizeYuanGou,
} from './normalize'
import type { FinanceRefs } from './state'

export function createPersistence(
  refs: FinanceRefs,
  shared: {
    findRmbAccount: (id: string) => PoolAccount | undefined
    syncYulibaoFromBuckets: () => void
    syncCryptoYieldRates: () => void
  },
  yuanGouApi: {
    applyYuanGouKnownFixes: () => void
  },
) {
  const { settings, accounts, salary, yuanGou, cryptoOps, loans } = refs
  const { findRmbAccount, syncYulibaoFromBuckets, syncCryptoYieldRates } = shared
  const { applyYuanGouKnownFixes } = yuanGouApi

  function resetToSeed() {
    const next = cloneSeed()
    settings.value = next.settings
    accounts.value = next.accounts
    salary.value = next.salary
    yuanGou.value = next.yuan_gou
    cryptoOps.value = next.crypto_ops
    loans.value = next.loans
  }

  /** 导出完整财务快照（供本机/网盘备份，不含密钥） */
  function exportBackup(): {
    version: 1
    exported_at: string
    key: 'pbfc-finance'
    data: FinanceState
  } {
    return {
      version: 1,
      exported_at: dayjs().toISOString(),
      key: 'pbfc-finance',
      data: {
        settings: clonePlain(settings.value),
        accounts: clonePlain(accounts.value),
        salary: clonePlain(salary.value),
        yuan_gou: clonePlain(yuanGou.value),
        crypto_ops: clonePlain(cryptoOps.value),
        loans: clonePlain(loans.value),
      },
    }
  }

  function exportBackupJson(): string {
    try {
      return `${JSON.stringify(exportBackup(), null, 2)}\n`
    } catch {
      // 兜底：直接导出 LocalStorage 持久化快照（避免响应式对象克隆失败）
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('pbfc-finance') : null
      if (!raw) throw new Error('无法导出：LocalStorage 无 pbfc-finance')
      const persisted = JSON.parse(raw) as unknown
      return `${JSON.stringify(
        {
          version: 1,
          exported_at: dayjs().toISOString(),
          key: 'pbfc-finance',
          source: 'localStorage-fallback',
          data: persisted,
        },
        null,
        2,
      )}\n`
    }
  }

  /**
   * 从备份 JSON 恢复。接受包装格式 `{ version, data }`，
   * 或直接的 FinanceState / Pinia 持久化形态（yuanGou/cryptoOps）。
   */
  function importBackup(raw: unknown) {
    if (!raw || typeof raw !== 'object') {
      throw new Error('备份文件无效：不是 JSON 对象')
    }

    const root = raw as Record<string, unknown>
    const payload =
      root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : root

    const nextSettings = payload.settings as AppSettings | undefined
    const nextAccounts = payload.accounts as AccountsState | undefined
    const nextSalary = payload.salary as SalaryState | undefined
    if (!nextSettings || !nextAccounts || !nextSalary) {
      throw new Error('备份文件缺少 settings / accounts / salary')
    }

    const nextYuanGou = (payload.yuan_gou ?? payload.yuanGou) as YuanGouState | undefined
    const nextCryptoOps = (payload.crypto_ops ?? payload.cryptoOps) as CryptoOpsState | undefined
    const nextLoans = (payload.loans ?? payload.Loans) as LoansState | undefined

    settings.value = normalizeSettings(nextSettings)
    accounts.value = normalizeAccounts(nextAccounts)
    alignPoolClassification(settings.value, accounts.value)
    alignNeutralFundClassification(settings.value, accounts.value)
    yuanGou.value = normalizeYuanGou(nextYuanGou)
    cryptoOps.value = normalizeCryptoOps(nextCryptoOps)
    loans.value = normalizeLoans(nextLoans)
    const yulibao = findRmbAccount('yulibao')
    salary.value = normalizeSalary(
      nextSalary,
      yulibao?.amount ?? cloneSeed().salary.buckets.emergency_reserve,
    )
    salary.value.settings.safety_pad_target = settings.value.rules.safety_cap
    if (!settings.value.fx_to_hkd.USDT) {
      settings.value.fx_to_hkd.USDT = settings.value.fx_to_hkd.USD
    }
    if (!settings.value.fx_to_hkd.SGD) {
      settings.value.fx_to_hkd.SGD = cloneSeed().settings.fx_to_hkd.SGD
    }
    syncYulibaoFromBuckets()
    syncCryptoYieldRates()
  }

  function importBackupJson(text: string) {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error('备份文件不是合法 JSON')
    }
    void withCloudAutoSyncMuted(() => {
      importBackup(parsed)
    })
  }

  /** 写入 public/pbfc-finance/（开发态 API），供 git commit / push */
  async function pushToGithubCloud(source = 'github-cloud') {
    const backup: FinanceCloudBackup = {
      ...exportBackup(),
      source,
    }
    await pushFinanceCloud(backup)
    setLocalCloudStamp(backup.exported_at)
    return backup
  }

  /** 从仓库云仓 JSON 覆盖本地 LocalStorage */
  async function pullFromGithubCloud(force = false) {
    const cloud = await fetchFinanceCloud()
    if (!cloud || cloud.data == null) {
      throw new Error('仓库云仓为空或尚未写入，请先在本机点「写入 GitHub 云仓」')
    }
    if (!force && !isCloudNewer(cloud)) {
      return { applied: false as const, cloud }
    }
    await withCloudAutoSyncMuted(() => {
      importBackup(cloud)
      setLocalCloudStamp(cloud.exported_at)
    })
    return { applied: true as const, cloud }
  }

  /** 启动时：若云仓比上次同步更新则自动拉取 */
  async function syncGithubCloudOnBoot() {
    try {
      return await withCloudAutoSyncMuted(() => pullFromGithubCloud(false))
    } catch {
      return { applied: false as const, cloud: null }
    }
  }

  function hydrateLegacyState() {
    settings.value = normalizeSettings(settings.value)
    accounts.value = normalizeAccounts(accounts.value)
    alignPoolClassification(settings.value, accounts.value)
    alignNeutralFundClassification(settings.value, accounts.value)
    yuanGou.value = normalizeYuanGou(yuanGou.value)
    cryptoOps.value = normalizeCryptoOps(cryptoOps.value)
    loans.value = normalizeLoans(loans.value)
    const yulibao = findRmbAccount('yulibao')
    salary.value = normalizeSalary(
      salary.value as SalaryState | undefined,
      yulibao?.amount ?? cloneSeed().salary.buckets.emergency_reserve,
    )
    // 同步 safety_cap
    salary.value.settings.safety_pad_target = settings.value.rules.safety_cap
    // USDT 汇率缺省跟 USD
    if (!settings.value.fx_to_hkd.USDT) {
      settings.value.fx_to_hkd.USDT = settings.value.fx_to_hkd.USD
    }
    if (!settings.value.fx_to_hkd.SGD) {
      settings.value.fx_to_hkd.SGD = cloneSeed().settings.fx_to_hkd.SGD
    }
    applyYuanGouKnownFixes()
    syncYulibaoFromBuckets()
    syncCryptoYieldRates()
  }

  return {
    resetToSeed,
    exportBackup,
    exportBackupJson,
    importBackup,
    importBackupJson,
    pushToGithubCloud,
    pullFromGithubCloud,
    syncGithubCloudOnBoot,
    hydrateLegacyState,
  }
}
