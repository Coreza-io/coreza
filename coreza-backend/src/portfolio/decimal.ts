import BigNumber from "bignumber.js";

// Isolate accounting precision from other users of bignumber.js. Addition and
// multiplication are exact; only division rounds toward zero at 72 decimal places.
const AccountingDecimal = BigNumber.clone({ DECIMAL_PLACES: 72, ROUNDING_MODE: BigNumber.ROUND_DOWN });

/** Bounded accounting decimal. Strings are the checkpoint/JSON boundary; numbers
 * are compatibility outputs within MAX_SAFE_INTEGER and 1e-14 relative tolerance. */
export class Decimal {
  private constructor(private readonly value: BigNumber) {
    // Allow bounded intermediate products before division, without allowing
    // repeated partial-fee allocations to grow their scale on every execution.
    if (!value.isFinite() || value.decimalPlaces()! > 144 || value.precision(true)! > 240) throw new Error("Accounting decimal overflow");
  }

  static from(value: string | number | Decimal): Decimal {
    if (value instanceof Decimal) return value;
    const source = String(value);
    const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(source);
    if (source.length > 128 || !match) throw new Error("Invalid accounting decimal");
    const exponent = Number(match[4] ?? 0);
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 60) throw new Error("Decimal exponent out of range");
    const result = new Decimal(new AccountingDecimal(source));
    result.toString(); // Validate the external decimal range.
    return result;
  }

  add(value: string | number | Decimal): Decimal { return new Decimal(this.value.plus(Decimal.from(value).value)); }
  sub(value: string | number | Decimal): Decimal { return new Decimal(this.value.minus(Decimal.from(value).value)); }
  neg(): Decimal { return new Decimal(this.value.negated()); }
  mul(value: string | number | Decimal): Decimal { return new Decimal(this.value.times(Decimal.from(value).value)); }
  div(value: string | number | Decimal): Decimal {
    const other = Decimal.from(value).value;
    if (other.isZero()) throw new Error("Accounting division by zero");
    const result = new Decimal(this.value.dividedBy(other));
    if (result.value.isZero() && !this.value.isZero()) throw new Error("Accounting division precision exceeded");
    return result;
  }
  compare(value: string | number | Decimal): number { return this.value.comparedTo(Decimal.from(value).value)!; }
  toString(): string {
    if (this.value.decimalPlaces()! > 72 || this.value.precision(true)! > 120) throw new Error("Accounting decimal exceeds external range");
    return this.value.toFixed();
  }
  toNumber(): number {
    const result = Number(this.toString());
    if (!Number.isFinite(result) || Math.abs(result) > Number.MAX_SAFE_INTEGER || (result === 0 && !this.value.isZero())) throw new Error("Accounting value cannot be represented safely");
    if (!this.value.isZero() && this.value.minus(String(result)).abs().gt(this.value.abs().times("1e-14"))) throw new Error("Accounting compatibility precision exceeded");
    return result;
  }
}

export const decimal = Decimal.from;

/** The final close receives all remaining fees/basis, including division residue. */
export function allocateOpenAmount(amount: string | number, closing: string | number, remaining: string | number): string {
  const qty = decimal(closing), open = decimal(remaining);
  if (open.compare(0) <= 0 || qty.compare(0) < 0 || qty.compare(open) > 0) throw new Error("Invalid close allocation");
  return qty.compare(open) === 0 ? decimal(amount).toString() : decimal(amount).mul(qty).div(open).toString();
}
