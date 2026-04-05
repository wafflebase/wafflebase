import { ParseTree } from 'antlr4ts/tree/ParseTree';
import { FunctionContext } from '../../antlr/FormulaParser';
import { EvalNode } from './formula';
import { NumberArgs } from './arguments';
import { Grid } from '../model/core/types';
import {
  toSrefs,
} from '../model/core/coordinates';
import {
  toStr,
  getRefsFromExpression,
} from './functions-helpers';
import { parseDate, formatDate } from './functions-date';

/**
 * PMT(rate, nper, pv, [fv], [type]) — calculates the periodic payment for a loan.
 */
export function pmtFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 3 || exprs.length > 5) return { t: 'err', v: '#N/A' };

  const rate = NumberArgs.map(visit(exprs[0]), grid);
  if (rate.t === 'err') return rate;
  const nper = NumberArgs.map(visit(exprs[1]), grid);
  if (nper.t === 'err') return nper;
  const pv = NumberArgs.map(visit(exprs[2]), grid);
  if (pv.t === 'err') return pv;

  let fv = 0;
  if (exprs.length >= 4) {
    const fvNode = NumberArgs.map(visit(exprs[3]), grid);
    if (fvNode.t === 'err') return fvNode;
    fv = fvNode.v;
  }

  let type = 0;
  if (exprs.length === 5) {
    const typeNode = NumberArgs.map(visit(exprs[4]), grid);
    if (typeNode.t === 'err') return typeNode;
    type = Math.trunc(typeNode.v);
  }

  return { t: 'num', v: computePmt(rate.v, nper.v, pv.v, fv, type) };
}

/**
 * FV(rate, nper, pmt, [pv], [type]) — calculates the future value of an investment.
 */
export function fvFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 3 || exprs.length > 5) return { t: 'err', v: '#N/A' };

  const rate = NumberArgs.map(visit(exprs[0]), grid);
  if (rate.t === 'err') return rate;
  const nper = NumberArgs.map(visit(exprs[1]), grid);
  if (nper.t === 'err') return nper;
  const pmt = NumberArgs.map(visit(exprs[2]), grid);
  if (pmt.t === 'err') return pmt;

  let pv = 0;
  if (exprs.length >= 4) {
    const pvNode = NumberArgs.map(visit(exprs[3]), grid);
    if (pvNode.t === 'err') return pvNode;
    pv = pvNode.v;
  }

  let type = 0;
  if (exprs.length === 5) {
    const typeNode = NumberArgs.map(visit(exprs[4]), grid);
    if (typeNode.t === 'err') return typeNode;
    type = Math.trunc(typeNode.v);
  }

  if (rate.v === 0) {
    return { t: 'num', v: -(pv + pmt.v * nper.v) };
  }

  const pvif = Math.pow(1 + rate.v, nper.v);
  return { t: 'num', v: -(pv * pvif + pmt.v * (1 + rate.v * type) * (pvif - 1) / rate.v) };
}

/**
 * PV(rate, nper, pmt, [fv], [type]) — calculates the present value of an investment.
 */
export function pvFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 3 || exprs.length > 5) return { t: 'err', v: '#N/A' };

  const rate = NumberArgs.map(visit(exprs[0]), grid);
  if (rate.t === 'err') return rate;
  const nper = NumberArgs.map(visit(exprs[1]), grid);
  if (nper.t === 'err') return nper;
  const pmt = NumberArgs.map(visit(exprs[2]), grid);
  if (pmt.t === 'err') return pmt;

  let fv = 0;
  if (exprs.length >= 4) {
    const fvNode = NumberArgs.map(visit(exprs[3]), grid);
    if (fvNode.t === 'err') return fvNode;
    fv = fvNode.v;
  }

  let type = 0;
  if (exprs.length === 5) {
    const typeNode = NumberArgs.map(visit(exprs[4]), grid);
    if (typeNode.t === 'err') return typeNode;
    type = Math.trunc(typeNode.v);
  }

  if (rate.v === 0) {
    return { t: 'num', v: -(fv + pmt.v * nper.v) };
  }

  const pvif = Math.pow(1 + rate.v, nper.v);
  return { t: 'num', v: -(fv + pmt.v * (1 + rate.v * type) * (pvif - 1) / rate.v) / pvif };
}

/**
 * NPV(rate, value1, [value2], ...) — calculates net present value of a series of cash flows.
 */
export function npvFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 2) return { t: 'err', v: '#N/A' };

  const rate = NumberArgs.map(visit(exprs[0]), grid);
  if (rate.t === 'err') return rate;

  let npv = 0;
  let period = 1;

  for (let i = 1; i < exprs.length; i++) {
    const node = visit(exprs[i]);
    if (node.t === 'err') return node;
    if (node.t === 'ref' && grid) {
      for (const ref of toSrefs([node.v])) {
        const cellVal = grid.get(ref)?.v || '';
        if (cellVal !== '' && !isNaN(Number(cellVal))) {
          npv += Number(cellVal) / Math.pow(1 + rate.v, period);
          period++;
        }
      }
    } else if (node.t === 'num') {
      npv += node.v / Math.pow(1 + rate.v, period);
      period++;
    }
  }

  return { t: 'num', v: npv };
}

/**
 * NPER(rate, pmt, pv, [fv], [type]) — calculates number of periods for an investment.
 */
export function nperFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 3 || exprs.length > 5) return { t: 'err', v: '#N/A' };

  const rate = NumberArgs.map(visit(exprs[0]), grid);
  if (rate.t === 'err') return rate;
  const pmt = NumberArgs.map(visit(exprs[1]), grid);
  if (pmt.t === 'err') return pmt;
  const pv = NumberArgs.map(visit(exprs[2]), grid);
  if (pv.t === 'err') return pv;

  let fv = 0;
  if (exprs.length >= 4) {
    const fvNode = NumberArgs.map(visit(exprs[3]), grid);
    if (fvNode.t === 'err') return fvNode;
    fv = fvNode.v;
  }

  let type = 0;
  if (exprs.length === 5) {
    const typeNode = NumberArgs.map(visit(exprs[4]), grid);
    if (typeNode.t === 'err') return typeNode;
    type = Math.trunc(typeNode.v);
  }

  if (rate.v === 0) {
    if (pmt.v === 0) return { t: 'err', v: '#DIV/0!' };
    return { t: 'num', v: -(pv.v + fv) / pmt.v };
  }

  const z = pmt.v * (1 + rate.v * type) / rate.v;
  return { t: 'num', v: Math.log((z - fv) / (pv.v + z)) / Math.log(1 + rate.v) };
}

/**
 * IPMT(rate, period, nper, pv, [fv], [type]) — returns the interest portion of a payment.
 */
export function ipmtFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 4 || exprs.length > 6) return { t: 'err', v: '#N/A' };

  const rate = NumberArgs.map(visit(exprs[0]), grid);
  if (rate.t === 'err') return rate;
  const per = NumberArgs.map(visit(exprs[1]), grid);
  if (per.t === 'err') return per;
  const nper = NumberArgs.map(visit(exprs[2]), grid);
  if (nper.t === 'err') return nper;
  const pv = NumberArgs.map(visit(exprs[3]), grid);
  if (pv.t === 'err') return pv;

  let fv = 0;
  if (exprs.length >= 5) {
    const fvNode = NumberArgs.map(visit(exprs[4]), grid);
    if (fvNode.t === 'err') return fvNode;
    fv = fvNode.v;
  }

  let type = 0;
  if (exprs.length === 6) {
    const typeNode = NumberArgs.map(visit(exprs[5]), grid);
    if (typeNode.t === 'err') return typeNode;
    type = Math.trunc(typeNode.v);
  }

  const pmt = computePmt(rate.v, nper.v, pv.v, fv, type);

  // Calculate remaining balance before the period
  let balance = pv.v;
  for (let i = 1; i < per.v; i++) {
    if (type === 1 && i === 1) {
      balance += pmt;
    }
    const interest = balance * rate.v;
    balance += interest + (type === 0 ? pmt : (i > 1 ? pmt : 0));
  }

  const ipmt = balance * rate.v;
  if (type === 1 && per.v === 1) return { t: 'num', v: 0 };
  return { t: 'num', v: ipmt };
}

