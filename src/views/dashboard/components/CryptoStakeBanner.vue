<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import { useFinanceStore } from '@/stores/finance'
import { formatMoney, formatPercent } from '@/utils/currency'
import { add } from '@/utils/decimal'
import HtxDailyYieldDialog from '@/components/accounts/HtxDailyYieldDialog.vue'

const store = useFinanceStore()
const now = useNow({ interval: 1000 })
const status = computed(() => store.htxYieldAt(now.value))
const yieldDialogVisible = ref(false)

async function handleOverflow() {
  try {
    const plan = status.value.plan
    if (!plan.needsAction) {
      ElMessage.info(plan.reason)
      return
    }
    if (!plan.canExecute) {
      ElMessage.warning(plan.reason)
      return
    }
    await ElMessageBox.confirm(
      `将溢出 ${plan.transferAmount} USDT 转至 OKX，HTX 锁定为 ${plan.htxAfter} U？`,
      '执行溢流转存',
      { confirmButtonText: '确认转存', cancelButtonText: '取消', type: 'warning' },
    )
    const result = store.rebalanceHtxOverflow()
    if (result.executed) {
      ElMessage.success(`已转存 ${result.transferAmount} USDT → OKX`)
    } else {
      ElMessage.warning(result.reason)
    }
  } catch (error) {
    if (error instanceof Error && error.message) {
      ElMessage.error(error.message)
    }
  }
}
</script>

<template>
  <section
    class="panel accent-bar px-4 py-3"
    :class="status.highYield ? 'border-l-safe' : 'border-l-alert'"
  >
    <div class="flex flex-col gap-1.5">
      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p class="text-sm font-medium">加密赌注池</p>
        <p class="stat-num text-xs text-ink-muted">
          HTX {{ formatMoney(store.htxEarnUsdt, 'USDT') }} · OKX
          {{ formatMoney(store.okxEarnUsdt, 'USDT') }} · 合计
          {{ formatMoney(add(store.htxEarnUsdt, store.okxEarnUsdt), 'USDT') }}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <p
          class="flex items-center gap-1.5 text-xs font-medium"
          :class="status.highYield ? 'text-safe' : 'text-alert'"
        >
          <span class="status-dot bg-current" />
          {{ status.label }}
        </p>
        <el-button
          v-if="status.plan.needsAction"
          size="small"
          :type="status.plan.canExecute ? 'danger' : 'info'"
          :disabled="!status.plan.canExecute"
          @click="handleOverflow"
        >
          {{ status.plan.canExecute ? '溢流转存' : '溢出不足 2U' }}
        </el-button>
      </div>
    </div>
    <p class="hint stat-num mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
      <span>HTX 年化 {{ formatPercent(status.rate) }}</span>
      <span>每小时 {{ formatMoney(status.hourly, 'USDT', { digits: 8 }) }}</span>
      <button
        type="button"
        class="cursor-pointer text-ink-muted underline decoration-dotted underline-offset-2 hover:text-ink"
        @click="yieldDialogVisible = true"
      >
        今日 {{ formatMoney(status.daily, 'USDT', { digits: 8 }) }}
      </button>
      <span>阈值 {{ status.threshold }} U</span>
      <span>OKX 年化 {{ formatPercent(store.settings.rules.okx_yield_rate) }}</span>
    </p>
    <HtxDailyYieldDialog
      v-model:visible="yieldDialogVisible"
      :rows="status.hourlyLedger"
      :total="status.daily"
      :waiting-first-payout="status.waitingFirstPayout"
    />
  </section>
</template>
