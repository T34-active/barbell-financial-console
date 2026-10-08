<script setup lang="ts">
import type { SalaryAllocationPreview } from '@/types/finance'
import { formatMoney, formatPercent } from '@/utils/currency'
import { useFinanceStore } from '@/stores/finance'

withDefaults(
  defineProps<{
    preview: SalaryAllocationPreview
    /** 发薪前：明确标注为模拟，满额判定未生效 */
    deferred?: boolean
  }>(),
  { deferred: false },
)

const store = useFinanceStore()
const peCurrent = computed(() => store.settings.rules.nasdaq_pe_current)
const peThreshold = computed(() => store.settings.rules.nasdaq_pe_threshold)
</script>

<template>
  <section class="panel overflow-hidden">
    <div class="flex flex-col gap-3 border-b border-surface-line px-5 py-4 md:flex-row md:items-start md:justify-between md:px-6">
      <div>
        <h2 class="text-base font-semibold">
          {{ deferred ? '模拟分配表' : '本月分配表' }}
        </h2>
        <p class="mt-1 text-xs text-ink-muted">
          工资 {{ formatMoney(preview.salary, 'CNY') }}
        </p>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <span class="rounded-full bg-surface px-2.5 py-1 text-[11px] text-ink-muted">
          {{
            preview.mode === 'divert_to_seed' ? '已满 · 转种子' : '补仓中'
          }}
        </span>
        <span
          class="rounded-full px-2.5 py-1 text-[11px]"
          :class="
            preview.peGuardActive
              ? 'bg-risk-soft text-risk'
              : 'bg-surface text-ink-muted'
          "
        >
          PE {{ peCurrent }} / {{ peThreshold }}
          {{ preview.peGuardActive ? ' · 观察仓' : '' }}
        </span>
        <span class="rounded-full bg-safe-soft px-2.5 py-1 text-[11px] text-safe">
          储蓄率 {{ formatPercent(preview.projectedSavingsRate) }}
        </span>
      </div>
    </div>

    <p
      v-if="deferred"
      class="border-b border-surface-line bg-surface/60 px-5 py-2.5 text-xs leading-5 text-ink-muted md:px-6"
    >
      发薪前预览：安全垫是否满额，只在实际发薪日点「确认入账」的瞬间判定。
    </p>

    <div class="hidden overflow-x-auto md:block">
      <table class="w-full min-w-180 text-left text-sm">
        <thead class="text-xs text-ink-muted">
          <tr>
            <th class="px-6 py-2.5 font-medium">项目</th>
            <th class="px-3 py-2.5 font-medium">比例</th>
            <th class="px-3 py-2.5 font-medium">金额</th>
            <th class="px-3 py-2.5 font-medium">去向</th>
            <th class="px-6 py-2.5 font-medium">说明</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="line in preview.lines"
            :key="line.key"
            class="border-t border-surface-line align-top"
          >
            <td class="px-6 py-3.5 font-medium">
              {{ line.label }}
              <span
                v-if="line.diverted"
                class="ml-2 rounded-full bg-accent-soft px-1.5 py-0.5 text-[11px] font-normal text-accent"
              >
                已并入
              </span>
            </td>
            <td class="stat-num px-3 py-3.5 text-ink-muted">
              {{ formatPercent(line.ratio) }}
            </td>
            <td class="stat-num px-3 py-3.5 font-semibold">
              {{ formatMoney(line.amount, 'CNY') }}
              <p
                v-if="line.split_amounts"
                class="mt-1 text-xs font-normal text-ink-muted"
              >
                每人
                {{ formatMoney(line.split_amounts[0], 'CNY') }}
                /
                {{ formatMoney(line.split_amounts[1], 'CNY') }}
              </p>
              <p
                v-if="line.reserved_amount"
                class="mt-1 text-xs font-normal text-accent"
              >
                先锁 {{ formatMoney(line.reserved_amount, 'CNY') }}
              </p>
            </td>
            <td class="px-3 py-3.5 text-xs leading-5 text-ink-muted">
              {{ line.destination }}
            </td>
            <td class="px-6 py-3.5 text-xs leading-5 text-ink-muted">
              {{ line.note }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="space-y-2 p-4 md:hidden">
      <article
        v-for="line in preview.lines"
        :key="line.key"
        class="rounded-lg bg-surface px-3 py-3"
      >
        <div class="flex items-start justify-between gap-2">
          <p class="text-sm font-medium">
            {{ line.label }}
            <span
              v-if="line.diverted"
              class="ml-1 text-[11px] font-normal text-accent"
            >已并入</span>
          </p>
          <p class="stat-num text-right text-sm font-semibold">
            {{ formatMoney(line.amount, 'CNY') }}
            <span
              v-if="line.split_amounts"
              class="mt-1 block text-[11px] font-normal text-ink-muted"
            >
              每人
              {{ formatMoney(line.split_amounts[0], 'CNY') }}
              /
              {{ formatMoney(line.split_amounts[1], 'CNY') }}
            </span>
            <span
              v-if="line.reserved_amount"
              class="mt-1 block text-[11px] font-normal text-accent"
            >
              先锁 {{ formatMoney(line.reserved_amount, 'CNY') }}
            </span>
          </p>
        </div>
        <p class="mt-1 text-[11px] text-ink-muted">
          {{ formatPercent(line.ratio) }} · {{ line.destination }}
        </p>
        <p class="mt-1.5 text-[11px] leading-5 text-ink-muted">{{ line.note }}</p>
      </article>
    </div>
  </section>
</template>
