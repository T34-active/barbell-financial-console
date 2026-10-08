<script setup lang="ts">
import dayjs from 'dayjs'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useFinanceStore } from '@/stores/finance'
import { useTheme, type ThemeMode } from '@/composables/useTheme'
import { useQuoteColor, type QuoteColorScheme } from '@/composables/useQuoteColor'
import type { BaseCurrency, FunFundCarryoverRule, SalaryRatios } from '@/types/finance'
import { ratiosAreValid, sumRatios } from '@/utils/salary-allocation'
import { CURSOR_PRO_CHARGE_ID } from '@/utils/fun-fund-charge'
import { formatBeijingDateTime } from '@/utils/datetime'
import { div, mul, round } from '@/utils/decimal'
import { resolveFearGreedLabel } from '@/utils/fear-greed'
import FearGreedMeter from '@/components/summary/FearGreedMeter.vue'

const store = useFinanceStore()
const { mode: themeMode, setMode: setThemeMode } = useTheme()
const { scheme: quoteScheme, setScheme: setQuoteScheme } = useQuoteColor()

const baseCurrency = computed({
  get: () => store.settings.base_currency,
  set: (value: BaseCurrency) => store.updateSettings({ base_currency: value }),
})

const safetyLine = computed({
  get: () => store.settings.hsbc_safety_line,
  set: (value: number) => store.updateSettings({ hsbc_safety_line: value }),
})

const cnyRate = computed({
  get: () => store.settings.fx_to_hkd.CNY,
  set: (value: number) => store.updateFxRate('CNY', value),
})

const usdRate = computed({
  get: () => store.settings.fx_to_hkd.USD,
  set: (value: number) => store.updateFxRate('USD', value),
})

const sgdRate = computed({
  get: () => store.settings.fx_to_hkd.SGD,
  set: (value: number) => store.updateFxRate('SGD', value),
})

const fxLive = computed(() => store.settings.fx_live)
const fxRefreshing = ref(false)

async function handleRefreshFx(force = true) {
  fxRefreshing.value = true
  try {
    const result = await store.refreshLiveFxRates(force)
    if (result.updated) {
      ElMessage.success(
        `汇率已更新 · USD/CNH ${result.quotes.usd_cnh} · CNY/HKD ${result.quotes.cny_hkd}`,
      )
    } else {
      ElMessage.info('今日汇率已是最新，无需重复拉取')
    }
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
    else ElMessage.error('汇率拉取失败')
  } finally {
    fxRefreshing.value = false
  }
}

function formatFxTime(iso?: string | null) {
  if (!iso) return '尚未拉取'
  const d = dayjs(iso)
  if (!d.isValid()) return iso
  return d.format('YYYY-MM-DD HH:mm')
}

const safetyPadTarget = computed({
  get: () => store.settings.rules.safety_cap,
  set: (value: number) => store.updateRules({ safety_cap: value }),
})

const peGuardEnabled = computed({
  get: () => store.settings.rules.pe_guard_enabled,
  set: (value: boolean) => store.updateRules({ pe_guard_enabled: value }),
})

const peThreshold = computed({
  get: () => store.settings.rules.nasdaq_pe_threshold,
  set: (value: number) => store.updateRules({ nasdaq_pe_threshold: value }),
})

const peCurrent = computed({
  get: () => store.settings.rules.nasdaq_pe_current,
  set: (value: number) => store.updateRules({ nasdaq_pe_current: value }),
})

const peRefreshing = ref(false)

async function handleRefreshPe() {
  peRefreshing.value = true
  try {
    const quote = await store.refreshNasdaqPe()
    ElMessage.success(`纳指 PE 已更新为 ${quote.pe}（${quote.name} · 蛋卷估值）`)
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
    else ElMessage.error('纳指 PE 拉取失败')
  } finally {
    peRefreshing.value = false
  }
}

const avgPivot = computed({
  get: () => store.settings.rules.avg_pivot ?? 25,
  set: (value: number) => store.updateRules({ avg_pivot: value }),
})

const fearGreedIndex = computed({
  get: () => store.settings.rules.fear_greed_index ?? 50,
  set: (value: number) => store.updateRules({ fear_greed_index: value }),
})

