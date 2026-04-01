import { ParseTree } from 'antlr4ts/tree/ParseTree';
import { FunctionContext } from '../../antlr/FormulaParser';
import { EvalNode } from './formula';
import { NumberArgs } from './arguments';
import { Grid } from '../model/core/types';
import {
  toStr,
} from './functions-helpers';
import { erf } from './functions-statistical';

/**
 * DELTA(number1, [number2]) — tests if two values are equal (1 if equal, 0 otherwise).
 */
export function deltaFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) return { t: 'err', v: '#N/A' };

  const n1 = NumberArgs.map(visit(exprs[0]), grid);
  if (n1.t === 'err') return n1;

  let n2 = 0;
  if (exprs.length === 2) {
    const n2Node = NumberArgs.map(visit(exprs[1]), grid);
    if (n2Node.t === 'err') return n2Node;
    n2 = n2Node.v;
  }

  return { t: 'num', v: n1.v === n2 ? 1 : 0 };
}

/**
 * GESTEP(number, [step]) — returns 1 if number >= step, 0 otherwise.
 */
export function gestepFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) return { t: 'err', v: '#N/A' };

  const n = NumberArgs.map(visit(exprs[0]), grid);
  if (n.t === 'err') return n;

  let step = 0;
  if (exprs.length === 2) {
    const stepNode = NumberArgs.map(visit(exprs[1]), grid);
    if (stepNode.t === 'err') return stepNode;
    step = stepNode.v;
  }

  return { t: 'num', v: n.v >= step ? 1 : 0 };
}

/**
 * ERF(lower_limit, [upper_limit]) — returns the error function.
 */
export function erfFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) return { t: 'err', v: '#N/A' };

  const lower = NumberArgs.map(visit(exprs[0]), grid);
  if (lower.t === 'err') return lower;

  if (exprs.length === 1) {
    return { t: 'num', v: erf(lower.v) };
  }

  const upper = NumberArgs.map(visit(exprs[1]), grid);
  if (upper.t === 'err') return upper;
  return { t: 'num', v: erf(upper.v) - erf(lower.v) };
}

/**
 * ERFC(x) — returns the complementary error function.
 */
export function erfcFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A' };

  const x = NumberArgs.map(visit(exprs[0]), grid);
  if (x.t === 'err') return x;
  return { t: 'num', v: 1 - erf(x.v) };
}

/**
 * CONVERT(number, from_unit, to_unit) — converts between measurement units.
 * Supports a basic set of common conversions.
 */
export function convertFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 3) return { t: 'err', v: '#N/A' };

  const numNode = NumberArgs.map(visit(exprs[0]), grid);
  if (numNode.t === 'err') return numNode;
  const fromNode = toStr(visit(exprs[1]), grid);
  if (fromNode.t === 'err') return fromNode;
  const toNode = toStr(visit(exprs[2]), grid);
  if (toNode.t === 'err') return toNode;

  const from = fromNode.v;
  const to = toNode.v;
  const val = numNode.v;

  // Unit conversion tables (to SI base unit)
  type UnitEntry = { category: string; factor: number; offset?: number };
  const units: Record<string, UnitEntry> = {
    // Length (base: meter)
    m: { category: 'length', factor: 1 },
    km: { category: 'length', factor: 1000 },
    cm: { category: 'length', factor: 0.01 },
    mm: { category: 'length', factor: 0.001 },
    in: { category: 'length', factor: 0.0254 },
    ft: { category: 'length', factor: 0.3048 },
    yd: { category: 'length', factor: 0.9144 },
    mi: { category: 'length', factor: 1609.344 },
    Nmi: { category: 'length', factor: 1852 },
    um: { category: 'length', factor: 1e-6 },
    // Mass (base: kilogram)
    kg: { category: 'mass', factor: 1 },
    g: { category: 'mass', factor: 0.001 },
    mg: { category: 'mass', factor: 1e-6 },
    lbm: { category: 'mass', factor: 0.45359237 },
    ozm: { category: 'mass', factor: 0.028349523125 },
    stone: { category: 'mass', factor: 6.35029318 },
    ton: { category: 'mass', factor: 907.18474 },
    // Temperature (special handling)
    C: { category: 'temperature', factor: 1, offset: 0 },
    F: { category: 'temperature', factor: 5 / 9, offset: -32 },
    K: { category: 'temperature', factor: 1, offset: -273.15 },
    // Time (base: second)
    sec: { category: 'time', factor: 1 },
    s: { category: 'time', factor: 1 },
    min: { category: 'time', factor: 60 },
    hr: { category: 'time', factor: 3600 },
    day: { category: 'time', factor: 86400 },
    yr: { category: 'time', factor: 31557600 },
    // Volume (base: liter)
    l: { category: 'volume', factor: 1 },
    lt: { category: 'volume', factor: 1 },
    ml: { category: 'volume', factor: 0.001 },
    gal: { category: 'volume', factor: 3.785411784 },
    qt: { category: 'volume', factor: 0.946352946 },
    pt: { category: 'volume', factor: 0.473176473 },
    cup: { category: 'volume', factor: 0.2365882365 },
    tsp: { category: 'volume', factor: 0.00492892159375 },
    tbs: { category: 'volume', factor: 0.01478676478125 },
    // Speed (base: m/s)
    'm/s': { category: 'speed', factor: 1 },
    'm/h': { category: 'speed', factor: 1 / 3600 },
    mph: { category: 'speed', factor: 0.44704 },
    kn: { category: 'speed', factor: 0.514444 },
    // Area (base: m²)
    m2: { category: 'area', factor: 1 },
    ha: { category: 'area', factor: 10000 },
    acre: { category: 'area', factor: 4046.8564224 },
    // Energy (base: joule)
    J: { category: 'energy', factor: 1 },
    cal: { category: 'energy', factor: 4.1868 },
    BTU: { category: 'energy', factor: 1055.05585262 },
    kWh: { category: 'energy', factor: 3600000 },
    eV: { category: 'energy', factor: 1.602176634e-19 },
  };

  const fromUnit = units[from];
  const toUnit = units[to];
  if (!fromUnit || !toUnit) return { t: 'err', v: '#N/A' };
  if (fromUnit.category !== toUnit.category) return { t: 'err', v: '#N/A' };

  if (fromUnit.category === 'temperature') {
    // Convert to Celsius first, then to target
    let celsius: number;
    if (from === 'C') celsius = val;
    else if (from === 'F') celsius = (val - 32) * 5 / 9;
    else celsius = val - 273.15; // K

    let result: number;
    if (to === 'C') result = celsius;
    else if (to === 'F') result = celsius * 9 / 5 + 32;
    else result = celsius + 273.15; // K
    return { t: 'num', v: result };
  }

  // Standard conversion through base unit
  return { t: 'num', v: val * fromUnit.factor / toUnit.factor };
}

