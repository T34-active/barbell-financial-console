import { computed } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import type { BaseCurrency } from '@/types/finance'
import { formatMoney, formatPercent } from '@/utils/currency'

export function useFinanceFormat() {
  const store = useFinanceStore()

  const base = computed(() => store.baseCurrency)

  function money(amount: number, currency?: BaseCurrency) {
    return formatMoney(amount, currency ?? base.value)
  }

  function moneyInBase(amount: number, from: BaseCurrency) {
    return formatMoney(store.toBase(amount, from), base.value)
  }

  return {
    base,
    money,
    moneyInBase,
    percent: formatPercent,
  }
}