/**
 * PPMT(rate, period, nper, pv, [fv], [type]) — returns the principal portion of a payment.
 */
export function ppmtFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 4 || exprs.length > 6) return { t: 'err', v: '#N/A' };

  const rate = NumberArgs.map(visit(exprs[0]), grid);
  if (rate.t === 'err') return rate;
  const per = NumberArgs.map(visit(exprs[1]), grid);
  if (per.t === 'err') return per;
  const nper = NumberArgs.map(visit(exprs[2]), grid);
  if (nper.t === 'err') return nper;
  const pv = NumberArgs.map(visit(exprs[3]), grid);
  if (pv.t === 'err') return pv;

  let fv = 0;
  if (exprs.length >= 5) {
    const fvNode = NumberArgs.map(visit(exprs[4]), grid);
    if (fvNode.t === 'err') return fvNode;
    fv = fvNode.v;
  }

  let type = 0;
  if (exprs.length === 6) {
    const typeNode = NumberArgs.map(visit(exprs[5]), grid);
    if (typeNode.t === 'err') return typeNode;
    type = Math.trunc(typeNode.v);
  }

  const pmt = computePmt(rate.v, nper.v, pv.v, fv, type);

  // IPMT at this period
  let balance = pv.v;
  for (let i = 1; i < per.v; i++) {
    if (type === 1 && i === 1) {
      balance += pmt;
    }
    const interest = balance * rate.v;
    balance += interest + (type === 0 ? pmt : (i > 1 ? pmt : 0));
  }

  const ipmt = (type === 1 && per.v === 1) ? 0 : balance * rate.v;
  return { t: 'num', v: pmt - ipmt };
}

/**
 * SLN(cost, salvage, life) — returns the straight-line depreciation.
 */
export function slnFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 3) return { t: 'err', v: '#N/A' };
  const cost = NumberArgs.map(visit(exprs[0]), grid);
  if (cost.t === 'err') return cost;
  const salvage = NumberArgs.map(visit(exprs[1]), grid);
  if (salvage.t === 'err') return salvage;
  const life = NumberArgs.map(visit(exprs[2]), grid);
  if (life.t === 'err') return life;
  if (life.v === 0) return { t: 'err', v: '#DIV/0!' };
  return { t: 'num', v: (cost.v - salvage.v) / life.v };
}

/**
 * EFFECT(nominal_rate, periods_per_year) — returns the effective annual interest rate.
 */
export function effectFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A' };
  const nominal = NumberArgs.map(visit(exprs[0]), grid);
  if (nominal.t === 'err') return nominal;
  const periods = NumberArgs.map(visit(exprs[1]), grid);
  if (periods.t === 'err') return periods;
  const n = Math.trunc(periods.v);
  if (n < 1 || nominal.v <= 0) return { t: 'err', v: '#NUM!' };
  return { t: 'num', v: Math.pow(1 + nominal.v / n, n) - 1 };
}

/**
 * RATE(nper, pmt, pv, [fv], [type], [guess]) — returns interest rate per period using Newton's method.
 */
export function rateFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 3 || exprs.length > 6) return { t: 'err', v: '#N/A' };

  const nper = NumberArgs.map(visit(exprs[0]), grid);
  if (nper.t === 'err') return nper;
  const pmt = NumberArgs.map(visit(exprs[1]), grid);
  if (pmt.t === 'err') return pmt;
  const pv = NumberArgs.map(visit(exprs[2]), grid);
  if (pv.t === 'err') return pv;

  let fv = 0;
  if (exprs.length >= 4) {
    const fvNode = NumberArgs.map(visit(exprs[3]), grid);
    if (fvNode.t === 'err') return fvNode;
    fv = fvNode.v;
  }

  let type = 0;
  if (exprs.length >= 5) {
    const typeNode = NumberArgs.map(visit(exprs[4]), grid);
    if (typeNode.t === 'err') return typeNode;
    type = Math.trunc(typeNode.v);
  }

  let guess = 0.1;
  if (exprs.length === 6) {
    const guessNode = NumberArgs.map(visit(exprs[5]), grid);
    if (guessNode.t === 'err') return guessNode;
    guess = guessNode.v;
  }

  // Newton's method
  let rate = guess;
  for (let i = 0; i < 100; i++) {
    const r1 = Math.pow(1 + rate, nper.v);
    const y = pv.v * r1 + pmt.v * (1 + rate * type) * (r1 - 1) / rate + fv;
    const dy = nper.v * pv.v * Math.pow(1 + rate, nper.v - 1)
      + pmt.v * (1 + rate * type) * (nper.v * Math.pow(1 + rate, nper.v - 1) * rate - (r1 - 1)) / (rate * rate)
      + pmt.v * type * (r1 - 1) / rate;
    const newRate = rate - y / dy;
    if (Math.abs(newRate - rate) < 1e-10) return { t: 'num', v: newRate };
    rate = newRate;
  }
  return { t: 'err', v: '#VALUE!' };
}

/**
 * IRR(values, [guess]) — returns the internal rate of return using Newton's method.
 */
export function irrFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 1 || exprs.length > 2) return { t: 'err', v: '#N/A' };

  const values: number[] = [];
  const refsResult = getRefsFromExpression(exprs[0], visit, grid);
  if (refsResult.t === 'err') return refsResult;
  for (const ref of refsResult.v) {
    const cell = grid!.get(ref);
    const v = cell ? Number(cell.v) : 0;
    if (isNaN(v)) return { t: 'err', v: '#VALUE!' };
    values.push(v);
  }

  let guess = 0.1;
  if (exprs.length === 2) {
    const guessNode = NumberArgs.map(visit(exprs[1]), grid);
    if (guessNode.t === 'err') return guessNode;
    guess = guessNode.v;
  }

  // Newton's method
  let rate = guess;
  for (let iter = 0; iter < 100; iter++) {
    let npv = 0;
    let dnpv = 0;
    for (let i = 0; i < values.length; i++) {
      const denom = Math.pow(1 + rate, i);
      npv += values[i] / denom;
      dnpv -= i * values[i] / Math.pow(1 + rate, i + 1);
    }
    if (Math.abs(dnpv) < 1e-15) return { t: 'err', v: '#VALUE!' };
    const newRate = rate - npv / dnpv;
    if (Math.abs(newRate - rate) < 1e-10) return { t: 'num', v: newRate };
    rate = newRate;
  }
  return { t: 'err', v: '#VALUE!' };
}

/**
 * DB(cost, salvage, life, period, [month]) — returns fixed-declining balance depreciation.
 */
export function dbFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 4 || exprs.length > 5) return { t: 'err', v: '#N/A' };

  const cost = NumberArgs.map(visit(exprs[0]), grid);
  if (cost.t === 'err') return cost;
  const salvage = NumberArgs.map(visit(exprs[1]), grid);
  if (salvage.t === 'err') return salvage;
  const life = NumberArgs.map(visit(exprs[2]), grid);
  if (life.t === 'err') return life;
  const period = NumberArgs.map(visit(exprs[3]), grid);
  if (period.t === 'err') return period;

  let month = 12;
  if (exprs.length === 5) {
    const monthNode = NumberArgs.map(visit(exprs[4]), grid);
    if (monthNode.t === 'err') return monthNode;
    month = Math.trunc(monthNode.v);
  }

  if (life.v <= 0 || period.v < 1 || cost.v < 0) return { t: 'err', v: '#VALUE!' };

  // Calculate rate rounded to 3 decimal places
  const rate = Math.round((1 - Math.pow(salvage.v / cost.v, 1 / life.v)) * 1000) / 1000;

  let totalDepreciation = 0;
  const per = Math.trunc(period.v);

  for (let p = 1; p <= per; p++) {
    let depreciation: number;
    if (p === 1) {
      depreciation = cost.v * rate * month / 12;
    } else if (p === Math.trunc(life.v) + 1) {
      depreciation = (cost.v - totalDepreciation) * rate * (12 - month) / 12;
    } else {
      depreciation = (cost.v - totalDepreciation) * rate;
    }
    if (p === per) return { t: 'num', v: depreciation };
    totalDepreciation += depreciation;
  }

  return { t: 'err', v: '#VALUE!' };
}

/**
 * DDB(cost, salvage, life, period, [factor]) — returns double-declining balance depreciation.
 */