/**
 * BITAND(number1, number2) — bitwise AND.
 */
export function bitandFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A' };
  const a = NumberArgs.map(visit(exprs[0]), grid);
  if (a.t === 'err') return a;
  const b = NumberArgs.map(visit(exprs[1]), grid);
  if (b.t === 'err') return b;
  if (a.v < 0 || b.v < 0) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: Math.trunc(a.v) & Math.trunc(b.v) };
}

/**
 * BITOR(number1, number2) — bitwise OR.
 */
export function bitorFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A' };
  const a = NumberArgs.map(visit(exprs[0]), grid);
  if (a.t === 'err') return a;
  const b = NumberArgs.map(visit(exprs[1]), grid);
  if (b.t === 'err') return b;
  if (a.v < 0 || b.v < 0) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: Math.trunc(a.v) | Math.trunc(b.v) };
}

/**
 * BITXOR(number1, number2) — bitwise XOR.
 */
export function bitxorFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A' };
  const a = NumberArgs.map(visit(exprs[0]), grid);
  if (a.t === 'err') return a;
  const b = NumberArgs.map(visit(exprs[1]), grid);
  if (b.t === 'err') return b;
  if (a.v < 0 || b.v < 0) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: Math.trunc(a.v) ^ Math.trunc(b.v) };
}

/**
 * BITLSHIFT(number, shift_amount) — bitwise left shift.
 */
export function bitlshiftFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A' };
  const a = NumberArgs.map(visit(exprs[0]), grid);
  if (a.t === 'err') return a;
  const b = NumberArgs.map(visit(exprs[1]), grid);
  if (b.t === 'err') return b;
  if (a.v < 0) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: Math.trunc(a.v) * Math.pow(2, Math.trunc(b.v)) };
}

/**
 * BITRSHIFT(number, shift_amount) — bitwise right shift.
 */
export function bitrshiftFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A' };
  const a = NumberArgs.map(visit(exprs[0]), grid);
  if (a.t === 'err') return a;
  const b = NumberArgs.map(visit(exprs[1]), grid);
  if (b.t === 'err') return b;
  if (a.v < 0) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: Math.floor(Math.trunc(a.v) / Math.pow(2, Math.trunc(b.v))) };
}

/**
 * HEX2DEC(hex_string) — converts hexadecimal to decimal.
 */
export function hex2decFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A' };
  const s = toStr(visit(exprs[0]), grid);
  if (s.t === 'err') return s;
  const hex = s.v.trim();
  if (!/^[0-9A-Fa-f]+$/.test(hex)) return { t: 'err', v: '#VALUE!' };
  const val = parseInt(hex, 16);
  // Handle 10-digit hex as negative (two's complement for 40-bit)
  if (hex.length === 10 && hex[0].match(/[89A-Fa-f]/)) {
    return { t: 'num', v: val - Math.pow(2, 40) };
  }
  return { t: 'num', v: val };
}

/**
 * DEC2HEX(number, [places]) — converts decimal to hexadecimal.
 */
export function dec2hexFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) return { t: 'err', v: '#N/A' };
  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;
  let val = Math.trunc(num.v);
  if (val < -549755813888 || val > 549755813887) return { t: 'err', v: '#VALUE!' };

  let hex: string;
  if (val < 0) {
    hex = (val + Math.pow(2, 40)).toString(16).toUpperCase();
  } else {
    hex = val.toString(16).toUpperCase();
  }

  if (exprs.length === 2) {
    const places = NumberArgs.map(visit(exprs[1]), grid);
    if (places.t === 'err') return places;
    const p = Math.trunc(places.v);
    if (p < hex.length) return { t: 'err', v: '#VALUE!' };
    hex = hex.padStart(p, '0');
  }
  return { t: 'str', v: hex };
}

/**
 * BIN2DEC(bin_string) — converts binary to decimal.
 */
export function bin2decFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A' };
  const s = toStr(visit(exprs[0]), grid);
  if (s.t === 'err') return s;
  const bin = s.v.trim();
  if (!/^[01]+$/.test(bin) || bin.length > 10) return { t: 'err', v: '#VALUE!' };
  const val = parseInt(bin, 2);
  // 10-digit binary: first bit is sign (two's complement)
  if (bin.length === 10 && bin[0] === '1') {
    return { t: 'num', v: val - 1024 };
  }
  return { t: 'num', v: val };
}

