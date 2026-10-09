import dayjs from 'dayjs'
import { computed } from 'vue'
import type { LoanFundSource, LoanRecord, PoolAccount } from '@/types/finance'
import type { BaseCurrency } from '@/types/finance'
import { createId } from '@/utils/salary-allocation'
import { add, round, sub } from '@/utils/decimal'
import { resolveLoanStatus, todayDateKey } from './normalize'
import type { FinanceRefs } from './state'

export function createLoans(
  refs: FinanceRefs,
  shared: {
    toBase: (amount: number, currency: BaseCurrency) => number
    syncYulibaoFromBuckets: () => void
    findRmbAccount: (id: string) => PoolAccount | undefined
  },
) {
  const { salary, loans } = refs
  const { toBase, syncYulibaoFromBuckets, findRmbAccount } = shared

  const openLendReceivableCny = computed(() =>
    loans.value.items
      .filter(
        (item) =>
          item.direction === 'lend_out' &&
          (item.status === 'open' || item.status === 'partial') &&
          item.remaining > 0,
      )
      .reduce((sum, item) => add(sum, item.remaining), 0),
  )

  const openLendReceivableValue = computed(() => toBase(openLendReceivableCny.value, 'CNY'))

  function fundSourceLabel(source: LoanFundSource) {
    return source === 'yulibao' ? '余利宝' : '手头现金'
  }

  function debitLoanSource(source: LoanFundSource, amount: number) {
    if (source === 'yulibao') {
      if (amount > salary.value.buckets.emergency_reserve) {
        throw new Error('余利宝应急金不足')
      }
      salary.value.buckets.emergency_reserve = sub(salary.value.buckets.emergency_reserve, amount)
      syncYulibaoFromBuckets()
      return
    }
    const cash = findRmbAccount('cash_rmb')
    if (!cash) throw new Error('未找到手头现金账户')
    if (amount > cash.amount) throw new Error('手头现金不足')
    cash.amount = round(sub(cash.amount, amount), 2)
    cash.amount_updated_at = dayjs().toISOString()
  }

  function creditLoanSource(source: LoanFundSource, amount: number) {
    if (source === 'yulibao') {
      salary.value.buckets.emergency_reserve = add(salary.value.buckets.emergency_reserve, amount)
      syncYulibaoFromBuckets()
      return
    }
    const cash = findRmbAccount('cash_rmb')
    if (!cash) throw new Error('未找到手头现金账户')
    cash.amount = round(add(cash.amount, amount), 2)
    cash.amount_updated_at = dayjs().toISOString()
  }

  /** 借出：扣来源账户，记一笔应收 */
  function lendOut(input: {
    amount: number
    counterparty: string
    due_at: string
    funded_from?: LoanFundSource
    lent_at?: string
    note?: string
  }) {
    const amount = round(Number(input.amount) || 0, 2)
    if (!(amount > 0)) throw new Error('借出金额必须大于 0')
    const counterparty = String(input.counterparty || '').trim()
    if (!counterparty) throw new Error('请填写借款人')
    const dueAt = String(input.due_at || '').trim()
    if (!dueAt) throw new Error('请填写约定还款日')
    const fundedFrom: LoanFundSource = input.funded_from === 'cash_rmb' ? 'cash_rmb' : 'yulibao'
    const lentAt = String(input.lent_at || todayDateKey()).trim() || todayDateKey()

    debitLoanSource(fundedFrom, amount)

    const record: LoanRecord = {
      id: createId('loan'),
      direction: 'lend_out',
      counterparty,
      amount,
      remaining: amount,
      currency: 'CNY',
      lent_at: lentAt,
      due_at: dueAt,
      funded_from: fundedFrom,
      note: String(input.note || '').trim(),
      status: 'open',
      repayments: [],
      created_at: dayjs().toISOString(),
    }
    if (!loans.value.items) loans.value.items = []
    loans.value.items.unshift(record)
    return record
  }

  /** 修改借出资料。未还款的进行中记录可以改本金，差额从原扣款账户补扣或退回。 */
  function updateLoan(input: {
    id: string
    counterparty: string
    due_at: string
    lent_at?: string
    note?: string
    amount?: number
  }) {
    const loan = loans.value.items.find((item) => item.id === input.id)
    if (!loan) throw new Error('未找到借出记录')
    const counterparty = String(input.counterparty || '').trim()
    if (!counterparty) throw new Error('请填写借款人')
    const dueAt = String(input.due_at || '').trim()
    if (!dueAt) throw new Error('请填写约定还款日')
    const lentAt = String(input.lent_at || loan.lent_at).trim() || loan.lent_at

    const canEditAmount = loan.status === 'open' && loan.repayments.length === 0
    if (input.amount != null && canEditAmount) {
      const nextAmount = round(Number(input.amount) || 0, 2)
      if (!(nextAmount > 0)) throw new Error('借出金额必须大于 0')
      const delta = round(sub(nextAmount, loan.amount), 2)
      if (delta > 0) debitLoanSource(loan.funded_from, delta)
      else if (delta < 0) creditLoanSource(loan.funded_from, Math.abs(delta))
      loan.amount = nextAmount
      loan.remaining = nextAmount
    }

    loan.counterparty = counterparty
    loan.due_at = dueAt
    loan.lent_at = lentAt
    loan.note = String(input.note || '').trim()
    return loan
  }

  /** 收回借出：部分或全部 */
  function repayLoan(input: {
    id: string
    amount: number
    to_account?: LoanFundSource
    repaid_at?: string
    note?: string
  }) {
    const loan = loans.value.items.find((item) => item.id === input.id)
    if (!loan) throw new Error('未找到借出记录')
    if (loan.status === 'written_off') throw new Error('已核销，无法收回')
    if (loan.status === 'repaid' || loan.remaining <= 0) {
      throw new Error('该笔已还清')
    }
    const amount = round(Number(input.amount) || 0, 2)
    if (!(amount > 0)) throw new Error('还款金额必须大于 0')
    if (amount > loan.remaining) {
      throw new Error(`还款不能超过剩余 ${loan.remaining}`)
    }
    const toAccount: LoanFundSource = input.to_account === 'cash_rmb' ? 'cash_rmb' : 'yulibao'

    creditLoanSource(toAccount, amount)
    loan.remaining = round(sub(loan.remaining, amount), 2)
    loan.status = resolveLoanStatus(loan.remaining, loan.amount)
    loan.repayments.unshift({
      id: createId('repay'),
      amount,
      repaid_at: String(input.repaid_at || todayDateKey()),
      to_account: toAccount,
      note: input.note ? String(input.note).trim() : undefined,
    })
    return loan
  }

  /** 核销坏账：剩余不再收回，净资产减少 */
  function writeOffLoan(id: string, note?: string) {
    const loan = loans.value.items.find((item) => item.id === id)
    if (!loan) throw new Error('未找到借出记录')
    if (loan.status === 'written_off') throw new Error('已核销')
    if (loan.status === 'repaid' || loan.remaining <= 0) {
      throw new Error('已还清，无需核销')
    }
    loan.status = 'written_off'
    loan.written_off_at = dayjs().toISOString()
    if (note) {
      const tip = String(note).trim()
      loan.note = loan.note ? `${loan.note} · ${tip}` : tip
    }
    return loan
  }

  return {
    openLendReceivableCny,
    openLendReceivableValue,
    fundSourceLabel,
    lendOut,
    updateLoan,
    repayLoan,
    writeOffLoan,
  }
}
