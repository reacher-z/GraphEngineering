import { open } from "node:fs/promises";

export function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code;
}

export function decodeUtf8(buffer: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
}

export async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
