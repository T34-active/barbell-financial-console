<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { useFinanceStore } from '@/stores/finance'
import { formatMoney } from '@/utils/currency'
import { formatBeijingDateTime } from '@/utils/datetime'
import { add, mul, round } from '@/utils/decimal'
import { resolveFearGreedLabel } from '@/utils/fear-greed'
import FearGreedMeter from '@/components/summary/FearGreedMeter.vue'

const store = useFinanceStore()
const peRefreshing = ref(false)

const progressPercent = computed(() =>
  round(mul(store.safetyPadProgress.ratio, 100), 0),
)

const peCurrent = computed(() => store.settings.rules.nasdaq_pe_current)
const peThreshold = computed(() => store.settings.rules.nasdaq_pe_threshold)
const peEnabled = computed(() => store.settings.rules.pe_guard_enabled)
const peUpdatedAt = computed(() => store.settings.rules.nasdaq_pe_updated_at)
const peOver = computed(() => peCurrent.value > peThreshold.value)
const peStatusText = computed(() => {
  if (!peEnabled.value) return '已关闭'
  return peOver.value ? '观察仓生效' : '未触发'
})
const avgPivot = computed(() => store.settings.rules.avg_pivot ?? 25)
const fearGreedIndex = computed(() => store.settings.rules.fear_greed_index ?? 50)
const fearGreedLabel = computed(() =>
  resolveFearGreedLabel(
    fearGreedIndex.value,
    store.settings.rules.fear_greed_rating,
  ),
)

const yulibaoTotal = computed(() =>
  add(
    store.emergencyReserve,
    store.usSeedParking,
    store.cashObservation,
    store.travelFundPocket,
  ),
)

const buckets = computed(() => {
  const items = [
    { key: 'emergency', label: '应急', value: store.emergencyReserve },
    { key: 'seed', label: '种子暂存', value: store.usSeedParking },
  ]
  if (store.travelFundPocket > 0) {
    items.push({
      key: 'travel',
      label: '旅游暂存',
      value: store.travelFundPocket,
    })
  }
  if (store.cashObservation > 0) {
    items.push({
      key: 'observe',
      label: '观察仓',
      value: store.cashObservation,
    })
  }
  items.push({ key: 'total', label: '余利宝合计', value: yulibaoTotal.value })
  return items
})

async function handleRefreshPe() {
  peRefreshing.value = true
  try {
    const quote = await store.refreshNasdaqPe()
    ElMessage.success(`纳指 PE 已更新为 ${quote.pe}`)
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message)
    else ElMessage.error('纳指 PE 拉取失败')
  } finally {
    peRefreshing.value = false
  }
}
</script>

<template>
  <section class="panel overflow-hidden">
    <div class="grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,22rem)]">
      <div class="px-5 py-5 md:px-6">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p class="text-xs text-ink-muted">应急备用金</p>
            <p class="stat-num mt-1 text-2xl font-semibold md:text-3xl">
              {{ formatMoney(store.safetyPadProgress.current, 'CNY') }}
            </p>
            <p class="mt-1 text-xs text-ink-muted">
              目标
              {{ formatMoney(store.safetyPadProgress.target, 'CNY', { digits: 0 }) }}
              · {{ store.allocationModeLabel }}
            </p>
          </div>
          <span
            class="rounded-full px-2.5 py-1 text-xs font-medium"
            :class="
              store.isSafetyPadFull
                ? 'bg-safe-soft text-safe'
                : 'bg-risk-soft text-risk'
            "
          >
            {{ store.isSafetyPadFull ? '已满 · 转进攻' : '未满 · 先补仓' }}
          </span>
        </div>

        <div class="mt-4 flex items-center gap-3">
          <div class="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface">
            <div
              class="h-full rounded-full transition-all duration-500"
              :class="store.isSafetyPadFull ? 'bg-safe' : 'bg-risk'"
              :style="{ width: `${progressPercent}%` }"
            />
          </div>
          <span class="stat-num w-10 shrink-0 text-right text-xs text-ink-muted">
            {{ progressPercent }}%
          </span>
        </div>

        <p class="mt-2 text-xs text-ink-muted">
          <template v-if="!store.isSafetyPadFull">
            还差
            {{ formatMoney(store.safetyPadProgress.gap, 'CNY') }}
            ，下月工资优先回补
          </template>
          <template v-else>
            已满。本月安全垫份额并入进攻端；跌破目标后自动回溯补仓
          </template>
        </p>

        <div class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div
            v-for="item in buckets"
            :key="item.key"
            class="rounded-lg bg-surface px-3 py-2.5"
          >
            <p class="text-[11px] text-ink-muted">{{ item.label }}</p>
            <p class="stat-num mt-0.5 text-sm font-semibold">
              {{ formatMoney(item.value, 'CNY') }}
            </p>
          </div>
        </div>
        <p class="mt-2 text-[11px] text-ink-muted">
          快乐基金另计口袋，不进余利宝；旅游基金暂存在余利宝吃利息
        </p>
      </div>

      <div
        class="flex min-w-0 flex-col justify-between overflow-hidden border-t border-surface-line px-5 py-5 lg:border-l lg:border-t-0"
      >
        <div class="min-w-0">
          <p class="text-xs text-ink-muted">恐贪指数</p>
          <FearGreedMeter
            class="mt-3"
            :score="fearGreedIndex"
            :label="fearGreedLabel"
          />
        </div>

        <div class="mt-4 flex items-end justify-between gap-3">
          <div>
            <p class="text-xs text-ink-muted">纳指 PE</p>
            <p class="stat-num mt-0.5 text-lg font-semibold">
              <span :class="peEnabled && peOver ? 'text-risk' : 'text-ink'">
                {{ peCurrent }}
              </span>
              <span class="text-sm font-normal text-ink-muted">
                / {{ peThreshold }}
              </span>
            </p>
            <p
              class="mt-0.5 text-[11px]"
              :class="peEnabled && peOver ? 'text-risk' : 'text-ink-muted'"
            >
              {{ peStatusText }} · 中枢 {{ avgPivot }}
              <template v-if="peUpdatedAt">
                · {{ formatBeijingDateTime(peUpdatedAt) }}
              </template>
            </p>
          </div>
          <el-button size="small" :loading="peRefreshing" @click="handleRefreshPe">
            拉取
          </el-button>
        </div>
      </div>
    </div>
  </section>
</template>
