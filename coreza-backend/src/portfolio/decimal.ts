/** Bounded base-10 accounting arithmetic. Division uses 36 decimal places;
 * quantities/addition remain exact. JSON boundaries use decimal strings. */
export class Decimal {
  private constructor(private readonly coefficient: bigint, private readonly scale: number) {}

  static from(value: string | number | Decimal): Decimal {
    if (value instanceof Decimal) return value;
    const source = String(value);
    if (source.length > 128) throw new Error("Decimal exceeds supported range");
    const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(source);
    if (!match) throw new Error("Invalid accounting decimal");
    const exponent = Number(match[4] ?? 0);
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 60) throw new Error("Decimal exponent out of range");
    let coefficient = BigInt((match[1] === "-" ? "-" : "") + match[2] + (match[3] ?? ""));
    let scale = (match[3]?.length ?? 0) - exponent;
    if (scale < 0) { coefficient *= 10n ** BigInt(-scale); scale = 0; }
    return Decimal.make(coefficient, scale);
  }

  private static make(coefficient: bigint, scale: number): Decimal {
    while (scale > 0 && coefficient % 10n === 0n) { coefficient /= 10n; scale--; }
    if (scale > 72 || coefficient.toString().replace("-", "").length > 120) throw new Error("Accounting decimal overflow");
    return new Decimal(coefficient, scale);
  }

  add(value: string | number | Decimal): Decimal {
    const other = Decimal.from(value);
    const scale = Math.max(this.scale, other.scale);
    return Decimal.make(this.coefficient * 10n ** BigInt(scale - this.scale) + other.coefficient * 10n ** BigInt(scale - other.scale), scale);
  }
  sub(value: string | number | Decimal): Decimal { return this.add(Decimal.from(value).neg()); }
  neg(): Decimal { return Decimal.make(-this.coefficient, this.scale); }
  mul(value: string | number | Decimal): Decimal {
    const other = Decimal.from(value);
    return Decimal.make(this.coefficient * other.coefficient, this.scale + other.scale);
  }
  div(value: string | number | Decimal): Decimal {
    const other = Decimal.from(value);
    if (other.coefficient === 0n) throw new Error("Accounting division by zero");
    const resultScale = Math.max(36, this.scale, other.scale);
    const shift = resultScale + other.scale - this.scale;
    const numerator = shift >= 0 ? this.coefficient * 10n ** BigInt(shift) : this.coefficient;
    const denominator = shift >= 0 ? other.coefficient : other.coefficient * 10n ** BigInt(-shift);
    const quotient = numerator / denominator;
    if (quotient === 0n && numerator !== 0n) throw new Error("Accounting division precision exceeded");
    return Decimal.make(quotient, resultScale);
  }
  compare(value: string | number | Decimal): number {
    const difference = this.sub(value).coefficient;
    return difference < 0n ? -1 : difference > 0n ? 1 : 0;
  }
  toString(): string {
    const negative = this.coefficient < 0n;
    const digits = (negative ? -this.coefficient : this.coefficient).toString().padStart(this.scale + 1, "0");
    return (negative ? "-" : "") + (this.scale ? digits.slice(0, -this.scale) + "." + digits.slice(-this.scale) : digits);
  }
  /** Compatibility numbers are restricted to 15 significant digits (1e-14 relative tolerance).
   * Exact strings remain authoritative; positive dust must never underflow to zero. */
  toNumber(): number {
    const result = Number(this.toString());
    if (!Number.isFinite(result) || Math.abs(result) > Number.MAX_SAFE_INTEGER || (result === 0 && this.coefficient !== 0n)) throw new Error("Accounting value cannot be represented safely");
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