export function ddbFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 4 || exprs.length > 5) return { t: 'err', v: '#N/A' };

  const cost = NumberArgs.map(visit(exprs[0]), grid);
  if (cost.t === 'err') return cost;
  const salvage = NumberArgs.map(visit(exprs[1]), grid);
  if (salvage.t === 'err') return salvage;
  const life = NumberArgs.map(visit(exprs[2]), grid);
  if (life.t === 'err') return life;
  const period = NumberArgs.map(visit(exprs[3]), grid);
  if (period.t === 'err') return period;

  let factor = 2;
  if (exprs.length === 5) {
    const factorNode = NumberArgs.map(visit(exprs[4]), grid);
    if (factorNode.t === 'err') return factorNode;
    factor = factorNode.v;
  }

  if (life.v <= 0 || period.v < 1) return { t: 'err', v: '#VALUE!' };

  const rate = factor / life.v;
  let bookValue = cost.v;
  const per = Math.trunc(period.v);

  for (let p = 1; p <= per; p++) {
    let depreciation = bookValue * rate;
    // Don't depreciate below salvage value
    if (bookValue - depreciation < salvage.v) {
      depreciation = bookValue - salvage.v;
    }
    if (depreciation < 0) depreciation = 0;
    if (p === per) return { t: 'num', v: depreciation };
    bookValue -= depreciation;
  }

  return { t: 'err', v: '#VALUE!' };
}

/**
 * NOMINAL(effective_rate, periods_per_year) — returns the nominal annual interest rate.
 */
export function nominalFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A' };
  const effectiveRate = NumberArgs.map(visit(exprs[0]), grid);
  if (effectiveRate.t === 'err') return effectiveRate;
  const periods = NumberArgs.map(visit(exprs[1]), grid);
  if (periods.t === 'err') return periods;
  const n = Math.trunc(periods.v);
  if (n < 1 || effectiveRate.v <= 0) return { t: 'err', v: '#NUM!' };
  return { t: 'num', v: n * (Math.pow(1 + effectiveRate.v, 1 / n) - 1) };
}

/**
 * CUMIPMT(rate, nper, pv, start_period, end_period, type) — returns cumulative interest paid.
 */
export function cumipmtFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 6) return { t: 'err', v: '#N/A' };

  const rate = NumberArgs.map(visit(exprs[0]), grid);
  if (rate.t === 'err') return rate;
  const nper = NumberArgs.map(visit(exprs[1]), grid);
  if (nper.t === 'err') return nper;
  const pv = NumberArgs.map(visit(exprs[2]), grid);
  if (pv.t === 'err') return pv;
  const startPeriod = NumberArgs.map(visit(exprs[3]), grid);
  if (startPeriod.t === 'err') return startPeriod;
  const endPeriod = NumberArgs.map(visit(exprs[4]), grid);
  if (endPeriod.t === 'err') return endPeriod;
  const type = NumberArgs.map(visit(exprs[5]), grid);
  if (type.t === 'err') return type;

  const start = Math.trunc(startPeriod.v);
  const end = Math.trunc(endPeriod.v);
  const t = Math.trunc(type.v);

  if (rate.v <= 0 || nper.v <= 0 || pv.v <= 0 || start < 1 || end < start || (t !== 0 && t !== 1)) {
    return { t: 'err', v: '#VALUE!' };
  }

  const pmt = computePmt(rate.v, nper.v, pv.v, 0, t);
  let cumInterest = 0;
  let balance = pv.v;

  for (let p = 1; p <= end; p++) {
    const interest = (t === 1 && p === 1) ? 0 : balance * rate.v;
    const principal = pmt - interest;
    if (p >= start) cumInterest += interest;
    balance += principal;
  }

  return { t: 'num', v: cumInterest };
}

/**
 * CUMPRINC(rate, nper, pv, start_period, end_period, type) — returns cumulative principal paid.
 */
export function cumprincFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 6) return { t: 'err', v: '#N/A' };

  const rate = NumberArgs.map(visit(exprs[0]), grid);
  if (rate.t === 'err') return rate;
  const nper = NumberArgs.map(visit(exprs[1]), grid);
  if (nper.t === 'err') return nper;
  const pv = NumberArgs.map(visit(exprs[2]), grid);
  if (pv.t === 'err') return pv;
  const startPeriod = NumberArgs.map(visit(exprs[3]), grid);
  if (startPeriod.t === 'err') return startPeriod;
  const endPeriod = NumberArgs.map(visit(exprs[4]), grid);
  if (endPeriod.t === 'err') return endPeriod;
  const type = NumberArgs.map(visit(exprs[5]), grid);
  if (type.t === 'err') return type;

  const start = Math.trunc(startPeriod.v);
  const end = Math.trunc(endPeriod.v);
  const t = Math.trunc(type.v);

  if (rate.v <= 0 || nper.v <= 0 || pv.v <= 0 || start < 1 || end < start || (t !== 0 && t !== 1)) {
    return { t: 'err', v: '#VALUE!' };
  }

  const pmt = computePmt(rate.v, nper.v, pv.v, 0, t);
  let cumPrincipal = 0;
  let balance = pv.v;

  for (let p = 1; p <= end; p++) {
    const interest = (t === 1 && p === 1) ? 0 : balance * rate.v;
    const principal = pmt - interest;
    if (p >= start) cumPrincipal += principal;
    balance += principal;
  }

  return { t: 'num', v: cumPrincipal };
}

/**
 * XNPV(rate, values, dates) — net present value with irregular dates.
 */
export function xnpvFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 3) return { t: 'err', v: '#N/A' };

  const rate = NumberArgs.map(visit(exprs[0]), grid);
  if (rate.t === 'err') return rate;

  const valuesResult = getRefsFromExpression(exprs[1], visit, grid);
  if (valuesResult.t === 'err') return valuesResult;
  const datesResult = getRefsFromExpression(exprs[2], visit, grid);
  if (datesResult.t === 'err') return datesResult;

  if (valuesResult.v.length !== datesResult.v.length) return { t: 'err', v: '#VALUE!' };

  const values: number[] = [];
  const dates: number[] = [];

  for (let i = 0; i < valuesResult.v.length; i++) {
    const vCell = grid!.get(valuesResult.v[i]);
    const v = vCell ? Number(vCell.v) : 0;
    if (isNaN(v)) return { t: 'err', v: '#VALUE!' };
    values.push(v);

    const dCell = grid!.get(datesResult.v[i]);
    const dateStr = dCell?.v || '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return { t: 'err', v: '#VALUE!' };
    dates.push(d.getTime());
  }

  const d0 = dates[0];
  let npv = 0;
  for (let i = 0; i < values.length; i++) {
    const years = (dates[i] - d0) / (365.25 * 24 * 3600 * 1000);
    npv += values[i] / Math.pow(1 + rate.v, years);
  }

  return { t: 'num', v: npv };
}

/**
 * XIRR(values, dates, [guess]) — internal rate of return for irregular cash flows.
 */
export function xirrFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 2 || exprs.length > 3) return { t: 'err', v: '#N/A' };

  const valuesResult = getRefsFromExpression(exprs[0], visit, grid);
  if (valuesResult.t === 'err') return valuesResult;
  const datesResult = getRefsFromExpression(exprs[1], visit, grid);
  if (datesResult.t === 'err') return datesResult;

  if (valuesResult.v.length !== datesResult.v.length) return { t: 'err', v: '#VALUE!' };

  const values: number[] = [];
  const dates: number[] = [];

  for (let i = 0; i < valuesResult.v.length; i++) {
    const vCell = grid!.get(valuesResult.v[i]);
    const v = vCell ? Number(vCell.v) : 0;
    if (isNaN(v)) return { t: 'err', v: '#VALUE!' };
    values.push(v);

    const dCell = grid!.get(datesResult.v[i]);
    const dateStr = dCell?.v || '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return { t: 'err', v: '#VALUE!' };
    dates.push(d.getTime());
  }

  let guess = 0.1;
  if (exprs.length === 3) {
    const guessNode = NumberArgs.map(visit(exprs[2]), grid);
    if (guessNode.t === 'err') return guessNode;
    guess = guessNode.v;
  }

  const d0 = dates[0];
  let rate = guess;

  for (let iter = 0; iter < 100; iter++) {
    let f = 0;
    let df = 0;
    for (let i = 0; i < values.length; i++) {
      const years = (dates[i] - d0) / (365.25 * 24 * 3600 * 1000);
      const denom = Math.pow(1 + rate, years);
      f += values[i] / denom;
      df -= years * values[i] / Math.pow(1 + rate, years + 1);
    }
    if (Math.abs(df) < 1e-15) return { t: 'err', v: '#VALUE!' };
    const newRate = rate - f / df;
    if (Math.abs(newRate - rate) < 1e-10) return { t: 'num', v: newRate };
    rate = newRate;
  }
  return { t: 'err', v: '#VALUE!' };
}