/**
 * DEC2BIN(number, [places]) — converts decimal to binary.
 */
export function dec2binFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) return { t: 'err', v: '#N/A' };
  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;
  let val = Math.trunc(num.v);
  if (val < -512 || val > 511) return { t: 'err', v: '#VALUE!' };

  let bin: string;
  if (val < 0) {
    bin = (val + 1024).toString(2);
  } else {
    bin = val.toString(2);
  }

  if (exprs.length === 2) {
    const places = NumberArgs.map(visit(exprs[1]), grid);
    if (places.t === 'err') return places;
    const p = Math.trunc(places.v);
    if (p < bin.length) return { t: 'err', v: '#VALUE!' };
    bin = bin.padStart(p, '0');
  }
  return { t: 'str', v: bin };
}

/**
 * OCT2DEC(oct_string) — converts octal to decimal.
 */
export function oct2decFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A' };
  const s = toStr(visit(exprs[0]), grid);
  if (s.t === 'err') return s;
  const oct = s.v.trim();
  if (!/^[0-7]+$/.test(oct)) return { t: 'err', v: '#VALUE!' };
  const val = parseInt(oct, 8);
  // 10-digit octal with first digit >= 4 is negative (30-bit two's complement)
  if (oct.length === 10 && oct[0] >= '4') {
    return { t: 'num', v: val - Math.pow(2, 30) };
  }
  return { t: 'num', v: val };
}

/**
 * DEC2OCT(number, [places]) — converts decimal to octal.
 */
export function dec2octFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) return { t: 'err', v: '#N/A' };
  const num = NumberArgs.map(visit(exprs[0]), grid);
  if (num.t === 'err') return num;
  let val = Math.trunc(num.v);
  if (val < -536870912 || val > 536870911) return { t: 'err', v: '#VALUE!' };

  let oct: string;
  if (val < 0) {
    oct = (val + Math.pow(2, 30)).toString(8);
  } else {
    oct = val.toString(8);
  }

  if (exprs.length === 2) {
    const places = NumberArgs.map(visit(exprs[1]), grid);
    if (places.t === 'err') return places;
    const p = Math.trunc(places.v);
    if (p < oct.length) return { t: 'err', v: '#VALUE!' };
    oct = oct.padStart(p, '0');
  }
  return { t: 'str', v: oct };
}

/**
 * HEX2BIN(hex_string, [places]) — converts hexadecimal to binary.
 */
export function hex2binFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) return { t: 'err', v: '#N/A' };
  const s = toStr(visit(exprs[0]), grid);
  if (s.t === 'err') return s;
  const dec = parseInt(s.v, 16);
  if (isNaN(dec)) return { t: 'err', v: '#VALUE!' };
  let bin = dec.toString(2);
  if (exprs.length === 2) {
    const places = NumberArgs.map(visit(exprs[1]), grid);
    if (places.t === 'err') return places;
    const p = Math.trunc(places.v);
    if (p < bin.length) return { t: 'err', v: '#VALUE!' };
    bin = bin.padStart(p, '0');
  }
  return { t: 'str', v: bin };
}

/**
 * HEX2OCT(hex_string, [places]) — converts hexadecimal to octal.
 */
export function hex2octFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) return { t: 'err', v: '#N/A' };
  const s = toStr(visit(exprs[0]), grid);
  if (s.t === 'err') return s;
  const dec = parseInt(s.v, 16);
  if (isNaN(dec)) return { t: 'err', v: '#VALUE!' };
  let oct = dec.toString(8);
  if (exprs.length === 2) {
    const places = NumberArgs.map(visit(exprs[1]), grid);
    if (places.t === 'err') return places;
    const p = Math.trunc(places.v);
    if (p < oct.length) return { t: 'err', v: '#VALUE!' };
    oct = oct.padStart(p, '0');
  }
  return { t: 'str', v: oct };
}

/**
 * BIN2HEX(bin_string, [places]) — converts binary to hexadecimal.
 */
export function bin2hexFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) return { t: 'err', v: '#N/A' };
  const s = toStr(visit(exprs[0]), grid);
  if (s.t === 'err') return s;
  const dec = parseInt(s.v, 2);
  if (isNaN(dec)) return { t: 'err', v: '#VALUE!' };
  let hex = dec.toString(16).toUpperCase();
  if (exprs.length === 2) {
    const places = NumberArgs.map(visit(exprs[1]), grid);
    if (places.t === 'err') return places;
    const p = Math.trunc(places.v);
    if (p < hex.length) return { t: 'err', v: '#VALUE!' };
    hex = hex.padStart(p, '0');
  }
  return { t: 'str', v: hex };
}

/**
 * BIN2OCT(bin_string, [places]) — converts binary to octal.
 */
export function bin2octFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) return { t: 'err', v: '#N/A' };
  const s = toStr(visit(exprs[0]), grid);
  if (s.t === 'err') return s;
  const dec = parseInt(s.v, 2);
  if (isNaN(dec)) return { t: 'err', v: '#VALUE!' };
  let oct = dec.toString(8);
  if (exprs.length === 2) {
    const places = NumberArgs.map(visit(exprs[1]), grid);
    if (places.t === 'err') return places;
    const p = Math.trunc(places.v);
    if (p < oct.length) return { t: 'err', v: '#VALUE!' };
    oct = oct.padStart(p, '0');
  }
  return { t: 'str', v: oct };
}

/**
 * OCT2HEX(oct_string, [places]) — converts octal to hexadecimal.
 */