const fearGreedLabel = computed(() =>
  resolveFearGreedLabel(fearGreedIndex.value, store.settings.rules.fear_greed_rating),
)

const peVsPivot = computed(() => {
  const pe = peCurrent.value
  const pivot = avgPivot.value
  if (!(pivot > 0)) return null
  const pct = round(mul(div(pe - pivot, pivot), 100), 1)
  return { pe, pivot, pct }
})

const fearGreedRefreshing = ref(false)

async function handleRefreshFearGreed() {
  fearGreedRefreshing.value = true
  try {
    const quote = await store.refreshFearGreedIndex()
    ElMessage.success(`恐贪指数已更新为 ${quote.score}（${quote.rating_zh} · CNN）`)
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
    else ElMessage.error('恐贪指数拉取失败')
  } finally {
    fearGreedRefreshing.value = false
  }
}

const carryoverRule = computed({
  get: () => store.settings.rules.carryover_rule,
  set: (value: FunFundCarryoverRule) => store.updateCarryoverRule(value),
})

const cursorCharge = computed(
  () =>
    store.salary.settings.fun_fund_charges?.find((item) => item.id === CURSOR_PRO_CHARGE_ID) ?? {
      id: CURSOR_PRO_CHARGE_ID,
      label: 'Cursor Pro',
      amount: 60,
      currency: 'USD' as const,
      billing_day: 28,
      enabled: true,
    },
)

const cursorChargeEnabled = computed({
  get: () => cursorCharge.value.enabled !== false,
  set: (value: boolean) => store.updateFunFundCharge(CURSOR_PRO_CHARGE_ID, { enabled: value }),
})

const cursorChargeUsd = computed({
  get: () => cursorCharge.value.amount,
  set: (value: number) => store.updateFunFundCharge(CURSOR_PRO_CHARGE_ID, { amount: value }),
})

const cursorBillingDay = computed({
  get: () => cursorCharge.value.billing_day,
  set: (value: number) => store.updateFunFundCharge(CURSOR_PRO_CHARGE_ID, { billing_day: value }),
})

const paydayDay = computed({
  get: () => store.settings.rules.payday_day ?? 10,
  set: (value: number) => store.updateRules({ payday_day: value }),
})

const paydayPostpone = computed({
  get: () => store.settings.rules.payday_postpone_weekend ?? true,
  set: (value: boolean) => store.updateRules({ payday_postpone_weekend: value }),
})

const htxThreshold = computed({
  get: () => store.settings.rules.htx_high_yield_threshold ?? 200,
  set: (value: number) => store.updateRules({ htx_high_yield_threshold: value }),
})

const okxYieldPercent = computed({
  get: () => mul(store.settings.rules.okx_yield_rate ?? 0.0224, 100),
  set: (value: number) => store.updateRules({ okx_yield_rate: div(value, 100) }),
})

const ratioParents = ref(mul(store.salary.settings.ratios.parents, 100))
const ratioSafety = ref(mul(store.salary.settings.ratios.safety_pad, 100))
const ratioUsSeed = ref(mul(store.salary.settings.ratios.us_seed, 100))
const ratioFun = ref(mul(store.salary.settings.ratios.fun_fund, 100))
const ratioTravel = ref(mul(store.salary.settings.ratios.travel_fund ?? 0, 100))

watch(
  () => store.salary.settings.ratios,
  (ratios) => {
    ratioParents.value = mul(ratios.parents, 100)
    ratioSafety.value = mul(ratios.safety_pad, 100)
    ratioUsSeed.value = mul(ratios.us_seed, 100)
    ratioFun.value = mul(ratios.fun_fund, 100)
    ratioTravel.value = mul(ratios.travel_fund ?? 0, 100)
  },
  { deep: true },
)

const draftRatios = computed<SalaryRatios>(() => ({
  parents: div(ratioParents.value, 100),
  safety_pad: div(ratioSafety.value, 100),
  us_seed: div(ratioUsSeed.value, 100),
  fun_fund: div(ratioFun.value, 100),
  travel_fund: div(ratioTravel.value, 100),
}))

const ratioSumPercent = computed(() => round(mul(sumRatios(draftRatios.value), 100), 2))

const ratiosValid = computed(() => ratiosAreValid(draftRatios.value))

