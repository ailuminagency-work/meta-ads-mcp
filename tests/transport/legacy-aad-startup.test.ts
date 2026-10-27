import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "../fixtures/crypto/fake-firestore.js";
import { startAuthServer, type AuthServer } from "./auth-flow-harness.js";

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../src/store/firestore.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/store/firestore.js")>()),
  getFirestore: () => holder.db,
  isFirestoreEnabled: () => true,
}));

import { resetLegacyNoAadLogForTests } from "../../src/store/meta-token-repo.js";
import { logger } from "../../src/utils/logger.js";

let server: AuthServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetLegacyNoAadLogForTests();
});

const legacyWarnings = (warn: ReturnType<typeof vi.spyOn>) =>
  warn.mock.calls.filter((call) => JSON.stringify(call).includes("TOKEN_DECRYPT_ALLOW_LEGACY_NO_AAD"));

describe("startup with Firestore-backed token storage", () => {
  it("logs one count-free warning while the legacy no-AAD fallback is on (the default)", async () => {
    holder.db = new FakeFirestore();
    resetLegacyNoAadLogForTests();
    const warn = vi.spyOn(logger, "warn");
    server = await startAuthServer({ TOKEN_DECRYPT_ALLOW_LEGACY_NO_AAD: undefined });
    expect(legacyWarnings(warn)).toHaveLength(1);
  });

  it("stays silent when the fallback is switched off", async () => {
    holder.db = new FakeFirestore();
    resetLegacyNoAadLogForTests();
    const warn = vi.spyOn(logger, "warn");
    server = await startAuthServer({ TOKEN_DECRYPT_ALLOW_LEGACY_NO_AAD: "false" });
    expect(legacyWarnings(warn)).toHaveLength(0);
  });

  it("refuses to start on a malformed value", async () => {
    holder.db = new FakeFirestore();
    resetLegacyNoAadLogForTests();
    await expect(startAuthServer({ TOKEN_DECRYPT_ALLOW_LEGACY_NO_AAD: "maybe" })).rejects.toThrow(/must be "true" or "false"/);
  });
});