export function oct2hexFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) return { t: 'err', v: '#N/A' };
  const s = toStr(visit(exprs[0]), grid);
  if (s.t === 'err') return s;
  const dec = parseInt(s.v, 8);
  if (isNaN(dec)) return { t: 'err', v: '#VALUE!' };
  let hex = dec.toString(16).toUpperCase();
  if (exprs.length === 2) {
    const places = NumberArgs.map(visit(exprs[1]), grid);
    if (places.t === 'err') return places;
    const p = Math.trunc(places.v);
    if (p < hex.length) return { t: 'err', v: '#VALUE!' };
    hex = hex.padStart(p, '0');
  }
  return { t: 'str', v: hex };
}

/**
 * OCT2BIN(oct_string, [places]) — converts octal to binary.
 */
export function oct2binFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) return { t: 'err', v: '#N/A' };
  const s = toStr(visit(exprs[0]), grid);
  if (s.t === 'err') return s;
  const dec = parseInt(s.v, 8);
  if (isNaN(dec)) return { t: 'err', v: '#VALUE!' };
  let bin = dec.toString(2);
  if (exprs.length === 2) {
    const places = NumberArgs.map(visit(exprs[1]), grid);
    if (places.t === 'err') return places;
    const p = Math.trunc(places.v);
    if (p < bin.length) return { t: 'err', v: '#VALUE!' };
    bin = bin.padStart(p, '0');
  }
  return { t: 'str', v: bin };
}

/**
 * COMPLEX(real, imaginary, [suffix]) — creates a complex number string.
 */
export function complexFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 3) return { t: 'err', v: '#N/A' };
  const re = NumberArgs.map(visit(exprs[0]), grid);
  if (re.t === 'err') return re;
  const im = NumberArgs.map(visit(exprs[1]), grid);
  if (im.t === 'err') return im;

  let suffix = 'i';
  if (exprs.length === 3) {
    const sNode = toStr(visit(exprs[2]), grid);
    if (sNode.t === 'err') return sNode;
    suffix = sNode.v;
    if (suffix !== 'i' && suffix !== 'j') return { t: 'err', v: '#VALUE!' };
  }

  if (im.v === 0) return { t: 'str', v: String(re.v) };
  if (re.v === 0) {
    if (im.v === 1) return { t: 'str', v: suffix };
    if (im.v === -1) return { t: 'str', v: '-' + suffix };
    return { t: 'str', v: im.v + suffix };
  }
  const sign = im.v > 0 ? '+' : '';
  if (im.v === 1) return { t: 'str', v: re.v + '+' + suffix };
  if (im.v === -1) return { t: 'str', v: re.v + '-' + suffix };
  return { t: 'str', v: re.v + sign + im.v + suffix };
}

/**
 * IMREAL(complex_number) — returns the real part.
 */
export function imrealFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A' };
  const s = toStr(visit(exprs[0]), grid);
  if (s.t === 'err') return s;
  const c = parseComplex(s.v);
  if (!c) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: c.re };
}

/**
 * IMAGINARY(complex_number) — returns the imaginary part.
 */
export function imaginaryFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A' };
  const s = toStr(visit(exprs[0]), grid);
  if (s.t === 'err') return s;
  const c = parseComplex(s.v);
  if (!c) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: c.im };
}

/**
 * IMABS(complex_number) — returns the absolute value (modulus).
 */
export function imabsFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A' };
  const s = toStr(visit(exprs[0]), grid);
  if (s.t === 'err') return s;
  const c = parseComplex(s.v);
  if (!c) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: Math.sqrt(c.re * c.re + c.im * c.im) };
}

/**
 * IMSUM(complex1, complex2, ...) — sum of complex numbers.
 */
export function imsumFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 1) return { t: 'err', v: '#N/A' };
  let re = 0, im = 0;
  for (const expr of exprs) {
    const s = toStr(visit(expr), grid);
    if (s.t === 'err') return s;
    const c = parseComplex(s.v);
    if (!c) return { t: 'err', v: '#VALUE!' };
    re += c.re;
    im += c.im;
  }
  return { t: 'str', v: formatComplex(re, im) };
}

/**
 * IMSUB(complex1, complex2) — difference of two complex numbers.
 */
export function imsubFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A' };
  const s1 = toStr(visit(exprs[0]), grid);
  if (s1.t === 'err') return s1;
  const c1 = parseComplex(s1.v);
  if (!c1) return { t: 'err', v: '#VALUE!' };
  const s2 = toStr(visit(exprs[1]), grid);
  if (s2.t === 'err') return s2;
  const c2 = parseComplex(s2.v);
  if (!c2) return { t: 'err', v: '#VALUE!' };
  return { t: 'str', v: formatComplex(c1.re - c2.re, c1.im - c2.im) };
}

/**
 * IMPRODUCT(complex1, complex2, ...) — product of complex numbers.
 */
export function improductFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 1) return { t: 'err', v: '#N/A' };
  let re = 1, im = 0;
  for (const expr of exprs) {
    const s = toStr(visit(expr), grid);
    if (s.t === 'err') return s;
    const c = parseComplex(s.v);
    if (!c) return { t: 'err', v: '#VALUE!' };
    const newRe = re * c.re - im * c.im;
    const newIm = re * c.im + im * c.re;
    re = newRe;
    im = newIm;
  }
  return { t: 'str', v: formatComplex(re, im) };
}

/**
 * IMDIV(complex1, complex2) — division of two complex numbers.
 */