/**
 * SYD(cost, salvage, life, period) — sum-of-years-digits depreciation.
 */
export function sydFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 4) return { t: 'err', v: '#N/A' };

  const cost = NumberArgs.map(visit(exprs[0]), grid);
  if (cost.t === 'err') return cost;
  const salvage = NumberArgs.map(visit(exprs[1]), grid);
  if (salvage.t === 'err') return salvage;
  const life = NumberArgs.map(visit(exprs[2]), grid);
  if (life.t === 'err') return life;
  const period = NumberArgs.map(visit(exprs[3]), grid);
  if (period.t === 'err') return period;

  const l = Math.trunc(life.v);
  const p = Math.trunc(period.v);
  if (l <= 0 || p < 1 || p > l) return { t: 'err', v: '#VALUE!' };

  const sumOfYears = l * (l + 1) / 2;
  return { t: 'num', v: (cost.v - salvage.v) * (l - p + 1) / sumOfYears };
}

/**
 * MIRR(values, finance_rate, reinvest_rate) — modified internal rate of return.
 */
export function mirrFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 3) return { t: 'err', v: '#N/A' };

  const valuesResult = getRefsFromExpression(exprs[0], visit, grid);
  if (valuesResult.t === 'err') return valuesResult;
  const financeRate = NumberArgs.map(visit(exprs[1]), grid);
  if (financeRate.t === 'err') return financeRate;
  const reinvestRate = NumberArgs.map(visit(exprs[2]), grid);
  if (reinvestRate.t === 'err') return reinvestRate;

  const values: number[] = [];
  for (const ref of valuesResult.v) {
    const cell = grid!.get(ref);
    const v = cell ? Number(cell.v) : 0;
    if (isNaN(v)) return { t: 'err', v: '#VALUE!' };
    values.push(v);
  }

  const n = values.length;
  if (n < 2) return { t: 'err', v: '#VALUE!' };

  // PV of negative cash flows (costs) discounted at finance rate
  let pvNeg = 0;
  // FV of positive cash flows compounded at reinvestment rate
  let fvPos = 0;

  for (let i = 0; i < n; i++) {
    if (values[i] < 0) {
      pvNeg += values[i] / Math.pow(1 + financeRate.v, i);
    } else {
      fvPos += values[i] * Math.pow(1 + reinvestRate.v, n - 1 - i);
    }
  }

  if (pvNeg === 0) return { t: 'err', v: '#DIV/0!' };
  return { t: 'num', v: Math.pow(-fvPos / pvNeg, 1 / (n - 1)) - 1 };
}

/**
 * TBILLEQ(settlement, maturity, discount) — T-bill bond-equivalent yield.
 */
export function tbilleqFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 3) return { t: 'err', v: '#N/A' };

  const settlementNode = visit(exprs[0]);
  const maturityNode = visit(exprs[1]);
  const discountNode = NumberArgs.map(visit(exprs[2]), grid);
  if (discountNode.t === 'err') return discountNode;

  const sStr = toStr(settlementNode, grid);
  if (sStr.t === 'err') return sStr;
  const mStr2 = toStr(maturityNode, grid);
  if (mStr2.t === 'err') return mStr2;
  const settlement = new Date(sStr.v);
  const maturity = new Date(mStr2.v);
  if (isNaN(settlement.getTime()) || isNaN(maturity.getTime())) return { t: 'err', v: '#VALUE!' };

  const dsm = (maturity.getTime() - settlement.getTime()) / (24 * 3600 * 1000);
  if (dsm <= 0 || discountNode.v <= 0) return { t: 'err', v: '#VALUE!' };

  return { t: 'num', v: 365 * discountNode.v / (360 - discountNode.v * dsm) };
}

/**
 * TBILLPRICE(settlement, maturity, discount) — T-bill price per $100.
 */
export function tbillpriceFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 3) return { t: 'err', v: '#N/A' };

  const settlementNode = visit(exprs[0]);
  const maturityNode = visit(exprs[1]);
  const discountNode = NumberArgs.map(visit(exprs[2]), grid);
  if (discountNode.t === 'err') return discountNode;

  const sStr = toStr(settlementNode, grid);
  const mStr = toStr(maturityNode, grid);
  if (sStr.t === 'err' || mStr.t === 'err') return { t: 'err', v: '#VALUE!' };

  const settlement = new Date(sStr.v);
  const maturity = new Date(mStr.v);
  if (isNaN(settlement.getTime()) || isNaN(maturity.getTime())) return { t: 'err', v: '#VALUE!' };

  const dsm = (maturity.getTime() - settlement.getTime()) / (24 * 3600 * 1000);
  if (dsm <= 0) return { t: 'err', v: '#VALUE!' };

  return { t: 'num', v: 100 * (1 - discountNode.v * dsm / 360) };
}

/**
 * TBILLYIELD(settlement, maturity, price) — T-bill yield.
 */
export function tbillyieldFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 3) return { t: 'err', v: '#N/A' };

  const settlementNode = visit(exprs[0]);
  const maturityNode = visit(exprs[1]);
  const priceNode = NumberArgs.map(visit(exprs[2]), grid);
  if (priceNode.t === 'err') return priceNode;

  const sStr = toStr(settlementNode, grid);
  const mStr = toStr(maturityNode, grid);
  if (sStr.t === 'err' || mStr.t === 'err') return { t: 'err', v: '#VALUE!' };

  const settlement = new Date(sStr.v);
  const maturity = new Date(mStr.v);
  if (isNaN(settlement.getTime()) || isNaN(maturity.getTime())) return { t: 'err', v: '#VALUE!' };

  const dsm = (maturity.getTime() - settlement.getTime()) / (24 * 3600 * 1000);
  if (dsm <= 0 || priceNode.v <= 0) return { t: 'err', v: '#VALUE!' };

  return { t: 'num', v: (100 - priceNode.v) / priceNode.v * 360 / dsm };
}

/**
 * DOLLARDE(fractional_dollar, fraction) — converts dollar price to decimal.
 */
export function dollardeFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A' };

  const dollar = NumberArgs.map(visit(exprs[0]), grid);
  if (dollar.t === 'err') return dollar;
  const fraction = NumberArgs.map(visit(exprs[1]), grid);
  if (fraction.t === 'err') return fraction;
  const f = Math.trunc(fraction.v);
  if (f < 1) return { t: 'err', v: '#VALUE!' };

  const intPart = Math.trunc(dollar.v);
  const fracPart = dollar.v - intPart;
  const power = Math.pow(10, Math.ceil(Math.log10(f)));
  return { t: 'num', v: intPart + fracPart * power / f };
}

/**
 * DOLLARFR(decimal_dollar, fraction) — converts dollar price to fractional.
 */
export function dollarfrFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A' };

  const dollar = NumberArgs.map(visit(exprs[0]), grid);
  if (dollar.t === 'err') return dollar;
  const fraction = NumberArgs.map(visit(exprs[1]), grid);
  if (fraction.t === 'err') return fraction;
  const f = Math.trunc(fraction.v);
  if (f < 1) return { t: 'err', v: '#VALUE!' };

  const intPart = Math.trunc(dollar.v);
  const fracPart = dollar.v - intPart;
  const power = Math.pow(10, Math.ceil(Math.log10(f)));
  return { t: 'num', v: intPart + fracPart * f / power };
}

/**
 * ACCRINT(issue, first_interest, settlement, rate, par, frequency, [basis])
 * Accrued interest for a security that pays periodic interest.
 */
