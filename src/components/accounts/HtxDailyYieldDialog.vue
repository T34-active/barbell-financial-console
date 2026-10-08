<script setup lang="ts">
import { formatMoney } from '@/utils/currency'
import { formatBeijingHourLabel } from '@/utils/datetime'
import type { HtxHourlyLedgerRow } from '@/utils/htx-rebalance'
import FormulaTooltip from '@/components/accounts/FormulaTooltip.vue'

const props = withDefaults(
  defineProps<{
    visible: boolean
    rows: HtxHourlyLedgerRow[]
    total: number
    waitingFirstPayout?: boolean
  }>(),
  { waitingFirstPayout: false },
)

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value),
})
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    title="HTX 24 小时收益"
    width="920px"
    align-center
    destroy-on-close
    class="htx-yield-dialog"
  >
    <p class="mb-3 text-xs text-ink-muted">
      北京时间当日 00:00 至 24:00；当前整点对齐 HTX 小时收益，此前倒推、此后复投。
    </p>
    <el-table :data="rows" stripe size="small" max-height="70vh" class="w-full">
      <el-table-column min-width="140">
        <template #header>
          <FormulaTooltip>
            发放时间
            <template #content>
              <p>每个北京时间整点发放上一小时利息</p>
            </template>
          </FormulaTooltip>
        </template>
        <template #default="{ row }">
          {{ formatBeijingHourLabel(row.paidAt) }}
        </template>
      </el-table-column>
      <el-table-column min-width="130" align="right">
        <template #header>
          <FormulaTooltip>
            本小时收益
            <template #content>
              <p>ROUND_UP(当时本金 × 时利率, 8 位)</p>
              <p>时利率 = 年化 ÷ 8760，先四舍五入到 9 位</p>
            </template>
          </FormulaTooltip>
        </template>
        <template #default="{ row }">
          {{ formatMoney(row.interest, 'USDT', { digits: 8 }) }}
        </template>
      </el-table-column>
      <el-table-column min-width="130" align="right">
        <template #header>
          <FormulaTooltip>
            复投后本金
            <template #content>
              <p>复投后本金 = 发放前本金 + 本小时收益</p>
            </template>
          </FormulaTooltip>
        </template>
        <template #default="{ row }">
          {{ formatMoney(row.principalAfter, 'USDT', { digits: 8 }) }}
        </template>
      </el-table-column>
      <el-table-column label="状态" min-width="80">
        <template #default="{ row }">
          <span :class="row.credited ? 'text-safe' : 'text-accent'">
            {{ row.credited ? '已到账' : '待发放' }}
          </span>
        </template>
      </el-table-column>
    </el-table>
    <p class="mt-3 text-sm font-semibold text-safe">
      <FormulaTooltip>
        合计
        <template #content>
          <p>当日 24 个整点小时收益（含待发放）合计</p>
        </template>
      </FormulaTooltip>
      {{ formatMoney(total, 'USDT', { digits: 8 }) }}
    </p>
  </el-dialog>
</template>

<style>
.htx-yield-dialog.el-dialog {
  width: min(920px, 92vw) !important;
  max-width: 92vw;
}
</style>