export function imdivFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A' };
  const s1 = toStr(visit(exprs[0]), grid);
  if (s1.t === 'err') return s1;
  const c1 = parseComplex(s1.v);
  if (!c1) return { t: 'err', v: '#VALUE!' };
  const s2 = toStr(visit(exprs[1]), grid);
  if (s2.t === 'err') return s2;
  const c2 = parseComplex(s2.v);
  if (!c2) return { t: 'err', v: '#VALUE!' };
  const denom = c2.re * c2.re + c2.im * c2.im;
  if (denom === 0) return { t: 'err', v: '#VALUE!' };
  const re = (c1.re * c2.re + c1.im * c2.im) / denom;
  const im = (c1.im * c2.re - c1.re * c2.im) / denom;
  return { t: 'str', v: formatComplex(re, im) };
}

/**
 * IMCONJUGATE(complex_number) — complex conjugate.
 */
export function imconjugateFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const result = parseComplexArg(ctx, visit, grid);
  if ('t' in result) return result;
  return { t: 'str', v: formatComplex(result.re, -result.im) };
}

/**
 * IMARGUMENT(complex_number) — angle (argument) in radians.
 */
export function imargumentFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const result = parseComplexArg(ctx, visit, grid);
  if ('t' in result) return result;
  if (result.re === 0 && result.im === 0) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: Math.atan2(result.im, result.re) };
}

/**
 * IMPOWER(complex_number, power) — complex number raised to a power.
 */
export function impowerFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A' };
  const s = toStr(visit(exprs[0]), grid);
  if (s.t === 'err') return s;
  const c = parseComplex(s.v);
  if (!c) return { t: 'err', v: '#VALUE!' };
  const n = NumberArgs.map(visit(exprs[1]), grid);
  if (n.t === 'err') return n;
  const r = Math.sqrt(c.re * c.re + c.im * c.im);
  const theta = Math.atan2(c.im, c.re);
  const rn = Math.pow(r, n.v);
  const re = rn * Math.cos(n.v * theta);
  const im = rn * Math.sin(n.v * theta);
  return { t: 'str', v: formatComplex(
    Math.abs(re) < 1e-14 ? 0 : re,
    Math.abs(im) < 1e-14 ? 0 : im,
  ) };
}

/**
 * IMSQRT(complex_number) — square root of a complex number.
 */
export function imsqrtFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const result = parseComplexArg(ctx, visit, grid);
  if ('t' in result) return result;
  const r = Math.sqrt(result.re * result.re + result.im * result.im);
  const theta = Math.atan2(result.im, result.re);
  const sqrtR = Math.sqrt(r);
  const re = sqrtR * Math.cos(theta / 2);
  const im = sqrtR * Math.sin(theta / 2);
  return { t: 'str', v: formatComplex(
    Math.abs(re) < 1e-14 ? 0 : re,
    Math.abs(im) < 1e-14 ? 0 : im,
  ) };
}

/**
 * IMEXP(complex_number) — e raised to a complex power.
 */
export function imexpFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const result = parseComplexArg(ctx, visit, grid);
  if ('t' in result) return result;
  const ea = Math.exp(result.re);
  const re = ea * Math.cos(result.im);
  const im = ea * Math.sin(result.im);
  return { t: 'str', v: formatComplex(
    Math.abs(re) < 1e-14 ? 0 : re,
    Math.abs(im) < 1e-14 ? 0 : im,
  ) };
}

/**
 * IMLN(complex_number) — natural logarithm of a complex number.
 */
export function imlnFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const result = parseComplexArg(ctx, visit, grid);
  if ('t' in result) return result;
  const r = Math.sqrt(result.re * result.re + result.im * result.im);
  if (r === 0) return { t: 'err', v: '#VALUE!' };
  const theta = Math.atan2(result.im, result.re);
  return { t: 'str', v: formatComplex(Math.log(r), theta) };
}

/**
 * IMLOG2(complex_number) — base-2 logarithm of a complex number.
 */
export function imlog2Func(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const result = parseComplexArg(ctx, visit, grid);
  if ('t' in result) return result;
  const r = Math.sqrt(result.re * result.re + result.im * result.im);
  if (r === 0) return { t: 'err', v: '#VALUE!' };
  const theta = Math.atan2(result.im, result.re);
  const ln2 = Math.log(2);
  return { t: 'str', v: formatComplex(Math.log(r) / ln2, theta / ln2) };
}

/**
 * IMLOG10(complex_number) — base-10 logarithm of a complex number.
 */
export function imlog10Func(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const result = parseComplexArg(ctx, visit, grid);
  if ('t' in result) return result;
  const r = Math.sqrt(result.re * result.re + result.im * result.im);
  if (r === 0) return { t: 'err', v: '#VALUE!' };
  const theta = Math.atan2(result.im, result.re);
  const ln10 = Math.log(10);
  return { t: 'str', v: formatComplex(Math.log(r) / ln10, theta / ln10) };
}

/**
 * IMSIN(complex_number) — sine of a complex number.
 * sin(a+bi) = sin(a)cosh(b) + i*cos(a)sinh(b)
 */
export function imsinFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const result = parseComplexArg(ctx, visit, grid);
  if ('t' in result) return result;
  const re = Math.sin(result.re) * Math.cosh(result.im);
  const im = Math.cos(result.re) * Math.sinh(result.im);
  return { t: 'str', v: formatComplex(
    Math.abs(re) < 1e-14 ? 0 : re,
    Math.abs(im) < 1e-14 ? 0 : im,
  ) };
}

/**
 * IMCOS(complex_number) — cosine of a complex number.
 * cos(a+bi) = cos(a)cosh(b) - i*sin(a)sinh(b)
 */
export function imcosFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const result = parseComplexArg(ctx, visit, grid);
  if ('t' in result) return result;
  const re = Math.cos(result.re) * Math.cosh(result.im);
  const im = -(Math.sin(result.re) * Math.sinh(result.im));
  return { t: 'str', v: formatComplex(
    Math.abs(re) < 1e-14 ? 0 : re,
    Math.abs(im) < 1e-14 ? 0 : im,
  ) };
}

