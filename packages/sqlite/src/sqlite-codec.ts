import { Buffer } from "node:buffer";
import type { StatementSync } from "node:sqlite";

import {
  CycleStoreProviderError,
  type CycleStoreProviderOperation,
} from "@graph-engineering/runtime";

type SQLiteOutput = null | number | bigint | string | NodeJS.NonSharedUint8Array;

const arrayIsArrayIntrinsic = Array.isArray;

function corruption(
  operation: CycleStoreProviderOperation,
  label: string,
): never {
  throw new CycleStoreProviderError(
    "GE_CYCLE_STORE_CORRUPTION",
    operation,
    `stored ${label} is invalid`,
  );
}

/**
 * Applies the same fail-closed statement policy to every prepared statement.
 *
 * Arrays prevent duplicate aliases or prototype-bearing result objects from
 * changing row interpretation. BigInt reads prevent precision loss before the
 * provider performs its own safe-integer bounds check.
 */
export function hardenSQLiteStatement(statement: StatementSync): StatementSync {
  statement.setAllowBareNamedParameters(false);
  statement.setAllowUnknownNamedParameters(false);
  statement.setReadBigInts(true);
  statement.setReturnArrays(true);
  return statement;
}

export function sqliteRow(
  value: unknown,
  length: number,
  operation: CycleStoreProviderOperation,
  label: string,
): readonly SQLiteOutput[] {
  if (!arrayIsArrayIntrinsic(value) || value.length !== length) {
    return corruption(operation, label);
  }
  return value as SQLiteOutput[];
}

export function sqliteSafeInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  operation: CycleStoreProviderOperation,
  label: string,
): number {
  if (typeof value !== "bigint") return corruption(operation, label);
  const minimumBigInt = BigInt(minimum);
  const maximumBigInt = BigInt(maximum);
  if (value < minimumBigInt || value > maximumBigInt) return corruption(operation, label);
  return Number(value);
}

export function sqliteText(
  value: unknown,
  operation: CycleStoreProviderOperation,
  label: string,
): string {
  return typeof value === "string" ? value : corruption(operation, label);
}

export function sqliteNullableText(
  value: unknown,
  operation: CycleStoreProviderOperation,
  label: string,
): string | null {
  return value === null ? null : sqliteText(value, operation, label);
}

export function sqliteBlob(
  value: unknown,
  operation: CycleStoreProviderOperation,
  label: string,
): Buffer {
  if (!(value instanceof Uint8Array)) return corruption(operation, label);
  return Buffer.from(value);
}

export function sqliteBoolean(
  value: unknown,
  operation: CycleStoreProviderOperation,
  label: string,
): boolean {
  const integer = sqliteSafeInteger(value, 0, 1, operation, label);
  return integer === 1;
}