export function accrintFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 6 || exprs.length > 7) return { t: 'err', v: '#N/A' };
  const issue = parseDate(visit(exprs[0]), grid);
  if (!(issue instanceof Date)) return issue;
  // first_interest is ignored in simplified calculation
  const settlement = parseDate(visit(exprs[2]), grid);
  if (!(settlement instanceof Date)) return settlement;
  const rate = NumberArgs.map(visit(exprs[3]), grid);
  if (rate.t === 'err') return rate;
  const par = NumberArgs.map(visit(exprs[4]), grid);
  if (par.t === 'err') return par;
  const freq = NumberArgs.map(visit(exprs[5]), grid);
  if (freq.t === 'err') return freq;
  const basis = exprs.length >= 7 ? NumberArgs.map(visit(exprs[6]), grid) : { t: 'num' as const, v: 0 };
  if (basis.t === 'err') return basis;
  const yf = yearFrac(issue, settlement, Math.trunc(basis.v));
  return { t: 'num', v: par.v * rate.v * yf };
}

/**
 * ACCRINTM(issue, settlement, rate, par, [basis])
 * Accrued interest for a security that pays at maturity.
 */
export function accrintmFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 4 || exprs.length > 5) return { t: 'err', v: '#N/A' };
  const issue = parseDate(visit(exprs[0]), grid);
  if (!(issue instanceof Date)) return issue;
  const settlement = parseDate(visit(exprs[1]), grid);
  if (!(settlement instanceof Date)) return settlement;
  const rate = NumberArgs.map(visit(exprs[2]), grid);
  if (rate.t === 'err') return rate;
  const par = NumberArgs.map(visit(exprs[3]), grid);
  if (par.t === 'err') return par;
  const basis = exprs.length >= 5 ? NumberArgs.map(visit(exprs[4]), grid) : { t: 'num' as const, v: 0 };
  if (basis.t === 'err') return basis;
  const yf = yearFrac(issue, settlement, Math.trunc(basis.v));
  return { t: 'num', v: par.v * rate.v * yf };
}

/**
 * COUPDAYBS(settlement, maturity, frequency, [basis])
 * Number of days from beginning of coupon period to settlement.
 */
export function coupdaybsFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 3 || exprs.length > 4) return { t: 'err', v: '#N/A' };
  const settlement = parseDate(visit(exprs[0]), grid);
  if (!(settlement instanceof Date)) return settlement;
  const maturity = parseDate(visit(exprs[1]), grid);
  if (!(maturity instanceof Date)) return maturity;
  const freq = NumberArgs.map(visit(exprs[2]), grid);
  if (freq.t === 'err') return freq;
  const pcd = prevCouponDate(settlement, maturity, Math.trunc(freq.v));
  const days = Math.round((settlement.getTime() - pcd.getTime()) / 86400000);
  return { t: 'num', v: days };
}

/**
 * COUPDAYS(settlement, maturity, frequency, [basis])
 * Number of days in the coupon period that contains settlement.
 */
export function coupdaysFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 3 || exprs.length > 4) return { t: 'err', v: '#N/A' };
  const settlement = parseDate(visit(exprs[0]), grid);
  if (!(settlement instanceof Date)) return settlement;
  const maturity = parseDate(visit(exprs[1]), grid);
  if (!(maturity instanceof Date)) return maturity;
  const freq = NumberArgs.map(visit(exprs[2]), grid);
  if (freq.t === 'err') return freq;
  const f = Math.trunc(freq.v);
  const pcd = prevCouponDate(settlement, maturity, f);
  const ncd = nextCouponDate(settlement, maturity, f);
  const days = Math.round((ncd.getTime() - pcd.getTime()) / 86400000);
  return { t: 'num', v: days };
}

/**
 * COUPDAYSNC(settlement, maturity, frequency, [basis])
 * Number of days from settlement to next coupon date.
 */
export function coupdaysncFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 3 || exprs.length > 4) return { t: 'err', v: '#N/A' };
  const settlement = parseDate(visit(exprs[0]), grid);
  if (!(settlement instanceof Date)) return settlement;
  const maturity = parseDate(visit(exprs[1]), grid);
  if (!(maturity instanceof Date)) return maturity;
  const freq = NumberArgs.map(visit(exprs[2]), grid);
  if (freq.t === 'err') return freq;
  const ncd = nextCouponDate(settlement, maturity, Math.trunc(freq.v));
  const days = Math.round((ncd.getTime() - settlement.getTime()) / 86400000);
  return { t: 'num', v: days };
}

/**
 * COUPNCD(settlement, maturity, frequency, [basis])
 * Next coupon date after settlement.
 */
export function coupncdFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 3 || exprs.length > 4) return { t: 'err', v: '#N/A' };
  const settlement = parseDate(visit(exprs[0]), grid);
  if (!(settlement instanceof Date)) return settlement;
  const maturity = parseDate(visit(exprs[1]), grid);
  if (!(maturity instanceof Date)) return maturity;
  const freq = NumberArgs.map(visit(exprs[2]), grid);
  if (freq.t === 'err') return freq;
  const ncd = nextCouponDate(settlement, maturity, Math.trunc(freq.v));
  return { t: 'str', v: formatDate(ncd) };
}

/**
 * COUPNUM(settlement, maturity, frequency, [basis])
 * Number of coupon periods between settlement and maturity.
 */
export function coupnumFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 3 || exprs.length > 4) return { t: 'err', v: '#N/A' };
  const settlement = parseDate(visit(exprs[0]), grid);
  if (!(settlement instanceof Date)) return settlement;
  const maturity = parseDate(visit(exprs[1]), grid);
  if (!(maturity instanceof Date)) return maturity;
  const freq = NumberArgs.map(visit(exprs[2]), grid);
  if (freq.t === 'err') return freq;
  const f = Math.trunc(freq.v);
  const monthsPer = 12 / f;
  let count = 0;
  const d = new Date(maturity);
  while (d > settlement) {
    d.setMonth(d.getMonth() - monthsPer);
    count++;
  }
  return { t: 'num', v: count };
}

/**
 * COUPPCD(settlement, maturity, frequency, [basis])
 * Previous coupon date before settlement.
 */
export function couppcdFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 3 || exprs.length > 4) return { t: 'err', v: '#N/A' };
  const settlement = parseDate(visit(exprs[0]), grid);
  if (!(settlement instanceof Date)) return settlement;
  const maturity = parseDate(visit(exprs[1]), grid);
  if (!(maturity instanceof Date)) return maturity;
  const freq = NumberArgs.map(visit(exprs[2]), grid);
  if (freq.t === 'err') return freq;
  const pcd = prevCouponDate(settlement, maturity, Math.trunc(freq.v));
  return { t: 'str', v: formatDate(pcd) };
}

/**
 * DISC(settlement, maturity, price, redemption, [basis])
 * Discount rate for a security.
 */
export function discFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 4 || exprs.length > 5) return { t: 'err', v: '#N/A' };
  const settlement = parseDate(visit(exprs[0]), grid);
  if (!(settlement instanceof Date)) return settlement;
  const maturity = parseDate(visit(exprs[1]), grid);
  if (!(maturity instanceof Date)) return maturity;
  const price = NumberArgs.map(visit(exprs[2]), grid);
  if (price.t === 'err') return price;
  const redemption = NumberArgs.map(visit(exprs[3]), grid);
  if (redemption.t === 'err') return redemption;
  const basis = exprs.length >= 5 ? NumberArgs.map(visit(exprs[4]), grid) : { t: 'num' as const, v: 0 };
  if (basis.t === 'err') return basis;
  const yf = yearFrac(settlement, maturity, Math.trunc(basis.v));
  if (yf === 0) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: (redemption.v - price.v) / redemption.v / yf };
}

/**
 * PRICEDISC(settlement, maturity, discount, redemption, [basis])
 * Price of a discounted security.
 */
export function pricediscFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 4 || exprs.length > 5) return { t: 'err', v: '#N/A' };
  const settlement = parseDate(visit(exprs[0]), grid);
  if (!(settlement instanceof Date)) return settlement;
  const maturity = parseDate(visit(exprs[1]), grid);
  if (!(maturity instanceof Date)) return maturity;
  const discount = NumberArgs.map(visit(exprs[2]), grid);
  if (discount.t === 'err') return discount;
  const redemption = NumberArgs.map(visit(exprs[3]), grid);
  if (redemption.t === 'err') return redemption;
  const basis = exprs.length >= 5 ? NumberArgs.map(visit(exprs[4]), grid) : { t: 'num' as const, v: 0 };
  if (basis.t === 'err') return basis;
  const yf = yearFrac(settlement, maturity, Math.trunc(basis.v));
  return { t: 'num', v: redemption.v * (1 - discount.v * yf) };
}