/**
 * IMTAN(complex_number) — tangent of a complex number.
 * tan(z) = sin(z)/cos(z)
 */
export function imtanFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const result = parseComplexArg(ctx, visit, grid);
  if ('t' in result) return result;
  const sinRe = Math.sin(result.re) * Math.cosh(result.im);
  const sinIm = Math.cos(result.re) * Math.sinh(result.im);
  const cosRe = Math.cos(result.re) * Math.cosh(result.im);
  const cosIm = -(Math.sin(result.re) * Math.sinh(result.im));
  const r = complexDiv(sinRe, sinIm, cosRe, cosIm);
  return { t: 'str', v: formatComplex(
    Math.abs(r.re) < 1e-14 ? 0 : r.re,
    Math.abs(r.im) < 1e-14 ? 0 : r.im,
  ) };
}

/**
 * IMSINH(complex_number) — hyperbolic sine.
 * sinh(a+bi) = sinh(a)cos(b) + i*cosh(a)sin(b)
 */
export function imsinhFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const result = parseComplexArg(ctx, visit, grid);
  if ('t' in result) return result;
  const re = Math.sinh(result.re) * Math.cos(result.im);
  const im = Math.cosh(result.re) * Math.sin(result.im);
  return { t: 'str', v: formatComplex(
    Math.abs(re) < 1e-14 ? 0 : re,
    Math.abs(im) < 1e-14 ? 0 : im,
  ) };
}

/**
 * IMCOSH(complex_number) — hyperbolic cosine.
 * cosh(a+bi) = cosh(a)cos(b) + i*sinh(a)sin(b)
 */
export function imcoshFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const result = parseComplexArg(ctx, visit, grid);
  if ('t' in result) return result;
  const re = Math.cosh(result.re) * Math.cos(result.im);
  const im = Math.sinh(result.re) * Math.sin(result.im);
  return { t: 'str', v: formatComplex(
    Math.abs(re) < 1e-14 ? 0 : re,
    Math.abs(im) < 1e-14 ? 0 : im,
  ) };
}

/**
 * IMSEC(complex_number) — secant = 1/cos(z).
 */
export function imsecFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const result = parseComplexArg(ctx, visit, grid);
  if ('t' in result) return result;
  const cosRe = Math.cos(result.re) * Math.cosh(result.im);
  const cosIm = -(Math.sin(result.re) * Math.sinh(result.im));
  const r = complexDiv(1, 0, cosRe, cosIm);
  return { t: 'str', v: formatComplex(
    Math.abs(r.re) < 1e-14 ? 0 : r.re,
    Math.abs(r.im) < 1e-14 ? 0 : r.im,
  ) };
}

/**
 * IMCSC(complex_number) — cosecant = 1/sin(z).
 */
export function imcscFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const result = parseComplexArg(ctx, visit, grid);
  if ('t' in result) return result;
  const sinRe = Math.sin(result.re) * Math.cosh(result.im);
  const sinIm = Math.cos(result.re) * Math.sinh(result.im);
  const r = complexDiv(1, 0, sinRe, sinIm);
  return { t: 'str', v: formatComplex(
    Math.abs(r.re) < 1e-14 ? 0 : r.re,
    Math.abs(r.im) < 1e-14 ? 0 : r.im,
  ) };
}

/**
 * IMCOT(complex_number) — cotangent = cos(z)/sin(z).
 */
export function imcotFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const result = parseComplexArg(ctx, visit, grid);
  if ('t' in result) return result;
  const sinRe = Math.sin(result.re) * Math.cosh(result.im);
  const sinIm = Math.cos(result.re) * Math.sinh(result.im);
  const cosRe = Math.cos(result.re) * Math.cosh(result.im);
  const cosIm = -(Math.sin(result.re) * Math.sinh(result.im));
  const r = complexDiv(cosRe, cosIm, sinRe, sinIm);
  return { t: 'str', v: formatComplex(
    Math.abs(r.re) < 1e-14 ? 0 : r.re,
    Math.abs(r.im) < 1e-14 ? 0 : r.im,
  ) };
}

/**
 * BESSELJ(x, n) — Bessel function of the first kind.
 */
export function besseljFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A' };
  const x = NumberArgs.map(visit(exprs[0]), grid);
  if (x.t === 'err') return x;
  const n = NumberArgs.map(visit(exprs[1]), grid);
  if (n.t === 'err') return n;
  const order = Math.trunc(n.v);
  if (order < 0) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: besselJ(order, x.v) };
}

/**
 * BESSELY(x, n) — Bessel function of the second kind.
 */
export function besselyFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A' };
  const x = NumberArgs.map(visit(exprs[0]), grid);
  if (x.t === 'err') return x;
  const n = NumberArgs.map(visit(exprs[1]), grid);
  if (n.t === 'err') return n;
  const order = Math.trunc(n.v);
  if (order < 0) return { t: 'err', v: '#VALUE!' };
  if (x.v <= 0) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: besselY(order, x.v) };
}

/**
 * BESSELI(x, n) — Modified Bessel function of the first kind.
 */
export function besseliFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A' };
  const x = NumberArgs.map(visit(exprs[0]), grid);
  if (x.t === 'err') return x;
  const n = NumberArgs.map(visit(exprs[1]), grid);
  if (n.t === 'err') return n;
  const order = Math.trunc(n.v);
  if (order < 0) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: besselI(order, x.v) };
}

/**
 * BESSELK(x, n) — Modified Bessel function of the second kind.
 */
