import {
  SQLiteConnection,
  type SQLiteConnectionOptions,
  type SQLiteWalCheckpointMode,
  type SQLiteWalCheckpointReport,
} from "./sqlite-connection.js";

/** Runs one explicit checked WAL checkpoint on a file-backed CycleStore. */
export function checkpointSQLiteCycleStoreWal(
  path: string,
  mode: SQLiteWalCheckpointMode = "PASSIVE",
  options: SQLiteConnectionOptions = {},
): SQLiteWalCheckpointReport {
  const connection = new SQLiteConnection(path, options);
  try {
    return connection.checkpointWal(mode);
  } finally {
    connection.close();
  }
}

export type { SQLiteWalCheckpointMode, SQLiteWalCheckpointReport };