/**
 * YIELDDISC(settlement, maturity, price, redemption, [basis])
 * Annual yield for a discounted security.
 */
export function yielddiscFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 4 || exprs.length > 5) return { t: 'err', v: '#N/A' };
  const settlement = parseDate(visit(exprs[0]), grid);
  if (!(settlement instanceof Date)) return settlement;
  const maturity = parseDate(visit(exprs[1]), grid);
  if (!(maturity instanceof Date)) return maturity;
  const price = NumberArgs.map(visit(exprs[2]), grid);
  if (price.t === 'err') return price;
  const redemption = NumberArgs.map(visit(exprs[3]), grid);
  if (redemption.t === 'err') return redemption;
  const basis = exprs.length >= 5 ? NumberArgs.map(visit(exprs[4]), grid) : { t: 'num' as const, v: 0 };
  if (basis.t === 'err') return basis;
  const yf = yearFrac(settlement, maturity, Math.trunc(basis.v));
  if (yf === 0 || price.v === 0) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: (redemption.v - price.v) / price.v / yf };
}

/**
 * DURATION(settlement, maturity, coupon, yield, frequency, [basis])
 * Macaulay duration of a security.
 */
export function durationFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 5 || exprs.length > 6) return { t: 'err', v: '#N/A' };
  const settlement = parseDate(visit(exprs[0]), grid);
  if (!(settlement instanceof Date)) return settlement;
  const maturity = parseDate(visit(exprs[1]), grid);
  if (!(maturity instanceof Date)) return maturity;
  const coupon = NumberArgs.map(visit(exprs[2]), grid);
  if (coupon.t === 'err') return coupon;
  const yld = NumberArgs.map(visit(exprs[3]), grid);
  if (yld.t === 'err') return yld;
  const freq = NumberArgs.map(visit(exprs[4]), grid);
  if (freq.t === 'err') return freq;
  const basis = exprs.length >= 6 ? NumberArgs.map(visit(exprs[5]), grid) : { t: 'num' as const, v: 0 };
  if (basis.t === 'err') return basis;
  const f = Math.trunc(freq.v);
  const n = Math.ceil(yearFrac(settlement, maturity, Math.trunc(basis.v)) * f);
  if (n <= 0) return { t: 'err', v: '#VALUE!' };
  const cpn = coupon.v / f;
  const y = yld.v / f;
  let numerator = 0;
  let denominator = 0;
  for (let i = 1; i <= n; i++) {
    const pv = cpn / Math.pow(1 + y, i);
    numerator += (i / f) * pv;
    denominator += pv;
  }
  // Add redemption at maturity
  const pvRedemption = 1 / Math.pow(1 + y, n);
  numerator += (n / f) * pvRedemption;
  denominator += pvRedemption;
  return { t: 'num', v: numerator / denominator };
}

/**
 * MDURATION(settlement, maturity, coupon, yield, frequency, [basis])
 * Modified Macaulay duration = duration / (1 + yield/frequency).
 */
export function mdurationFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 5 || exprs.length > 6) return { t: 'err', v: '#N/A' };
  const settlement = parseDate(visit(exprs[0]), grid);
  if (!(settlement instanceof Date)) return settlement;
  const maturity = parseDate(visit(exprs[1]), grid);
  if (!(maturity instanceof Date)) return maturity;
  const coupon = NumberArgs.map(visit(exprs[2]), grid);
  if (coupon.t === 'err') return coupon;
  const yld = NumberArgs.map(visit(exprs[3]), grid);
  if (yld.t === 'err') return yld;
  const freq = NumberArgs.map(visit(exprs[4]), grid);
  if (freq.t === 'err') return freq;
  const basis = exprs.length >= 6 ? NumberArgs.map(visit(exprs[5]), grid) : { t: 'num' as const, v: 0 };
  if (basis.t === 'err') return basis;
  const f = Math.trunc(freq.v);
  const n = Math.ceil(yearFrac(settlement, maturity, Math.trunc(basis.v)) * f);
  if (n <= 0) return { t: 'err', v: '#VALUE!' };
  const cpn = coupon.v / f;
  const y = yld.v / f;
  let numerator = 0, denominator = 0;
  for (let i = 1; i <= n; i++) {
    const pv = cpn / Math.pow(1 + y, i);
    numerator += (i / f) * pv;
    denominator += pv;
  }
  const pvRedemption = 1 / Math.pow(1 + y, n);
  numerator += (n / f) * pvRedemption;
  denominator += pvRedemption;
  const macDur = numerator / denominator;
  return { t: 'num', v: macDur / (1 + yld.v / f) };
}

/**
 * RECEIVED(settlement, maturity, investment, discount, [basis])
 * Amount received at maturity for a fully invested security.
 */
export function receivedFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 4 || exprs.length > 5) return { t: 'err', v: '#N/A' };
  const settlement = parseDate(visit(exprs[0]), grid);
  if (!(settlement instanceof Date)) return settlement;
  const maturity = parseDate(visit(exprs[1]), grid);
  if (!(maturity instanceof Date)) return maturity;
  const investment = NumberArgs.map(visit(exprs[2]), grid);
  if (investment.t === 'err') return investment;
  const discount = NumberArgs.map(visit(exprs[3]), grid);
  if (discount.t === 'err') return discount;
  const basis = exprs.length >= 5 ? NumberArgs.map(visit(exprs[4]), grid) : { t: 'num' as const, v: 0 };
  if (basis.t === 'err') return basis;
  const yf = yearFrac(settlement, maturity, Math.trunc(basis.v));
  const denom = 1 - discount.v * yf;
  if (denom === 0) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: investment.v / denom };
}

/**
 * INTRATE(settlement, maturity, investment, redemption, [basis])
 * Interest rate for a fully invested security.
 */
export function intrateFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 4 || exprs.length > 5) return { t: 'err', v: '#N/A' };
  const settlement = parseDate(visit(exprs[0]), grid);
  if (!(settlement instanceof Date)) return settlement;
  const maturity = parseDate(visit(exprs[1]), grid);
  if (!(maturity instanceof Date)) return maturity;
  const investment = NumberArgs.map(visit(exprs[2]), grid);
  if (investment.t === 'err') return investment;
  const redemption = NumberArgs.map(visit(exprs[3]), grid);
  if (redemption.t === 'err') return redemption;
  const basis = exprs.length >= 5 ? NumberArgs.map(visit(exprs[4]), grid) : { t: 'num' as const, v: 0 };
  if (basis.t === 'err') return basis;
  const yf = yearFrac(settlement, maturity, Math.trunc(basis.v));
  if (yf === 0 || investment.v === 0) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: (redemption.v - investment.v) / investment.v / yf };
}

/**
 * PRICE(settlement, maturity, rate, yield, redemption, frequency, [basis])
 * Price per $100 face value of a coupon-paying security.
 */
export function priceFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 6 || exprs.length > 7) return { t: 'err', v: '#N/A' };
  const settlement = parseDate(visit(exprs[0]), grid);
  if (!(settlement instanceof Date)) return settlement;
  const maturity = parseDate(visit(exprs[1]), grid);
  if (!(maturity instanceof Date)) return maturity;
  const rate = NumberArgs.map(visit(exprs[2]), grid);
  if (rate.t === 'err') return rate;
  const yld = NumberArgs.map(visit(exprs[3]), grid);
  if (yld.t === 'err') return yld;
  const redemption = NumberArgs.map(visit(exprs[4]), grid);
  if (redemption.t === 'err') return redemption;
  const freq = NumberArgs.map(visit(exprs[5]), grid);
  if (freq.t === 'err') return freq;
  const basis = exprs.length >= 7 ? NumberArgs.map(visit(exprs[6]), grid) : { t: 'num' as const, v: 0 };
  if (basis.t === 'err') return basis;
  const f = Math.trunc(freq.v);
  const b = Math.trunc(basis.v);
  const n = Math.ceil(yearFrac(settlement, maturity, b) * f);
  if (n <= 0) return { t: 'err', v: '#VALUE!' };
  const cpn = 100 * rate.v / f;
  const y = yld.v / f;
  // DSC/E fraction for accrued interest
  const pcd = prevCouponDate(settlement, maturity, f);
  const ncd = nextCouponDate(settlement, maturity, f);
  const E = Math.round((ncd.getTime() - pcd.getTime()) / 86400000);
  const DSC = Math.round((ncd.getTime() - settlement.getTime()) / 86400000);
  const A = E - DSC;
  const dscFrac = E > 0 ? DSC / E : 0;
  let price = 0;
  for (let k = 1; k <= n; k++) {
    price += cpn / Math.pow(1 + y, k - 1 + dscFrac);
  }
  price += redemption.v / Math.pow(1 + y, n - 1 + dscFrac);
  price -= cpn * (A / E);
  return { t: 'num', v: price };
}

