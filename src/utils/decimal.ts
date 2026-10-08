import Decimal from 'decimal.js'

export type DecimalInput = Decimal.Value

export function D(value: DecimalInput): Decimal {
  return new Decimal(value ?? 0)
}

export function add(...values: DecimalInput[]): number {
  return values.reduce<Decimal>((acc, v) => acc.plus(v ?? 0), new Decimal(0)).toNumber()
}

export function sub(a: DecimalInput, b: DecimalInput): number {
  return D(a)
    .minus(b ?? 0)
    .toNumber()
}

export function mul(...values: DecimalInput[]): number {
  if (!values.length) return 0
  return values.reduce<Decimal>((acc, v) => acc.times(v ?? 0), new Decimal(1)).toNumber()
}

export function div(a: DecimalInput, b: DecimalInput): number {
  const denominator = D(b)
  if (denominator.isZero()) return 0
  return D(a).div(denominator).toNumber()
}

/** 四舍五入到指定小数位（默认金额 2 位） */
export function round(value: DecimalInput, dp = 2): number {
  return D(value).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toNumber()
}

export { Decimal }
