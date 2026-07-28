import { describe, expect, it } from "vitest";

import {
  isRetryableSQLiteLockError,
  sqliteBaseErrorCode,
  translateSQLiteError,
} from "../src/sqlite-errors.js";

function sqliteError(errcode: number, message = "PAYLOAD_SENTINEL /tmp/private.db"): Error {
  return Object.assign(new Error(message), { errcode });
}

describe("SQLite error classification", () => {
  it("uses the numeric extended code and extracts its base class", () => {
    expect(sqliteBaseErrorCode(sqliteError(517))).toBe(5);
    expect(sqliteBaseErrorCode(sqliteError(2067))).toBe(19);
    expect(sqliteBaseErrorCode({ errcode: "5" })).toBeNull();
    expect(sqliteBaseErrorCode(null)).toBeNull();
  });

  it("retries only BUSY and LOCKED classes", () => {
    expect(isRetryableSQLiteLockError(sqliteError(5))).toBe(true);
    expect(isRetryableSQLiteLockError(sqliteError(517))).toBe(true);
    expect(isRetryableSQLiteLockError(sqliteError(6))).toBe(true);
    expect(isRetryableSQLiteLockError(sqliteError(13))).toBe(false);
    expect(isRetryableSQLiteLockError(new Error("database is busy"))).toBe(false);
  });

  it.each([
    [5, "GE_CYCLE_STORE_UNAVAILABLE"],
    [6, "GE_CYCLE_STORE_UNAVAILABLE"],
    [7, "GE_CYCLE_STORE_UNAVAILABLE"],
    [8, "GE_CYCLE_STORE_PERMISSION_DENIED"],
    [9, "GE_CYCLE_STORE_UNAVAILABLE"],
    [10, "GE_CYCLE_STORE_UNAVAILABLE"],
    [11, "GE_CYCLE_STORE_CORRUPTION"],
    [13, "GE_CYCLE_STORE_QUOTA_EXCEEDED"],
    [14, "GE_CYCLE_STORE_UNAVAILABLE"],
    [18, "GE_CYCLE_STORE_QUOTA_EXCEEDED"],
    [19, "GE_CYCLE_STORE_CORRUPTION"],
    [23, "GE_CYCLE_STORE_PERMISSION_DENIED"],
    [26, "GE_CYCLE_STORE_CORRUPTION"],
    [1, "GE_CYCLE_STORE_INTERNAL"],
  ])("maps SQLite class %i without exposing driver text", (errcode, expectedCode) => {
    const translated = translateSQLiteError(sqliteError(errcode), "append");
    expect(translated.code).toBe(expectedCode);
    expect(translated.operation).toBe("append");
    expect(JSON.stringify(translated.toJSON())).not.toContain("PAYLOAD_SENTINEL");
    expect(JSON.stringify(translated.toJSON())).not.toContain("private.db");
  });

  it("preserves an already typed provider error", () => {
    const first = translateSQLiteError(sqliteError(13), "append");
    expect(translateSQLiteError(first, "read-tail")).toBe(first);
  });

  it("contains hostile getters and Proxy traps as safe unknown errors", () => {
    const getter = Object.defineProperty({}, "errcode", {
      get() { throw new Error("PAYLOAD_SENTINEL"); },
    });
    const proxy = new Proxy({}, {
      has() { throw new Error("PAYLOAD_SENTINEL"); },
      getPrototypeOf() { throw new Error("PAYLOAD_SENTINEL"); },
    });
    for (const hostile of [getter, proxy]) {
      expect(sqliteBaseErrorCode(hostile)).toBeNull();
      const translated = translateSQLiteError(hostile, "append");
      expect(translated.code).toBe("GE_CYCLE_STORE_INTERNAL");
      expect(JSON.stringify(translated.toJSON())).not.toContain("PAYLOAD_SENTINEL");
    }
  });
});
