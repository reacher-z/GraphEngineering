/**
 * Definition-time leaf bridge between the lower SQLite source reader and the
 * P11 owner composition.  It contains no graph logic and accepts no caller
 * callback at execution time: the sole consumer is installed exactly once
 * while the owner-composition module is initialized.
 */

type NativeProjectionConsumer = (
  composition: object,
  projection: object,
) => object;

let installedConsumer: NativeProjectionConsumer | undefined;

export function installSQLiteCursorPublicationNativeProjectionConsumerIntrinsic(
  consumer: NativeProjectionConsumer,
): void {
  if (installedConsumer !== undefined || typeof consumer !== "function") {
    throw new Error("SQLite native projection consumer installation is invalid");
  }
  installedConsumer = consumer;
}

export function hasSQLiteCursorPublicationNativeProjectionConsumerIntrinsic(): boolean {
  return installedConsumer !== undefined;
}

export function consumeSQLiteCursorPublicationNativeProjectionIntrinsic(
  composition: object,
  projection: object,
): object {
  const consumer = installedConsumer;
  if (consumer === undefined) {
    throw new Error("SQLite native projection consumer is unavailable");
  }
  return consumer(composition, projection);
}
