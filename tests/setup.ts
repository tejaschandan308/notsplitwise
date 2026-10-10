import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, vi } from "vitest";
import { closeDbForTests, DB_NAME } from "@/lib/db";

beforeEach(async () => {
  closeDbForTests();
  await Dexie.delete(DB_NAME);
  vi.stubGlobal("navigator", { onLine: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