function saveRatios() {
  try {
    store.updateSalaryRatios(draftRatios.value)
    ElMessage.success('工资分配比例已保存')
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
  }
}

async function handleReset() {
  try {
    await ElMessageBox.confirm('将清除本地修改并恢复为种子数据，是否继续？', '重置数据', {
      confirmButtonText: '重置',
      cancelButtonText: '取消',
      type: 'warning',
    })
    store.resetToSeed()
    ElMessage.success('已恢复初始数据')
  } catch {
    /* cancelled */
  }
}

function handleExportBackup() {
  try {
    const json = store.exportBackupJson()
    const stamp = dayjs().toISOString().slice(0, 10)
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pbfc-backup-${stamp}.json`
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success('已导出备份 JSON，请存到网盘或 U 盘')
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
  }
}

const cloudBusy = ref(false)

async function handlePushCloud() {
  cloudBusy.value = true
  try {
    const backup = await store.pushToGithubCloud()
    ElMessage.success(
      `已写入 public/pbfc-finance/（${backup.exported_at}）。请 git add/commit/push`,
    )
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
  } finally {
    cloudBusy.value = false
  }
}

async function handlePullCloud() {
  cloudBusy.value = true
  try {
    await ElMessageBox.confirm(
      '将用仓库里的 public/pbfc-finance/ 覆盖当前浏览器 LocalStorage，是否继续？',
      '从 GitHub 云仓拉取',
      { confirmButtonText: '覆盖拉取', cancelButtonText: '取消', type: 'warning' },
    )
    const result = await store.pullFromGithubCloud(true)
    if (result.applied) {
      ElMessage.success(`已拉取云仓（${result.cloud.exported_at}），页面数据已更新`)
    }
  } catch (error) {
    if (error instanceof Error && error.message) {
      ElMessage.error(error.message)
    }
  } finally {
    cloudBusy.value = false
  }
}

const importInputRef = ref<HTMLInputElement | null>(null)

function triggerImport() {
  importInputRef.value?.click()
}

async function handleImportFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  try {
    await ElMessageBox.confirm(
      `将用「${file.name}」覆盖当前 LocalStorage 全部财务数据，是否继续？建议先导出一份当前备份。`,
      '导入备份',
      {
        confirmButtonText: '覆盖导入',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
    const text = await file.text()
    store.importBackupJson(text)
    ElMessage.success('备份已导入并恢复')
  } catch (error) {
    if (error instanceof Error && error.message) {
      ElMessage.error(error.message)
    }
  }
}
</script>

<template>
  <div class="space-y-5">
    <div>
      <h1 class="section-title">系统设置</h1>
      <p class="mt-1 text-sm text-ink-muted">计价、规则保险丝、结转策略与分配比例</p>
    </div>

    <div class="grid gap-5 lg:grid-cols-2 lg:items-start">
      <section class="panel space-y-5 px-4 py-5 md:px-6">
        <div>
          <label class="mb-2 block text-sm text-ink-muted">外观</label>
          <el-radio-group
            :model-value="themeMode"
            @update:model-value="(v) => setThemeMode(v as ThemeMode)"
          >
            <el-radio-button value="light">白天</el-radio-button>
            <el-radio-button value="dark">黑夜</el-radio-button>
            <el-radio-button value="system">跟随系统</el-radio-button>
          </el-radio-group>
          <p class="mt-1 text-xs text-ink-muted">顶栏图标也可切换；偏好保存在本机 pbfc-theme</p>
        </div>

        <div>
          <label class="mb-2 block text-sm text-ink-muted">涨跌配色</label>
          <el-radio-group
            :model-value="quoteScheme"
            @update:model-value="(v) => setQuoteScheme(v as QuoteColorScheme)"
          >
            <el-radio-button value="cn">红涨绿跌</el-radio-button>
            <el-radio-button value="us">绿涨红跌</el-radio-button>
          </el-radio-group>
          <p class="mt-1 text-xs text-ink-muted">
            A 股惯例红涨绿跌，欧美惯例绿涨红跌；偏好保存在本机 pbfc-quote-color
          </p>
          <p class="mt-2 text-xs">
            预览
            <span class="ml-1 font-medium text-up">+1.24%</span>
            <span class="ml-2 font-medium text-down">-0.86%</span>
          </p>
        </div>

        <div>
          <label class="mb-2 block text-sm text-ink-muted">基准币种</label>
          <el-radio-group v-model="baseCurrency">
            <el-radio-button value="HKD">HKD</el-radio-button>
            <el-radio-button value="CNY">CNY</el-radio-button>
            <el-radio-button value="USD">USD</el-radio-button>
          </el-radio-group>
        </div>

        <div>
          <label class="mb-2 block text-sm text-ink-muted">汇丰安全红线（HKD）</label>
          <AmountInput v-model="safetyLine" :min="0" class="w-full!" />
        </div>

        <div class="rounded-lg border border-accent/25 bg-accent-soft/30 px-3 py-3">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p class="text-sm font-semibold text-accent">全局实时汇率</p>
              <p class="mt-1 text-xs text-ink-muted">
                写入 Pinia / LocalStorage，总览·账户·工资估值全站共用；顶部栏同步显示。 USD/CNH ·
                CNY/HKD · SGD/HKD · 跨日自动刷新
              </p>
            </div>
            <el-button
              type="primary"
              size="small"
              :loading="fxRefreshing"
              @click="handleRefreshFx(true)"
            >
              立即刷新
            </el-button>
          </div>
          <div class="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3 lg:grid-cols-5">
            <div>
              <p class="text-ink-muted">USD / CNH</p>
              <p class="stat-num mt-0.5 text-base font-semibold">
                {{ fxLive?.usd_cnh?.toFixed(4) ?? '—' }}
              </p>
            </div>
            <div>
              <p class="text-ink-muted">CNY / HKD</p>
              <p class="stat-num mt-0.5 text-base font-semibold">
                {{ fxLive?.cny_hkd?.toFixed(4) ?? '—' }}
              </p>
            </div>
            <div>
              <p class="text-ink-muted">USD / HKD（交叉）</p>
              <p class="stat-num mt-0.5 text-base font-semibold">
                {{ fxLive?.usd_hkd?.toFixed(4) ?? '—' }}
              </p>
            </div>
            <div>
              <p class="text-ink-muted">SGD / HKD</p>
              <p class="stat-num mt-0.5 text-base font-semibold">
                {{ fxLive?.sgd_hkd?.toFixed(4) ?? store.settings.fx_to_hkd.SGD.toFixed(4) }}
              </p>
            </div>
            <div>
              <p class="text-ink-muted">更新时间</p>
              <p class="mt-0.5 font-medium">
                {{ formatFxTime(fxLive?.fetched_at) }}
              </p>
              <p class="mt-0.5 text-ink-muted">
                {{ fxLive ? `${fxLive.as_of} · ${fxLive.source}` : '点击刷新获取' }}
              </p>
            </div>
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-3">
          <div>
            <label class="mb-2 block text-sm text-ink-muted">1 CNY = ? HKD（可手改）</label>
            <el-input-number
              v-model="cnyRate"
              :min="0.01"
              :step="0.01"
              :precision="4"
              controls-position="right"
              class="w-full!"
            />
          </div>
          <div>
            <label class="mb-2 block text-sm text-ink-muted">1 USD = ? HKD（可手改）</label>
            <el-input-number
              v-model="usdRate"
              :min="0.01"
              :step="0.01"
              :precision="4"
              controls-position="right"
              class="w-full!"
            />
          </div>
          <div>
            <label class="mb-2 block text-sm text-ink-muted">1 SGD = ? HKD（可手改）</label>
            <el-input-number
              v-model="sgdRate"
              :min="0.01"
              :step="0.01"
              :precision="4"
              controls-position="right"
              class="w-full!"
            />
          </div>
        </div>
      </section>

      <section class="panel space-y-5 px-4 py-5 md:px-6">
        <div>
          <h2 class="text-base font-semibold">规则与保险丝</h2>
          <p class="mt-1 text-sm text-ink-muted">
            安全垫目标、快乐基金结转、纳指高估观察仓、估值中枢与恐贪指数
          </p>
        </div>

        <div>
          <label class="mb-2 block text-sm text-ink-muted">安全垫目标 safety_cap（CNY）</label>
          <AmountInput v-model="safetyPadTarget" :min="0" class="w-full!" />
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="mb-2 block text-sm text-ink-muted">HTX 高息阈值（USDT）</label>
            <AmountInput v-model="htxThreshold" :min="1" :precision="0" class="w-full!" />
            <p class="mt-1 text-xs text-ink-muted">
              余额 &lt; 阈值享 10%；≥ 阈值降为 1.5%，触发溢流至 OKX
            </p>
          </div>
          <div>
            <label class="mb-2 block text-sm text-ink-muted">OKX 活期年化（%）</label>
            <el-input-number
              v-model="okxYieldPercent"
              :min="0"
              :max="100"
              :step="0.01"
              :precision="2"
              controls-position="right"
              class="w-full!"
            />
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="mb-2 block text-sm text-ink-muted">名义发薪日（每月几号）</label>
            <el-input-number
              v-model="paydayDay"
              :min="1"
              :max="28"
              :step="1"
              controls-position="right"
              class="w-full!"
            />
          </div>
          <div class="flex flex-col justify-end">
            <div class="flex items-center justify-between rounded-lg bg-surface px-3 py-3">
              <div>
                <p class="text-sm font-medium">周末顺延</p>
                <p class="mt-1 text-xs text-ink-muted">落周六/日则顺延到周一</p>
              </div>
              <el-switch v-model="paydayPostpone" />
            </div>
          </div>
        </div>

        <div>
          <label class="mb-2 block text-sm text-ink-muted">快乐基金月末结转</label>
          <el-radio-group v-model="carryoverRule">
            <el-radio value="split_50_50">50/50 安全垫 + 进攻</el-radio>
            <el-radio value="surplus_happy_fund_to_offensive">全额进攻（奖励节俭）</el-radio>
          </el-radio-group>
        </div>

        <div class="rounded-lg bg-surface px-3 py-3">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="text-sm font-medium">Cursor Pro 从快乐基金扣</p>
              <p class="mt-1 text-xs text-ink-muted">每月先从快乐基金扣，这笔是公司报销</p>
            </div>
            <el-switch v-model="cursorChargeEnabled" />
          </div>
          <div class="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label class="mb-1 block text-xs text-ink-muted">月费（USD）</label>
              <AmountInput
                v-model="cursorChargeUsd"
                :min="1"
                :precision="0"
                class="w-full!"
                :disabled="!cursorChargeEnabled"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs text-ink-muted">扣款日</label>
              <el-input-number
                v-model="cursorBillingDay"
                :min="1"
                :max="28"
                :step="1"
                controls-position="right"
                class="w-full!"
                :disabled="!cursorChargeEnabled"
              />
            </div>
          </div>
        </div>

        <div class="rounded-lg bg-surface px-3 py-3">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="text-sm font-medium">美股高估保险丝（PE Guard）</p>
              <p class="mt-1 text-xs text-ink-muted">
                当前 PE 高于阈值时，进攻份额进现金观察仓而非美股种子
              </p>
            </div>
            <el-switch v-model="peGuardEnabled" />
          </div>
          <div class="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label class="mb-1 block text-xs text-ink-muted">纳指 PE 阈值</label>
              <el-input-number
                v-model="peThreshold"
                :min="1"
                :step="1"
                :precision="1"
                controls-position="right"
                class="w-full!"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs text-ink-muted">当前纳指 PE</label>
              <div class="flex flex-wrap items-center gap-2">
                <el-input-number
                  v-model="peCurrent"
                  :min="1"
                  :step="0.1"
                  :precision="1"
                  controls-position="right"
                  class="w-40!"
                />
                <el-button :loading="peRefreshing" @click="handleRefreshPe">拉取</el-button>
              </div>
              <p
                v-if="store.settings.rules.nasdaq_pe_updated_at"
                class="mt-1 text-[11px] text-ink-muted"
              >
                拉取于
                {{ formatBeijingDateTime(store.settings.rules.nasdaq_pe_updated_at) }}
                （北京时间）
              </p>
            </div>
          </div>
          <div
            class="mt-4 rounded-lg border border-surface-line px-3 py-3 text-xs leading-6 text-ink-muted"
          >
            <p class="font-medium text-ink">PE 公式（点「拉取」从蛋卷基金取纳指100估值）</p>
            <p class="stat-num mt-2 text-ink">个股 PE = 股价 / 每股收益（EPS）</p>
            <p class="stat-num mt-1 text-ink">
              纳指 PE ≈ 成分股市值合计 / 成分股近 12 个月盈利合计
            </p>
            <p class="mt-2">
              本控制台判定：保险丝开启 且 当前纳指 PE &gt; 阈值 → 进攻份额进观察仓。 当前
              {{ peCurrent }} {{ peCurrent > peThreshold ? '>' : '≤' }} 阈值 {{ peThreshold }}，
              {{
                peGuardEnabled
                  ? peCurrent > peThreshold
                    ? '观察仓生效'
                    : '未触发'
                  : '保险丝已关闭'
              }}。
            </p>
          </div>
        </div>

        <div class="rounded-lg bg-surface px-3 py-3">
          <div>
            <p class="text-sm font-medium">估值平均中枢 &amp; 恐贪指数</p>
            <p class="mt-1 text-xs text-ink-muted">
              中枢作估值锚点（对比当前 PE）；恐贪指数来自 CNN Fear &amp;
              Greed（0–100），可手改或拉取
            </p>
          </div>
          <div class="mt-4 grid gap-4 lg:grid-cols-2 lg:items-start">
            <div>
              <label class="mb-1 block text-xs text-ink-muted">平均中枢（纳指估值 PE）</label>
              <el-input-number
                v-model="avgPivot"
                :min="1"
                :step="0.1"
                :precision="1"
                controls-position="right"
                class="w-full!"
              />
              <p v-if="peVsPivot" class="mt-1 text-[11px] text-ink-muted">
                当前 PE {{ peVsPivot.pe }} 相对中枢 {{ peVsPivot.pivot }}：
                <span :class="peVsPivot.pct > 0 ? 'text-alert' : 'text-safe'">
                  {{ peVsPivot.pct > 0 ? '+' : '' }}{{ peVsPivot.pct }}%
                </span>
              </p>
              <label class="mb-1 mt-4 block text-xs text-ink-muted">
                恐贪指数（0–100，可手改）
              </label>
              <div class="flex flex-wrap items-center gap-2">
                <el-input-number
                  v-model="fearGreedIndex"
                  :min="0"
                  :max="100"
                  :step="0.1"
                  :precision="1"
                  controls-position="right"
                  class="w-40!"
                />
                <el-button :loading="fearGreedRefreshing" @click="handleRefreshFearGreed">
                  拉取
                </el-button>
              </div>
              <p class="mt-1 text-[11px] text-ink-muted">
                <span v-if="store.settings.rules.fear_greed_updated_at">
                  拉取于
                  {{ formatBeijingDateTime(store.settings.rules.fear_greed_updated_at) }}
                </span>
                <span v-else>半圆从左到右：极度恐惧 → 极度贪婪</span>
              </p>
            </div>
            <div class="rounded-lg bg-surface/40 px-3 py-2">
              <FearGreedMeter :score="fearGreedIndex" :label="fearGreedLabel" />
            </div>
          </div>
          <div
            class="mt-3 rounded-lg border border-surface-line px-3 py-2 text-[11px] leading-5 text-ink-muted"
          >
            <p>
              半圆弧从左到右：绿 极度恐惧 → 黄 中性 → 红 极度贪婪。 指针落在弧上的位置即当前分数。
            </p>
            <p class="mt-1">
              中枢仅作参考锚点，不自动改分配；保险丝仍按「当前 PE &gt; 阈值」判定。
            </p>
          </div>
        </div>

        <div class="rounded-lg border border-surface-line px-3 py-3 text-xs text-ink-muted">
          <p class="font-medium text-ink">资产分类（只读种子）</p>
          <p class="mt-2">安全：{{ store.settings.asset_classification.safe_assets.join(', ') }}</p>
          <p class="mt-1">
            进攻：{{ store.settings.asset_classification.offensive_assets.join(', ') }}
          </p>
          <p class="mt-1">
            中性：{{ store.settings.asset_classification.neutral_assets.join(', ') }}
          </p>
          <p class="mt-1">
            加密赌注：{{ (store.settings.asset_classification.crypto_assets ?? []).join(', ') }}
          </p>
        </div>
      </section>

      <section class="panel space-y-5 px-4 py-5 md:px-6">
        <div>
          <h2 class="text-base font-semibold">工资分配比例</h2>
          <p class="mt-1 text-sm text-ink-muted">五项合计须为 100%</p>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="mb-2 block text-sm text-ink-muted">给爸妈（%）</label>
            <el-input-number
              v-model="ratioParents"
              :min="0"
              :max="100"
              :step="1"
              :precision="1"
              controls-position="right"
              class="w-full!"
            />
            <p class="mt-1 text-xs text-ink-muted">
              金额按比例总额入账；转账时爸妈一人一半（奇数分归第二笔）
            </p>
          </div>
          <div>
            <label class="mb-2 block text-sm text-ink-muted">安全垫（%）</label>
            <el-input-number
              v-model="ratioSafety"
              :min="0"
              :max="100"
              :step="1"
              :precision="1"
              controls-position="right"
              class="w-full!"
            />
          </div>
          <div>
            <label class="mb-2 block text-sm text-ink-muted">美股种子（%）</label>
            <el-input-number
              v-model="ratioUsSeed"
              :min="0"
              :max="100"
              :step="1"
              :precision="1"
              controls-position="right"
              class="w-full!"
            />
          </div>
          <div>
            <label class="mb-2 block text-sm text-ink-muted">快乐基金（%）</label>
            <el-input-number
              v-model="ratioFun"
              :min="0"
              :max="100"
              :step="1"
              :precision="1"
              controls-position="right"
              class="w-full!"
            />
          </div>
          <div>
            <label class="mb-2 block text-sm text-ink-muted">旅游基金（%）</label>
            <el-input-number
              v-model="ratioTravel"
              :min="0"
              :max="100"
              :step="1"
              :precision="1"
              controls-position="right"
              class="w-full!"
            />
            <p class="mt-1 text-xs text-ink-muted">
              出行专项，先暂存余利宝吃利息；不计入储蓄率。默认 0%，请从其他项腾出比例
            </p>
          </div>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3">
          <p class="text-sm" :class="ratiosValid ? 'text-safe' : 'text-alert'">
            合计 {{ ratioSumPercent }}%
            {{ ratiosValid ? '· 可保存' : '· 须等于 100%' }}
          </p>
          <el-button type="primary" :disabled="!ratiosValid" @click="saveRatios">
            保存比例
          </el-button>
        </div>
      </section>

      <div class="space-y-5">
        <section class="panel space-y-4 px-4 py-5 md:px-6">
          <div>
            <h2 class="text-base font-semibold">GitHub 云仓</h2>
            <p class="mt-1 text-sm text-ink-muted">
              在
              <code class="text-ink">pnpm dev</code>
              下，每次改余额/设置等操作会自动防抖写入
              <code class="text-ink">public/pbfc-finance/</code>
              。然后 git commit / push 即可；回家 pull 后打开应用会自动拉较新版本。请用
              <strong>私有仓库</strong>
              。
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <el-button type="primary" :loading="cloudBusy" @click="handlePushCloud">
              立即写入云仓
            </el-button>
            <el-button :loading="cloudBusy" @click="handlePullCloud">从云仓拉取覆盖</el-button>
          </div>
        </section>

        <section class="panel space-y-4 px-4 py-5 md:px-6">
          <div>
            <h2 class="text-base font-semibold">数据备份</h2>
            <p class="mt-1 text-sm text-ink-muted">
              LocalStorage 键名：pbfc-finance。也可导出/导入独立 JSON 文件做额外备份。
            </p>
          </div>

          <div class="flex flex-wrap gap-2">
            <el-button type="primary" @click="handleExportBackup">导出备份 JSON</el-button>
            <el-button @click="triggerImport">导入备份 JSON</el-button>
            <input
              ref="importInputRef"
              type="file"
              accept="application/json,.json"
              class="hidden"
              @change="handleImportFile"
            />
          </div>

          <el-button type="danger" plain @click="handleReset">重置为种子数据</el-button>
        </section>
      </div>
    </div>
  </div>
</template>
