import { add, div, mul, round } from '@/utils/decimal'

/** 补仓后的股数与持仓价。持仓价 = (原成本 + 本次成交额) / 新股数 */
export function holdingAfterBuy(
  shares: number,
  costPrice: number,
  buyShares: number,
  buyPrice: number,
): { shares: number; cost_price: number; buy_amount: number } {
  const nextShares = round(add(shares, buyShares), 4)
  const buyAmount = round(mul(buyShares, buyPrice), 2)
  const costPriceNext = round(
    div(add(mul(shares, costPrice), mul(buyShares, buyPrice)), nextShares),
    2,
  )
  return { shares: nextShares, cost_price: costPriceNext, buy_amount: buyAmount }
}