/**
 * YIELD(settlement, maturity, rate, price, redemption, frequency, [basis])
 * Yield of a coupon-paying security (Newton's method).
 */
export function yieldBondFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 6 || exprs.length > 7) return { t: 'err', v: '#N/A' };
  const settlement = parseDate(visit(exprs[0]), grid);
  if (!(settlement instanceof Date)) return settlement;
  const maturity = parseDate(visit(exprs[1]), grid);
  if (!(maturity instanceof Date)) return maturity;
  const rate = NumberArgs.map(visit(exprs[2]), grid);
  if (rate.t === 'err') return rate;
  const pr = NumberArgs.map(visit(exprs[3]), grid);
  if (pr.t === 'err') return pr;
  const redemption = NumberArgs.map(visit(exprs[4]), grid);
  if (redemption.t === 'err') return redemption;
  const freq = NumberArgs.map(visit(exprs[5]), grid);
  if (freq.t === 'err') return freq;
  const basis = exprs.length >= 7 ? NumberArgs.map(visit(exprs[6]), grid) : { t: 'num' as const, v: 0 };
  if (basis.t === 'err') return basis;
  const f = Math.trunc(freq.v);
  const b = Math.trunc(basis.v);
  const n = Math.ceil(yearFrac(settlement, maturity, b) * f);
  if (n <= 0) return { t: 'err', v: '#VALUE!' };
  const cpn = 100 * rate.v / f;
  const pcd = prevCouponDate(settlement, maturity, f);
  const ncd = nextCouponDate(settlement, maturity, f);
  const E = Math.round((ncd.getTime() - pcd.getTime()) / 86400000);
  const DSC = Math.round((ncd.getTime() - settlement.getTime()) / 86400000);
  const A = E - DSC;
  const dscFrac = E > 0 ? DSC / E : 0;
  // Newton's method
  let yld = rate.v;
  for (let iter = 0; iter < 200; iter++) {
    const y = yld / f;
    let pv = 0, dpv = 0;
    for (let k = 1; k <= n; k++) {
      const t = k - 1 + dscFrac;
      pv += cpn / Math.pow(1 + y, t);
      dpv -= cpn * t / (f * Math.pow(1 + y, t + 1));
    }
    const tN = n - 1 + dscFrac;
    pv += redemption.v / Math.pow(1 + y, tN);
    dpv -= redemption.v * tN / (f * Math.pow(1 + y, tN + 1));
    pv -= cpn * (A / E);
    const diff = pv - pr.v;
    if (Math.abs(diff) < 1e-10) break;
    if (Math.abs(dpv) < 1e-20) break;
    yld -= diff / dpv;
  }
  return { t: 'num', v: yld };
}

/**
 * PRICEMAT(settlement, maturity, issue, rate, yield, [basis])
 * Price of a security that pays at maturity.
 */
export function pricematFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 5 || exprs.length > 6) return { t: 'err', v: '#N/A' };
  const settlement = parseDate(visit(exprs[0]), grid);
  if (!(settlement instanceof Date)) return settlement;
  const maturity = parseDate(visit(exprs[1]), grid);
  if (!(maturity instanceof Date)) return maturity;
  const issue = parseDate(visit(exprs[2]), grid);
  if (!(issue instanceof Date)) return issue;
  const rate = NumberArgs.map(visit(exprs[3]), grid);
  if (rate.t === 'err') return rate;
  const yld = NumberArgs.map(visit(exprs[4]), grid);
  if (yld.t === 'err') return yld;
  const basis = exprs.length >= 6 ? NumberArgs.map(visit(exprs[5]), grid) : { t: 'num' as const, v: 0 };
  if (basis.t === 'err') return basis;
  const b = Math.trunc(basis.v);
  const dim = yearFrac(issue, maturity, b);
  const dis = yearFrac(issue, settlement, b);
  const dsm = yearFrac(settlement, maturity, b);
  const denom = 1 + dsm * yld.v;
  if (denom === 0) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: 100 * (1 + dim * rate.v) / denom - 100 * dis * rate.v };
}

/**
 * YIELDMAT(settlement, maturity, issue, rate, price, [basis])
 * Yield of a security that pays at maturity.
 */
export function yieldmatFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 5 || exprs.length > 6) return { t: 'err', v: '#N/A' };
  const settlement = parseDate(visit(exprs[0]), grid);
  if (!(settlement instanceof Date)) return settlement;
  const maturity = parseDate(visit(exprs[1]), grid);
  if (!(maturity instanceof Date)) return maturity;
  const issue = parseDate(visit(exprs[2]), grid);
  if (!(issue instanceof Date)) return issue;
  const rate = NumberArgs.map(visit(exprs[3]), grid);
  if (rate.t === 'err') return rate;
  const pr = NumberArgs.map(visit(exprs[4]), grid);
  if (pr.t === 'err') return pr;
  const basis = exprs.length >= 6 ? NumberArgs.map(visit(exprs[5]), grid) : { t: 'num' as const, v: 0 };
  if (basis.t === 'err') return basis;
  const b = Math.trunc(basis.v);
  const dim = yearFrac(issue, maturity, b);
  const dis = yearFrac(issue, settlement, b);
  const dsm = yearFrac(settlement, maturity, b);
  if (dsm === 0) return { t: 'err', v: '#VALUE!' };
  const prAdjusted = pr.v / 100 + dis * rate.v;
  if (prAdjusted === 0) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: ((1 + dim * rate.v) / prAdjusted - 1) / dsm };
}

/**
 * AMORLINC(cost, purchase_date, first_period, salvage, period, rate, [basis])
 * Depreciation for each accounting period (French system, linear).
 */
export function amorlincFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length < 6 || exprs.length > 7) return { t: 'err', v: '#N/A' };
  const cost = NumberArgs.map(visit(exprs[0]), grid);
  if (cost.t === 'err') return cost;
  const purchaseDate = parseDate(visit(exprs[1]), grid);
  if (!(purchaseDate instanceof Date)) return purchaseDate;
  const firstPeriod = parseDate(visit(exprs[2]), grid);
  if (!(firstPeriod instanceof Date)) return firstPeriod;
  const salvage = NumberArgs.map(visit(exprs[3]), grid);
  if (salvage.t === 'err') return salvage;
  const period = NumberArgs.map(visit(exprs[4]), grid);
  if (period.t === 'err') return period;
  const rate = NumberArgs.map(visit(exprs[5]), grid);
  if (rate.t === 'err') return rate;
  const basis = exprs.length >= 7 ? NumberArgs.map(visit(exprs[6]), grid) : { t: 'num' as const, v: 0 };
  if (basis.t === 'err') return basis;
  const per = Math.trunc(period.v);
  const annualDepr = cost.v * rate.v;
  if (per === 0) {
    // First period prorated
    const yf = yearFrac(purchaseDate, firstPeriod, Math.trunc(basis.v));
    return { t: 'num', v: annualDepr * yf };
  }
  // Remaining book value check
  let bookValue = cost.v - annualDepr * yearFrac(purchaseDate, firstPeriod, Math.trunc(basis.v));
  for (let i = 1; i < per; i++) {
    bookValue -= annualDepr;
    if (bookValue - salvage.v <= 0) return { t: 'num', v: 0 };
  }
  const depr = Math.min(annualDepr, bookValue - salvage.v);
  return { t: 'num', v: Math.max(0, depr) };
}

/**
 * ISPMT(rate, period, nper, pv) — interest paid during a specific period.
 */
