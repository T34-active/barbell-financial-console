import { acceptHMRUpdate, defineStore } from 'pinia'
import { createAccounts } from './finance/accounts'
import { createCrypto } from './finance/crypto'
import { createLoans } from './finance/loans'
import { createMarket } from './finance/market'
import { createPersistence } from './finance/persistence'
import { createSalary } from './finance/salary'
import { createShared } from './finance/shared'
import { createFinanceRefs } from './finance/state'
import { createValuation } from './finance/valuation'
import { createYuanGou } from './finance/yuan-gou'

export const useFinanceStore = defineStore(
  'finance',
  () => {
    const refs = createFinanceRefs()
    const shared = createShared(refs)
    const loansApi = createLoans(refs, shared)
    const valuation = createValuation(refs, shared, loansApi)
    const accountsApi = createAccounts(refs, shared)
    const market = createMarket(refs, shared)
    const crypto = createCrypto(refs, shared)
    const yuanGouApi = createYuanGou(refs, shared, crypto)
    const salaryApi = createSalary(refs, shared, valuation, accountsApi)
    const persistence = createPersistence(refs, shared, yuanGouApi)

    return {
      settings: refs.settings,
      accounts: refs.accounts,
      salary: refs.salary,
      yuanGou: refs.yuanGou,
      cryptoOps: refs.cryptoOps,
      loans: refs.loans,
      baseCurrency: shared.baseCurrency,
      rmbPoolValue: valuation.rmbPoolValue,
      hkdPoolValue: valuation.hkdPoolValue,
      usStockValue: valuation.usStockValue,
      usStockCost: valuation.usStockCost,
      cryptoPoolValue: valuation.cryptoPoolValue,
      openLendReceivableCny: loansApi.openLendReceivableCny,
      openLendReceivableValue: loansApi.openLendReceivableValue,
      netWorth: valuation.netWorth,
      hsbcAccount: valuation.hsbcAccount,
      isSafetyLineBreached: valuation.isSafetyLineBreached,
      safetyGap: valuation.safetyGap,
      barbell: valuation.barbell,
      estimatedAnnualIncome: valuation.estimatedAnnualIncome,
      estimatedAnnualIncomeBreakdown: valuation.estimatedAnnualIncomeBreakdown,
      htxEarnUsdt: crypto.htxEarnUsdt,
      okxEarnUsdt: crypto.okxEarnUsdt,
      htxYieldAt: crypto.htxYieldAt,
      htxYieldStatus: crypto.htxYieldStatus,
      yuanGouToday: yuanGouApi.yuanGouToday,
      yuanGouMonthSpendUsdt: yuanGouApi.yuanGouMonthSpendUsdt,
      yuanGouPeriodStats: yuanGouApi.yuanGouPeriodStats,
      yuanGouStatsForMonth: yuanGouApi.yuanGouStatsForMonth,
      emergencyReserve: valuation.emergencyReserve,
      usSeedParking: valuation.usSeedParking,
      cashObservation: valuation.cashObservation,
      funFundPocket: valuation.funFundPocket,
      funFundReserve: salaryApi.funFundReserve,
      funFundSpendable: salaryApi.funFundSpendable,
      travelFundPocket: valuation.travelFundPocket,
      safetyPadTarget: valuation.safetyPadTarget,
      isSafetyPadFull: valuation.isSafetyPadFull,
      isPeGuardActive: valuation.isPeGuardActive,
      safetyPadProgress: valuation.safetyPadProgress,
      allocationModeLabel: valuation.allocationModeLabel,
      monthsSinceLastRemit: valuation.monthsSinceLastRemit,
      monthsUntilRemit: valuation.monthsUntilRemit,
      currentMonthSavings: salaryApi.currentMonthSavings,
      savingsForPeriod: salaryApi.savingsForPeriod,
      toBase: shared.toBase,
      previewAllocation: salaryApi.previewAllocation,
      previewExtraIncome: salaryApi.previewExtraIncome,
      getRecordByMonth: salaryApi.getRecordByMonth,
      confirmAllocation: salaryApi.confirmAllocation,
      recordExtraIncome: salaryApi.recordExtraIncome,
      revokeExtraIncome: salaryApi.revokeExtraIncome,
      revokeAllocation: salaryApi.revokeAllocation,
      spendFunFund: salaryApi.spendFunFund,
      payFunFundCharge: salaryApi.payFunFundCharge,
      markFunFundChargeReimbursed: salaryApi.markFunFundChargeReimbursed,
      updateFunFundCharge: salaryApi.updateFunFundCharge,
      spendTravelFund: salaryApi.spendTravelFund,
      setFunFundRemaining: salaryApi.setFunFundRemaining,
      funFundAllocatedForMonth: salaryApi.funFundAllocatedForMonth,
      openFunFundPeriod: salaryApi.openFunFundPeriod,
      carryOverFunFund: salaryApi.carryOverFunFund,
      withdrawEmergency: salaryApi.withdrawEmergency,
      releaseObservationToSeed: salaryApi.releaseObservationToSeed,
      updateStockPrices: accountsApi.updateStockPrices,
      updateStockHoldings: accountsApi.updateStockHoldings,
      refreshStockMarketPrices: market.refreshStockMarketPrices,
      refreshStockDividendYields: market.refreshStockDividendYields,
      refreshStockQuotesAndYields: market.refreshStockQuotesAndYields,
      refreshFundNav: market.refreshFundNav,
      ensureDailyFundNav: market.ensureDailyFundNav,
      refreshGoldFundNav: market.refreshGoldFundNav,
      ensureDailyGoldFundNav: market.ensureDailyGoldFundNav,
      addFundLot: accountsApi.addFundLot,
      sellFundShares: accountsApi.sellFundShares,
      addFundProduct: accountsApi.addFundProduct,
      addGoldFundLot: accountsApi.addGoldFundLot,
      sellGoldFundShares: accountsApi.sellGoldFundShares,
      markUsSeedRemitted: salaryApi.markUsSeedRemitted,
      updateSalarySettings: salaryApi.updateSalarySettings,
      updateSalaryRatios: salaryApi.updateSalaryRatios,
      updateRules: market.updateRules,
      updateCarryoverRule: salaryApi.updateCarryoverRule,
      updateSettings: market.updateSettings,
      updateFxRate: market.updateFxRate,
      applyLiveFxQuotes: market.applyLiveFxQuotes,
      refreshLiveFxRates: market.refreshLiveFxRates,
      refreshNasdaqPe: market.refreshNasdaqPe,
      refreshFearGreedIndex: market.refreshFearGreedIndex,
      ensureDailyFxRates: market.ensureDailyFxRates,
      upsertPoolAccount: accountsApi.upsertPoolAccount,
      updatePoolAmount: accountsApi.updatePoolAmount,
      transferPoolAmount: accountsApi.transferPoolAmount,
      updatePoolYieldRate: accountsApi.updatePoolYieldRate,
      upsertStock: accountsApi.upsertStock,
      removeAccount: accountsApi.removeAccount,
      updateHtxEarnAmount: crypto.updateHtxEarnAmount,
      updateOkxEarnAmount: crypto.updateOkxEarnAmount,
      rebalanceHtxOverflow: crypto.rebalanceHtxOverflow,
      recordYuanGou: yuanGouApi.recordYuanGou,
      reviseYuanGou: yuanGouApi.reviseYuanGou,
      updateYuanGouDailyCost: yuanGouApi.updateYuanGouDailyCost,
      fundSourceLabel: loansApi.fundSourceLabel,
      lendOut: loansApi.lendOut,
      repayLoan: loansApi.repayLoan,
      writeOffLoan: loansApi.writeOffLoan,
      resetToSeed: persistence.resetToSeed,
      exportBackup: persistence.exportBackup,
      exportBackupJson: persistence.exportBackupJson,
      importBackup: persistence.importBackup,
      importBackupJson: persistence.importBackupJson,
      pushToGithubCloud: persistence.pushToGithubCloud,
      pullFromGithubCloud: persistence.pullFromGithubCloud,
      syncGithubCloudOnBoot: persistence.syncGithubCloudOnBoot,
      hydrateLegacySalary: persistence.hydrateLegacyState,
      hydrateLegacyState: persistence.hydrateLegacyState,
    }
  },
  {
    persist: {
      key: 'pbfc-finance',
      afterHydrate: (ctx) => {
        ctx.store.hydrateLegacyState()
      },
    },
  },
)

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useFinanceStore, import.meta.hot))
}
