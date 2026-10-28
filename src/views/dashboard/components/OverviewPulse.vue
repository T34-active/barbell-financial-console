<script setup lang="ts">
import { useFinanceStore } from '@/stores/finance'
import { useFinanceFormat } from '@/composables/useFinanceFormat'
import { resolveFearGreedLabel } from '@/utils/fear-greed'
import { quoteToneClass } from '@/composables/useQuoteColor'

const store = useFinanceStore()
const { money, percent } = useFinanceFormat()

const pad = computed(() => store.safetyPadProgress)
const rules = computed(() => store.settings.rules)

const peText = computed(() => {
  if (!rules.value.pe_guard_enabled) return '已关闭'
  return store.isPeGuardActive ? '观察仓生效' : '未触发'
})

const fearScore = computed(() => rules.value.fear_greed_index ?? 50)
const fearLabel = computed(() =>
  resolveFearGreedLabel(fearScore.value, rules.value.fear_greed_rating),
)

const peVsPivot = computed(() => {
  const pe = rules.value.nasdaq_pe_current
  const pivot = rules.value.avg_pivot ?? 25
  if (!(pivot > 0)) return null
  const pct = ((pe - pivot) / pivot) * 100
  return { pe, pivot, pct }
})

const openLoanCount = computed(
  () => store.loans.items.filter((item) => item.status === 'open' || item.status === 'partial').length,
)
</script>

<template>
  <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
    <div class="panel space-y-2 px-4 py-3">
      <p class="text-xs text-ink-muted">安全垫进度</p>
      <p class="stat-num text-lg font-semibold">
        {{ money(pad.current) }}
        <span class="text-sm font-normal text-ink-muted">/ {{ money(pad.target) }}</span>
      </p>
      <el-progress
        :percentage="Math.round(pad.ratio * 100)"
        :stroke-width="8"
        :status="store.isSafetyPadFull ? 'success' : undefined"
      />
      <p class="text-xs text-ink-muted">
        {{ store.isSafetyPadFull ? '已达标' : `还差 ${money(pad.gap)}` }}
      </p>
    </div>

    <div class="panel space-y-2 px-4 py-3">
      <p class="text-xs text-ink-muted">美股高估保险丝</p>
      <p class="stat-num text-lg font-semibold" :class="store.isPeGuardActive ? 'text-alert' : 'text-ink'">
        {{ peText }}
      </p>
      <p class="text-xs text-ink-muted">
        当前 PE {{ rules.nasdaq_pe_current }} · 阈值 {{ rules.nasdaq_pe_threshold }}
      </p>
      <p v-if="peVsPivot" class="text-xs text-ink-muted">
        相对中枢 {{ peVsPivot.pivot }}：
        <span :class="quoteToneClass(peVsPivot.pct)">
          {{ peVsPivot.pct > 0 ? '+' : '' }}{{ peVsPivot.pct.toFixed(1) }}%
        </span>
      </p>
    </div>

    <div class="panel space-y-2 px-4 py-3">
      <p class="text-xs text-ink-muted">恐贪指数</p>
      <p class="stat-num text-lg font-semibold">
        {{ fearScore.toFixed(0) }}
        <span class="text-sm font-normal text-ink-muted">· {{ fearLabel }}</span>
      </p>
      <el-progress
        :percentage="Math.min(Math.max(fearScore, 0), 100)"
        :stroke-width="8"
        :color="fearScore >= 75 ? 'var(--alert)' : fearScore <= 25 ? 'var(--safe)' : 'var(--accent)'"
      />
      <p class="text-xs text-ink-muted">0 极度恐惧 → 100 极度贪婪</p>
    </div>

    <div class="panel space-y-2 px-4 py-3">
      <p class="text-xs text-ink-muted">工资分桶口袋</p>
      <div class="grid grid-cols-2 gap-2 text-xs">
        <div>
          <p class="text-ink-muted">观察仓</p>
          <p class="stat-num mt-0.5 font-semibold">{{ money(store.cashObservation) }}</p>
        </div>
        <div>
          <p class="text-ink-muted">美股种子</p>
          <p class="stat-num mt-0.5 font-semibold">{{ money(store.usSeedParking) }}</p>
        </div>
        <div>
          <p class="text-ink-muted">快乐基金</p>
          <p class="stat-num mt-0.5 font-semibold">{{ money(store.funFundPocket) }}</p>
        </div>
        <div>
          <p class="text-ink-muted">旅行基金</p>
          <p class="stat-num mt-0.5 font-semibold">{{ money(store.travelFundPocket) }}</p>
        </div>
      </div>
    </div>

    <div class="panel space-y-2 px-4 py-3">
      <p class="text-xs text-ink-muted">借出 / 应收</p>
      <p class="stat-num text-lg font-semibold text-accent">
        {{ money(store.openLendReceivableValue) }}
      </p>
      <p class="text-xs text-ink-muted">{{ openLoanCount }} 笔在途</p>
      <RouterLink
        to="/accounts/rmb"
        class="inline-block text-xs font-medium text-accent underline-offset-2 hover:underline"
      >
        去账户明细 →
      </RouterLink>
    </div>

    <div class="panel space-y-2 px-4 py-3">
      <p class="text-xs text-ink-muted">加密赌注池</p>
      <p class="stat-num text-lg font-semibold">{{ money(store.cryptoPoolValue) }}</p>
      <p class="text-xs text-ink-muted">
        分配模式 · {{ store.allocationModeLabel || '—' }}
      </p>
      <p class="text-xs text-ink-muted">
        哑铃进取占比 {{ percent(store.barbell.riskRatio) }}
      </p>
    </div>
  </section>
</template>