export function ispmtFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 4) return { t: 'err', v: '#N/A' };
  const rate = NumberArgs.map(visit(exprs[0]), grid);
  if (rate.t === 'err') return rate;
  const per = NumberArgs.map(visit(exprs[1]), grid);
  if (per.t === 'err') return per;
  const nper = NumberArgs.map(visit(exprs[2]), grid);
  if (nper.t === 'err') return nper;
  const pv = NumberArgs.map(visit(exprs[3]), grid);
  if (pv.t === 'err') return pv;
  return { t: 'num', v: pv.v * rate.v * (per.v / nper.v - 1) };
}

/**
 * FVSCHEDULE(principal, schedule_range) — future value using a schedule of rates.
 */
export function fvscheduleFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 2) return { t: 'err', v: '#N/A' };
  const principal = NumberArgs.map(visit(exprs[0]), grid);
  if (principal.t === 'err') return principal;
  const scheduleNode = visit(exprs[1]);
  if (scheduleNode.t === 'err') return scheduleNode;
  let fv = principal.v;
  if (scheduleNode.t === 'ref' && grid) {
    const refs = scheduleNode.v;
    for (const sref of toSrefs(Array.isArray(refs) ? refs : [refs])) {
      const cell = grid.get(sref);
      if (cell && cell.v != null) {
        const n = Number(cell.v);
        if (!isNaN(n)) fv *= (1 + n);
      }
    }
  } else {
    const n = NumberArgs.map(scheduleNode, grid);
    if (n.t === 'err') return n;
    fv *= (1 + n.v);
  }
  return { t: 'num', v: fv };
}

/**
 * PDURATION(rate, pv, fv) — number of periods for an investment to reach a value.
 */
export function pdurationFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 3) return { t: 'err', v: '#N/A' };
  const rate = NumberArgs.map(visit(exprs[0]), grid);
  if (rate.t === 'err') return rate;
  const pv = NumberArgs.map(visit(exprs[1]), grid);
  if (pv.t === 'err') return pv;
  const fv = NumberArgs.map(visit(exprs[2]), grid);
  if (fv.t === 'err') return fv;
  if (rate.v <= 0 || pv.v <= 0 || fv.v <= 0) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: (Math.log(fv.v) - Math.log(pv.v)) / Math.log(1 + rate.v) };
}

/**
 * RRI(nper, pv, fv) — equivalent interest rate for the growth of an investment.
 */
export function rriFunc(
  ctx: FunctionContext,
  visit: (tree: ParseTree) => EvalNode,
  grid?: Grid,
): EvalNode {
  const args = ctx.args();
  if (!args) return { t: 'err', v: '#N/A' };
  const exprs = args.expr();
  if (exprs.length !== 3) return { t: 'err', v: '#N/A' };
  const nper = NumberArgs.map(visit(exprs[0]), grid);
  if (nper.t === 'err') return nper;
  const pv = NumberArgs.map(visit(exprs[1]), grid);
  if (pv.t === 'err') return pv;
  const fv = NumberArgs.map(visit(exprs[2]), grid);
  if (fv.t === 'err') return fv;
  if (nper.v === 0 || pv.v === 0) return { t: 'err', v: '#VALUE!' };
  return { t: 'num', v: Math.pow(fv.v / pv.v, 1 / nper.v) - 1 };
}

/**
 * Helper: compute PMT given rate, nper, pv, fv, type.
 */
function computePmt(rate: number, nper: number, pv: number, fv: number, type: number): number {
  if (rate === 0) {
    return -(pv + fv) / nper;
  }
  const pvif = Math.pow(1 + rate, nper);
  return -(rate * (pv * pvif + fv) / ((1 + rate * type) * (pvif - 1)));
}

/**
 * Helper: day count fraction between two dates based on basis.
 * basis: 0=US 30/360, 1=actual/actual, 2=actual/360, 3=actual/365, 4=European 30/360
 */
function yearFrac(startDate: Date, endDate: Date, basis: number): number {
  const sd = new Date(startDate);
  const ed = new Date(endDate);
  const y1 = sd.getFullYear(), m1 = sd.getMonth() + 1, d1Orig = sd.getDate();
  const y2 = ed.getFullYear(), m2 = ed.getMonth() + 1, d2Orig = ed.getDate();
  const actualDays = (ed.getTime() - sd.getTime()) / 86400000;

  switch (basis) {
    case 0: { // US 30/360
      let dd1 = d1Orig;
      let dd2 = d2Orig;
      if (dd1 === 31) dd1 = 30;
      if (dd2 === 31 && dd1 >= 30) dd2 = 30;
      return ((y2 - y1) * 360 + (m2 - m1) * 30 + (dd2 - dd1)) / 360;
    }
    case 1: { // actual/actual
      const daysInYear = (new Date(y1 + 1, 0, 1).getTime() - new Date(y1, 0, 1).getTime()) / 86400000;
      return actualDays / daysInYear;
    }
    case 2: return actualDays / 360;
    case 3: return actualDays / 365;
    case 4: { // European 30/360
      const dd1 = Math.min(d1Orig, 30);
      const dd2 = Math.min(d2Orig, 30);
      return ((y2 - y1) * 360 + (m2 - m1) * 30 + (dd2 - dd1)) / 360;
    }
    default: return actualDays / 360;
  }
}

/**
 * Helper: find the next coupon date on or after a reference date.
 */
function nextCouponDate(settlement: Date, maturity: Date, frequency: number): Date {
  const monthsPer = 12 / frequency;
  const d = new Date(maturity);
  // Walk backward from maturity to find coupon date just after settlement
  while (d > settlement) {
    d.setMonth(d.getMonth() - monthsPer);
  }
  d.setMonth(d.getMonth() + monthsPer);
  return d;
}

/**
 * Helper: find the previous coupon date before settlement.
 */
function prevCouponDate(settlement: Date, maturity: Date, frequency: number): Date {
  const ncd = nextCouponDate(settlement, maturity, frequency);
  const monthsPer = 12 / frequency;
  const d = new Date(ncd);
  d.setMonth(d.getMonth() - monthsPer);
  return d;
}

export const financialEntries: [string, (...args: any[]) => EvalNode][] = [
  ['PMT', pmtFunc],
  ['FV', fvFunc],
  ['PV', pvFunc],
  ['NPV', npvFunc],
  ['NPER', nperFunc],
  ['IPMT', ipmtFunc],
  ['PPMT', ppmtFunc],
  ['SLN', slnFunc],
  ['EFFECT', effectFunc],
  ['RATE', rateFunc],
  ['IRR', irrFunc],
  ['DB', dbFunc],
  ['DDB', ddbFunc],
  ['NOMINAL', nominalFunc],
  ['CUMIPMT', cumipmtFunc],
  ['CUMPRINC', cumprincFunc],
  ['XNPV', xnpvFunc],
  ['XIRR', xirrFunc],
  ['SYD', sydFunc],
  ['MIRR', mirrFunc],
  ['TBILLEQ', tbilleqFunc],
  ['TBILLPRICE', tbillpriceFunc],
  ['TBILLYIELD', tbillyieldFunc],
  ['DOLLARDE', dollardeFunc],
  ['DOLLARFR', dollarfrFunc],
  ['ACCRINT', accrintFunc],
  ['ACCRINTM', accrintmFunc],
  ['COUPDAYBS', coupdaybsFunc],
  ['COUPDAYS', coupdaysFunc],
  ['COUPDAYSNC', coupdaysncFunc],
  ['COUPNCD', coupncdFunc],
  ['COUPNUM', coupnumFunc],
  ['COUPPCD', couppcdFunc],
  ['DISC', discFunc],
  ['PRICEDISC', pricediscFunc],
  ['YIELDDISC', yielddiscFunc],
  ['DURATION', durationFunc],
  ['MDURATION', mdurationFunc],
  ['RECEIVED', receivedFunc],
  ['INTRATE', intrateFunc],
  ['PRICE', priceFunc],
  ['YIELD', yieldBondFunc],
  ['PRICEMAT', pricematFunc],
  ['YIELDMAT', yieldmatFunc],
  ['AMORLINC', amorlincFunc],
  ['ISPMT', ispmtFunc],
  ['FVSCHEDULE', fvscheduleFunc],
  ['PDURATION', pdurationFunc],
  ['RRI', rriFunc],
];
