import {array, BooleanType, NumberType, ValueType, typeToString} from '../types';
import {RuntimeError} from '../runtime_error';
import {typeOf} from '../values';

import type {Expression} from '../expression';
import type {ParsingContext} from '../parsing_context';
import type {EvaluationContext} from '../evaluation_context';
import type {Type} from '../types';

const RANGE_RE = /^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/;

/**
 * Parses one level token: a plain number, possibly fractional or negative,
 * or a range like `-1-3` / `-4--3`.
 */
function parseToken(token: string): [number, number] | null {
    const trimmed = token.trim();
    if (trimmed === '') return null;
    const asNumber = Number(trimmed);
    if (!isNaN(asNumber)) return [asNumber, asNumber];
    const match = trimmed.match(RANGE_RE);
    if (match) {
        const a = Number(match[1]);
        const b = Number(match[2]);
        return [Math.min(a, b), Math.max(a, b)];
    }
    return null;
}

/**
 * The [min, max] envelope of a level value as tagged in the wild: a number,
 * a numeric string, a `;`-separated list, or a `A-B` range. Unparseable input
 * yields `null`, which overlaps nothing, so one badly tagged feature cannot
 * break a filter.
 */
export function levelRangeOf(value: unknown): [number, number] | null {
    if (typeof value === 'number') {
        return isNaN(value) ? null : [value, value];
    }
    if (typeof value !== 'string') return null;
    let min = Infinity;
    let max = -Infinity;
    for (const token of value.split(';')) {
        const range = parseToken(token);
        if (!range) continue;
        min = Math.min(min, range[0]);
        max = Math.max(max, range[1]);
    }
    return min > max ? null : [min, max];
}

export class ToLevelRange implements Expression {
    type: Type = array(NumberType, 2);

    constructor(public input: Expression) {}

    static parse(args: ReadonlyArray<unknown>, context: ParsingContext): Expression {
        if (args.length !== 2) {
            return context.error(`Expected 1 argument, but found ${args.length - 1} instead.`) as null;
        }
        const input = context.parse(args[1], 1, ValueType);
        if (!input) return null;
        return new ToLevelRange(input);
    }

    evaluate(ctx: EvaluationContext) {
        return levelRangeOf(this.input.evaluate(ctx));
    }

    eachChild(fn: (_: Expression) => void) {
        fn(this.input);
    }

    outputDefined() {
        return false;
    }
}

export class RangesOverlap implements Expression {
    type: Type = BooleanType;

    constructor(
        public a: Expression,
        public b: Expression,
        public readonly key: string
    ) {}

    static parse(args: ReadonlyArray<unknown>, context: ParsingContext): Expression {
        if (args.length !== 3) {
            return context.error(`Expected 2 arguments, but found ${args.length - 1} instead.`) as null;
        }
        const a = context.parse(args[1], 1, ValueType);
        const b = context.parse(args[2], 2, ValueType);
        if (!a || !b) return null;
        return new RangesOverlap(a, b, context.key);
    }

    evaluate(ctx: EvaluationContext) {
        const a = this.asRange(this.a.evaluate(ctx));
        const b = this.asRange(this.b.evaluate(ctx));
        if (!a || !b) return false;
        return a[0] <= b[1] && b[0] <= a[1];
    }

    asRange(value: unknown): [number, number] | null {
        if (value === null || value === undefined) return null;
        if (!Array.isArray(value) || value.length !== 2 ||
            typeof value[0] !== 'number' || typeof value[1] !== 'number') {
            throw new RuntimeError(
                `Expected an array of two numbers, but found ${typeToString(typeOf(value as any))} instead.`,
                this.key);
        }
        return value as [number, number];
    }

    eachChild(fn: (_: Expression) => void) {
        fn(this.a);
        fn(this.b);
    }

    outputDefined() {
        return true;
    }
}