export function besselkFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A' };
  const x = NumberArgs.map(visit(exprs[0]), grid);
  if (x.t === 'err') return x;
  const n = NumberArgs.map(visit(exprs[1]), grid);
  if (n.t === 'err') return n;
  const order = Math.trunc(n.v);
  if (order < 0) return { t: 'err', v: '#VALUE!' };
  if (x.v <= 0) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: besselK(order, x.v) };
}

/**
 * Helper: parse a complex number string "a+bi" or "a-bi".
 */
function parseComplex(s: string): { re: number; im: number } | null {
  s = s.trim().replace(/\s/g, '');
  // Pure imaginary: "3i" or "-2i" or "i"
  if (s === 'i') return { re: 0, im: 1 };
  if (s === '-i') return { re: 0, im: -1 };
  if (s.endsWith('i')) {
    const body = s.slice(0, -1);
    // Check if it's just an imaginary number (no real part)
    const num = Number(body);
    if (!isNaN(num)) return { re: 0, im: num };
    // "a+bi" or "a-bi"
    const plusIdx = body.lastIndexOf('+');
    const minusIdx = body.lastIndexOf('-');
    const splitIdx = Math.max(plusIdx, minusIdx);
    if (splitIdx <= 0) return null;
    const re = Number(body.slice(0, splitIdx));
    if (isNaN(re)) return null;
    const imStr = body.slice(splitIdx);
    // Handle "+i" or "-i" where coefficient is implied 1 or -1
    const im = imStr === '+' ? 1 : imStr === '-' ? -1 : Number(imStr);
    if (isNaN(im)) return null;
    return { re, im };
  }
  // Pure real
  const num = Number(s);
  if (isNaN(num)) return null;
  return { re: num, im: 0 };
}

/**
 * Helper: format a complex number {re, im} as a string like "a+bi".
 */
function formatComplex(re: number, im: number): string {
  if (im === 0) return String(re);
  if (re === 0) {
    if (im === 1) return 'i';
    if (im === -1) return '-i';
    return im + 'i';
  }
  const sign = im > 0 ? '+' : '';
  if (im === 1) return re + '+i';
  if (im === -1) return re + '-i';
  return re + sign + im + 'i';
}

/**
 * Helper: parse a complex string argument from ctx, return {re, im} or error.
 */
function parseComplexArg(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): { re: number; im: number } | EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 1) return { t: 'err', v: '#N/A' };
  const s = toStr(visit(exprs[0]), grid);
  if (s.t === 'err') return s;
  const c = parseComplex(s.v);
  if (!c) return { t: 'err', v: '#VALUE!' };
  return c;
}

/**
 * Helper: complex division (a+bi)/(c+di).
 */
function complexDiv(
  aRe: number, aIm: number, bRe: number, bIm: number,
): { re: number; im: number } {
  const d = bRe * bRe + bIm * bIm;
  return {
    re: (aRe * bRe + aIm * bIm) / d,
    im: (aIm * bRe - aRe * bIm) / d,
  };
}

/**
 * Helper: Bessel function of the first kind Jn(x) using series expansion.
 */
function besselJ(n: number, x: number): number {
  let sum = 0;
  for (let m = 0; m <= 100; m++) {
    const sign = m % 2 === 0 ? 1 : -1;
    let factM = 1;
    for (let i = 2; i <= m; i++) factM *= i;
    let factNM = 1;
    for (let i = 2; i <= n + m; i++) factNM *= i;
    const term = (sign / (factM * factNM)) * Math.pow(x / 2, 2 * m + n);
    sum += term;
    if (Math.abs(term) < 1e-15 * Math.abs(sum) && m > 5) break;
  }
  return sum;
}

/**
 * Helper: Bessel function of the second kind Yn(x) for integer n >= 0.
 * Uses Y0 and Y1 series, then recurrence for higher orders.
 */
function besselY(n: number, x: number): number {
  if (x <= 0) return NaN;
  const euler = 0.5772156649015329;

  // Y0(x) via Neumann series
  function y0(xv: number): number {
    let sum = 0;
    for (let m = 1; m <= 100; m++) {
      const sign = m % 2 === 0 ? 1 : -1;
      let factM = 1;
      for (let i = 2; i <= m; i++) factM *= i;
      let hm = 0;
      for (let k = 1; k <= m; k++) hm += 1 / k;
      const term = (sign * hm / (factM * factM)) * Math.pow(xv / 2, 2 * m);
      sum += term;
      if (Math.abs(term) < 1e-15 * Math.abs(sum) && m > 5) break;
    }
    return (2 / Math.PI) * ((Math.log(xv / 2) + euler) * besselJ(0, xv) - sum);
  }

  // Y1(x) via Neumann series
  function y1(xv: number): number {
    // Y1(x) = (2/PI)*((ln(x/2)+gamma)*J1(x) - 1/x) - (1/PI)*sum
    let sum = 0;
    for (let m = 0; m <= 100; m++) {
      const sign = m % 2 === 0 ? 1 : -1;
      let factM = 1;
      for (let i = 2; i <= m; i++) factM *= i;
      let factM1 = 1;
      for (let i = 2; i <= m + 1; i++) factM1 *= i;
      let hm = 0;
      for (let k = 1; k <= m; k++) hm += 1 / k;
      let hm1 = 0;
      for (let k = 1; k <= m + 1; k++) hm1 += 1 / k;
      const term = (sign * (hm + hm1) / (factM * factM1)) * Math.pow(xv / 2, 2 * m + 1);
      sum += term;
      if (Math.abs(term) < 1e-15 * Math.abs(sum) && m > 5) break;
    }
    return (2 / Math.PI) * ((Math.log(xv / 2) + euler) * besselJ(1, xv) - 1 / xv) - (1 / Math.PI) * sum;
  }

  if (n === 0) return y0(x);
  if (n === 1) return y1(x);

  // Recurrence: Yn+1(x) = (2n/x)*Yn(x) - Yn-1(x)
  let ym1 = y0(x);
  let ym = y1(x);
  for (let k = 1; k < n; k++) {
    const ynext = (2 * k / x) * ym - ym1;
    ym1 = ym;
    ym = ynext;
  }
  return ym;
}

/**
 * Helper: Modified Bessel function of the first kind In(x).
 * In(x) = sum_{m=0}^inf (1/(m! * (m+n)!)) * (x/2)^(2m+n)
 */
function besselI(n: number, x: number): number {
  let sum = 0;
  for (let m = 0; m <= 100; m++) {
    let factM = 1;
    for (let i = 2; i <= m; i++) factM *= i;
    let factNM = 1;
    for (let i = 2; i <= n + m; i++) factNM *= i;
    const term = (1 / (factM * factNM)) * Math.pow(x / 2, 2 * m + n);
    sum += term;
    if (Math.abs(term) < 1e-15 * Math.abs(sum) && m > 5) break;
  }
  return sum;
}

/**
 * Helper: Modified Bessel function of the second kind Kn(x).
 * Uses K0, K1 series and recurrence.
 */
function besselK(n: number, x: number): number {
  if (x <= 0) return NaN;
  const euler = 0.5772156649015329;

  function k0(xv: number): number {
    let sum = 0;
    for (let m = 1; m <= 100; m++) {
      let factM = 1;
      for (let i = 2; i <= m; i++) factM *= i;
      let hm = 0;
      for (let k = 1; k <= m; k++) hm += 1 / k;
      const term = (hm / (factM * factM)) * Math.pow(xv / 2, 2 * m);
      sum += term;
      if (Math.abs(term) < 1e-15 * Math.abs(sum) && m > 5) break;
    }
    return -(Math.log(xv / 2) + euler) * besselI(0, xv) + sum;
  }

  function k1(xv: number): number {
    let sum = 0;
    for (let m = 0; m <= 100; m++) {
      let factM = 1;
      for (let i = 2; i <= m; i++) factM *= i;
      let factM1 = 1;
      for (let i = 2; i <= m + 1; i++) factM1 *= i;
      let hm = 0;
      for (let k = 1; k <= m; k++) hm += 1 / k;
      let hm1 = 0;
      for (let k = 1; k <= m + 1; k++) hm1 += 1 / k;
      const term = ((hm + hm1) / (2 * factM * factM1)) * Math.pow(xv / 2, 2 * m + 1);
      sum += term;
      if (Math.abs(term) < 1e-15 * Math.abs(sum) && m > 5) break;
    }
    return (1 / xv) + (Math.log(xv / 2) + euler) * besselI(1, xv) - sum;
  }

  if (n === 0) return k0(x);
  if (n === 1) return k1(x);

  let km1 = k0(x);
  let km = k1(x);
  for (let k = 1; k < n; k++) {
    const knext = (2 * k / x) * km + km1;
    km1 = km;
    km = knext;
  }
  return km;
}

export const engineeringEntries: [string, (...args: any[]) => EvalNode][] = [
  ['DELTA', deltaFunc],
  ['GESTEP', gestepFunc],
  ['ERF', erfFunc],
  ['ERFC', erfcFunc],
  ['CONVERT', convertFunc],
  ['BITAND', bitandFunc],
  ['BITOR', bitorFunc],
  ['BITXOR', bitxorFunc],
  ['BITLSHIFT', bitlshiftFunc],
  ['BITRSHIFT', bitrshiftFunc],
  ['HEX2DEC', hex2decFunc],
  ['DEC2HEX', dec2hexFunc],
  ['BIN2DEC', bin2decFunc],
  ['DEC2BIN', dec2binFunc],
  ['OCT2DEC', oct2decFunc],
  ['DEC2OCT', dec2octFunc],
  ['HEX2BIN', hex2binFunc],
  ['HEX2OCT', hex2octFunc],
  ['BIN2HEX', bin2hexFunc],
  ['BIN2OCT', bin2octFunc],
  ['OCT2HEX', oct2hexFunc],
  ['OCT2BIN', oct2binFunc],
  ['COMPLEX', complexFunc],
  ['IMREAL', imrealFunc],
  ['IMAGINARY', imaginaryFunc],
  ['IMABS', imabsFunc],
  ['IMSUM', imsumFunc],
  ['IMSUB', imsubFunc],
  ['IMPRODUCT', improductFunc],
  ['IMDIV', imdivFunc],
  ['IMCONJUGATE', imconjugateFunc],
  ['IMARGUMENT', imargumentFunc],
  ['IMPOWER', impowerFunc],
  ['IMSQRT', imsqrtFunc],
  ['IMEXP', imexpFunc],
  ['IMLN', imlnFunc],
  ['IMLOG2', imlog2Func],
  ['IMLOG10', imlog10Func],
  ['IMSIN', imsinFunc],
  ['IMCOS', imcosFunc],
  ['IMTAN', imtanFunc],
  ['IMSINH', imsinhFunc],
  ['IMCOSH', imcoshFunc],
  ['IMSEC', imsecFunc],
  ['IMCSC', imcscFunc],
  ['IMCOT', imcotFunc],
  ['BESSELJ', besseljFunc],
  ['BESSELY', besselyFunc],
  ['BESSELI', besseliFunc],
  ['BESSELK', besselkFunc],
];
