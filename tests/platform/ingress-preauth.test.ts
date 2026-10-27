import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import net from "node:net";
import { readFile } from "node:fs/promises";
import {
  createMediaIngressRouter,
  mediaIngressPreauthSignature,
  mediaIngressSignature,
  type MediaIngressProfile,
} from "../../src/platform/media-ingress.js";
import {
  createVideoIngressRouter,
  videoIngressPreauthSignature,
  videoIngressSignature,
  type VideoIngressProfile,
} from "../../src/platform/video-ingress.js";
import {
  attachmentIngressPreauthSignature,
  attachmentIngressSignature,
  createAttachmentIngressRouter,
  type AttachmentProfile,
} from "../../src/platform/attachment-ingress.js";
import {
  createPublishingVideoIngressRouter,
  publishingVideoIngressPreauthSignature,
  publishingVideoIngressSignature,
  type PublishingVideoProfile,
} from "../../src/platform/publishing-video-ingress.js";
import {
  DeliveryReplayCache,
  ingressPreauthSignature,
  INGRESS_PREAUTH_HEADER,
  legacyBodySignatureAllowed,
} from "../../src/platform/ingress-preauth.js";

const KEY = "a".repeat(64);
const MIB = 1024 * 1024;

const mediaProfile: MediaIngressProfile = {
  id: "adapter",
  tenantId: "t",
  clientId: "c",
  operatorId: "actor",
  connectionId: "connection",
  accountId: "101",
  appId: "300",
  provider: "META_INSTAGRAM_LOGIN",
  purpose: "instagram_messaging",
  secretReference: "LUMIN_MEDIA_INGRESS_KEY_TEST",
  allowedHost: "assets.example.com",
  enabled: true,
};
const videoProfile: VideoIngressProfile = {
  id: "video",
  tenantId: "tenant",
  clientId: "client",
  operatorId: "100",
  connectionId: "connection",
  accountId: "201",
  appId: "300",
  provider: "META_FACEBOOK_PAGES",
  purpose: "facebook_video_publishing",
  secretReference: "LUMIN_VIDEO_INGRESS_KEY_FIXTURE",
  allowedHost: "media.fixture.invalid",
  enabled: true,
};
const attachmentProfile = {
  id: "attach",
  tenantId: "tenant",
  clientId: "client",
  operatorId: "100",
  connectionId: "connection",
  accountId: "201",
  appId: "300",
  provider: "META_MESSENGER",
  purpose: "facebook_messaging_file",
  secretReference: "LUMIN_ATTACHMENT_INGRESS_KEY_FIXTURE",
  allowedHost: "media.fixture.invalid",
  enabled: true,
} as AttachmentProfile;
const publishingProfile: PublishingVideoProfile = {
  id: "publish",
  tenantId: "tenant",
  clientId: "client",
  operatorId: "100",
  connectionId: "connection",
  accountId: "123",
  appId: "300",
  provider: "META_MARKETING",
  purpose: "meta_ad_video_upload",
  draftTools: ["marketing_upload_video"],
  secretReference: "LUMIN_PUBLISHING_VIDEO_INGRESS_KEY_TEST",
  allowedHost: "assets.example.com",
  enabled: true,
} as PublishingVideoProfile;

interface Adapter {
  name: string;
  profileId: string;
  cap: number;
  unknownStatus: number;
  serialised: boolean;
  build(enabled: boolean, stage: () => Promise<unknown>): express.Router;
  legacy(raw: Buffer, timestamp: string, delivery: string): string;
  preauth(timestamp: string, delivery: string, length: number): string;
}

const service = (stage: () => Promise<unknown>) => ({ stage }) as never;

const adapters: Adapter[] = [
  {
    name: "media",
    profileId: mediaProfile.id,
    cap: 12 * MIB,
    unknownStatus: 404,
    serialised: false,
    build: (enabled, stage) => createMediaIngressRouter({ profiles: [{ ...mediaProfile, enabled }], service: service(stage), secret: async () => KEY }),
    legacy: (raw, ts, delivery) => mediaIngressSignature(raw, mediaProfile, ts, delivery, KEY),
    preauth: (ts, delivery, length) => mediaIngressPreauthSignature(mediaProfile, ts, delivery, length, KEY),
  },
  {
    name: "video",
    profileId: videoProfile.id,
    cap: 24 * MIB,
    unknownStatus: 403,
    serialised: true,
    build: (enabled, stage) => createVideoIngressRouter({ profiles: [{ ...videoProfile, enabled }], service: service(stage), secret: async () => KEY }),
    legacy: (raw, ts, delivery) => videoIngressSignature(raw, videoProfile, ts, delivery, KEY),
    preauth: (ts, delivery, length) => videoIngressPreauthSignature(videoProfile, ts, delivery, length, KEY),
  },
  {
    name: "attachment",
    profileId: attachmentProfile.id,
    cap: 12 * MIB,
    unknownStatus: 403,
    serialised: true,
    build: (enabled, stage) => createAttachmentIngressRouter({ profiles: [{ ...attachmentProfile, enabled }], service: service(stage), secret: async () => KEY }),
    legacy: (raw, ts, delivery) => attachmentIngressSignature(raw, attachmentProfile, ts, delivery, KEY),
    preauth: (ts, delivery, length) => attachmentIngressPreauthSignature(attachmentProfile, ts, delivery, length, KEY),
  },
  {
    name: "publishing-video",
    profileId: publishingProfile.id,
    cap: 24 * MIB,
    unknownStatus: 403,
    serialised: true,
    build: (enabled, stage) => createPublishingVideoIngressRouter({ profiles: [{ ...publishingProfile, enabled }], service: service(stage), secret: async () => KEY }),
    legacy: (raw, ts, delivery) => publishingVideoIngressSignature(raw, publishingProfile, ts, delivery, KEY),
    preauth: (ts, delivery, length) => publishingVideoIngressPreauthSignature(publishingProfile, ts, delivery, length, KEY),
  },
];

let servers: http.Server[] = [];
let sockets: net.Socket[] = [];
let stage = vi.fn(async () => ({ proposalId: "a".repeat(64), planHash: "b".repeat(64), expiresAt: Date.now() + 60_000 }));

beforeEach(() => {
  stage = vi.fn(async () => ({ proposalId: "a".repeat(64), planHash: "b".repeat(64), expiresAt: Date.now() + 60_000 }));
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("LUMIN_INGRESS_ALLOW_LEGACY_BODY_SIGNATURE", "");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function listen(router: express.Router): Promise<number> {
  const app = express();
  app.use("/ingress", router);
  const server = http.createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as net.AddressInfo).port;
}

interface Head {
  path: string;
  contentLength: number;
  timestamp?: string;
  delivery?: string;
  signature?: string;
  preauth?: string;
}

const validShape = "sha256=" + "b".repeat(64);

let shared: Buffer | undefined;
const filler = (): Buffer => (shared ??= Buffer.alloc(10 * MIB, 0x20));

/** Sends the head and `sent` bytes of a body that is declared longer, then waits for an answer without finishing the upload. */
function stalled(port: number, head: Head, sent: number, waitMs = 1_500): Promise<{ status: number; ms: number }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.connect(port, "127.0.0.1", () => {
      const lines = [`POST ${head.path} HTTP/1.1`, "Host: x", "Content-Type: application/json", `Content-Length: ${head.contentLength}`];
      if (head.timestamp) lines.push(`x-lumin-timestamp: ${head.timestamp}`);
      if (head.delivery) lines.push(`x-lumin-delivery: ${head.delivery}`);
      if (head.signature) lines.push(`x-lumin-signature: ${head.signature}`);
      if (head.preauth) lines.push(`${INGRESS_PREAUTH_HEADER}: ${head.preauth}`);
      socket.write(lines.join("\r\n") + "\r\n\r\n");
      socket.write(filler().subarray(0, sent));
    });
    sockets.push(socket);
    let received = "";
    const timer = setTimeout(() => resolve({ status: -1, ms: Date.now() - started }), waitMs);
    socket.on("data", (chunk) => {
      received += chunk.toString();
      const match = /^HTTP\/1\.1 (\d{3})/.exec(received);
      if (match) {
        clearTimeout(timer);
        resolve({ status: Number(match[1]), ms: Date.now() - started });
      }
    });
    socket.on("error", () => {
      clearTimeout(timer);
      resolve({ status: 0, ms: Date.now() - started });
    });
  });
}

function signedHead(adapter: Adapter, length: number, overrides: Partial<Head> = {}, withPreauth = true): Head {
  const timestamp = String(Date.now());
  const delivery = "synthetic-delivery";
  return {
    path: `/ingress/${adapter.profileId}`,
    contentLength: length,
    timestamp,
    delivery,
    signature: validShape,
    ...(withPreauth ? { preauth: adapter.preauth(timestamp, delivery, length) } : {}),
    ...overrides,
  };
}

let deliveries = 0;

async function signedPost(port: number, adapter: Adapter, raw: Buffer, options: { legacyBody?: Buffer; preauthLength?: number } = {}): Promise<number> {
  const timestamp = String(Date.now());
  deliveries += 1;
  const delivery = `synthetic-delivery-${deliveries}`;
  const response = await fetch(`http://127.0.0.1:${port}/ingress/${adapter.profileId}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-lumin-timestamp": timestamp,
      "x-lumin-delivery": delivery,
      "x-lumin-signature": adapter.legacy(options.legacyBody ?? raw, timestamp, delivery),
      [INGRESS_PREAUTH_HEADER]: adapter.preauth(timestamp, delivery, options.preauthLength ?? raw.length),
    },
    body: raw,
  });
  return response.status;
}

describe.each(adapters)("$name ingress answers from the headers before it reads the body (G3-02, G3-03)", (adapter) => {
  it("answers an unknown profile at once, with the status it always used, while the upload is still in flight", async () => {
    const port = await listen(adapter.build(true, stage));
    const answer = await stalled(port, { ...signedHead(adapter, 5 * MIB, {}, false), path: "/ingress/does-not-exist" }, 1_000);
    expect(answer.status).toBe(adapter.unknownStatus);
    expect(stage).not.toHaveBeenCalled();
  });

  it("answers a disabled profile at once", async () => {
    const port = await listen(adapter.build(false, stage));
    expect((await stalled(port, signedHead(adapter, 5 * MIB), 1_000)).status).toBe(403);
  });

  it.each([
    ["no timestamp", { timestamp: undefined }],
    ["a stale timestamp", { timestamp: String(Date.now() - 3_600_000) }],
    ["a malformed delivery id", { delivery: "bad delivery!" }],
    ["a malformed signature", { signature: "sha256=zz" }],
    ["no signature", { signature: undefined }],
  ])("answers 401 at once for %s", async (_label, overrides) => {
    const port = await listen(adapter.build(true, stage));
    const head = { ...signedHead(adapter, 5 * MIB, {}, false), ...overrides } as Head;
    expect((await stalled(port, head, 1_000)).status).toBe(401);
  });

  it("refuses a request without the pre-auth signature at once in production, instead of buffering it to check the body signature", async () => {
    const port = await listen(adapter.build(true, stage));
    const answer = await stalled(port, signedHead(adapter, 5 * MIB, {}, false), 1_000);
    expect(answer.status).toBe(401);
    expect(stage).not.toHaveBeenCalled();
  });

  it("refuses a request without the pre-auth signature when NODE_ENV is unset or empty", async () => {
    vi.stubEnv("NODE_ENV", "");
    const port = await listen(adapter.build(true, stage));
    expect((await stalled(port, signedHead(adapter, 5 * MIB, {}, false), 1_000)).status).toBe(401);
  });

  it("answers a wrong pre-auth signature at once, without taking the in-flight slot", async () => {
    const port = await listen(adapter.build(true, stage));
    const wrong = "sha256=" + "0".repeat(64);
    const attacker = await stalled(port, signedHead(adapter, 5 * MIB, { preauth: wrong }), 1_000);
    expect(attacker.status).toBe(401);

    const raw = Buffer.from("{}");
    expect(await signedPost(port, adapter, raw)).toBe(400);
  });

  it("answers a pre-auth signature computed for another length at once", async () => {
    const port = await listen(adapter.build(true, stage));
    const timestamp = String(Date.now());
    const preauth = adapter.preauth(timestamp, "synthetic-delivery", 100);
    const answer = await stalled(port, signedHead(adapter, 5 * MIB, { timestamp, preauth }), 1_000);
    expect(answer.status).toBe(401);
  });

  it("refuses a declared length above the cap at once, whatever else it carries", async () => {
    const port = await listen(adapter.build(true, stage));
    const answer = await stalled(port, signedHead(adapter, adapter.cap + 1), 1_000);
    expect(answer.status).toBe(413);
  });

  it("requires a Content-Length on a pre-authenticated request", async () => {
    const port = await listen(adapter.build(true, stage));
    const timestamp = String(Date.now());
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        `http://127.0.0.1:${port}/ingress/${adapter.profileId}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "transfer-encoding": "chunked",
            "x-lumin-timestamp": timestamp,
            "x-lumin-delivery": "synthetic-delivery",
            "x-lumin-signature": validShape,
            [INGRESS_PREAUTH_HEADER]: adapter.preauth(timestamp, "synthetic-delivery", 2),
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.write("{}");
    });
    expect(status).toBe(411);
  });

  it("still verifies the body signature after the body is buffered: a valid pre-auth signature does not authenticate the content", async () => {
    const port = await listen(adapter.build(true, stage));
    const raw = Buffer.from('{"tampered":true}');
    expect(await signedPost(port, adapter, raw, { legacyBody: Buffer.from('{"other":true}') })).toBe(401);
    expect(stage).not.toHaveBeenCalled();
  });

  it("reads a fully authenticated request through to the handler", async () => {
    const port = await listen(adapter.build(true, stage));
    expect(await signedPost(port, adapter, Buffer.from("{}"))).toBe(400);
  });

  it("does not let an attacker who knows the profile id keep legitimate uploads out", async () => {
    const port = await listen(adapter.build(true, stage));
    const wrong = "sha256=" + "0".repeat(64);
    const attackers = await Promise.all(Array.from({ length: 4 }, () => stalled(port, signedHead(adapter, 5 * MIB, { preauth: wrong }), 1_000)));
    expect(attackers.map((a) => a.status)).toEqual([401, 401, 401, 401]);
    expect(await signedPost(port, adapter, Buffer.from("{}"))).toBe(400);
  });
});

describe.each(adapters.filter((adapter) => adapter.serialised))("$name ingress keeps a single verified upload in flight", (adapter) => {
  it("answers 429 to a second authenticated upload while the first is still arriving, then admits it once the first ends", async () => {
    const port = await listen(adapter.build(true, stage));
    const first = signedHead(adapter, 1_000);
    const hold = stalled(port, first, 10, 600);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(await signedPost(port, adapter, Buffer.from("{}"))).toBe(429);

    expect((await hold).status).toBe(-1);
    for (const socket of sockets.splice(0)) socket.destroy();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await signedPost(port, adapter, Buffer.from("{}"))).toBe(400);
  });
});

describe("media ingress no longer buffers for callers it has not authenticated (G3-02)", () => {
  it("holds no body memory for 20 stalled 10 MiB uploads to an unknown profile", async () => {
    const port = await listen(createMediaIngressRouter({ profiles: [], service: service(stage), secret: async () => "" }));
    const before = process.memoryUsage();
    const answers = await Promise.all(
      Array.from({ length: 20 }, () =>
        stalled(port, { path: "/ingress/does-not-exist", contentLength: 11 * MIB, timestamp: String(Date.now()), delivery: "d", signature: validShape }, 10 * MIB, 5_000),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    const grown = (process.memoryUsage().external - before.external) / MIB;
    expect(answers.every((answer) => answer.status === 404)).toBe(true);
    expect(grown).toBeLessThan(50);
  }, 30_000);
});

/** One fixed header set, as a captured request would carry it. */
function captured(adapter: Adapter, raw: Buffer, delivery = "synthetic-replay-delivery") {
  const timestamp = String(Date.now());
  return {
    timestamp,
    delivery,
    signature: adapter.legacy(raw, timestamp, delivery),
    preauth: adapter.preauth(timestamp, delivery, raw.length),
    raw,
  };
}

async function sendCaptured(port: number, adapter: Adapter, set: ReturnType<typeof captured>, bodyOverride?: Buffer): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${port}/ingress/${adapter.profileId}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-lumin-timestamp": set.timestamp,
      "x-lumin-delivery": set.delivery,
      "x-lumin-signature": set.signature,
      [INGRESS_PREAUTH_HEADER]: set.preauth,
    },
    body: bodyOverride ?? set.raw,
  });
  return response.status;
}

describe.each(adapters)("$name ingress refuses a replayed header set (G3R-02)", (adapter) => {
  it("answers a replay of a request that was processed with 409 at once, without taking the slot, while a fresh delivery still passes", async () => {
    const port = await listen(adapter.build(true, stage));
    const set = captured(adapter, Buffer.from("{}"));
    expect(await sendCaptured(port, adapter, set)).toBe(400);

    const replay = await stalled(
      port,
      { path: `/ingress/${adapter.profileId}`, contentLength: set.raw.length, timestamp: set.timestamp, delivery: set.delivery, signature: set.signature, preauth: set.preauth },
      0,
    );
    expect(replay.status).toBe(409);
    expect(await signedPost(port, adapter, Buffer.from("{}"))).toBe(400);
  });

  it("refuses a replay while the original is still arriving, and does not let it hold the slot", async () => {
    const port = await listen(adapter.build(true, stage));
    const set = captured(adapter, Buffer.from("{}"));
    const head = { path: `/ingress/${adapter.profileId}`, contentLength: 1_000, timestamp: set.timestamp, delivery: set.delivery, signature: set.signature, preauth: adapter.preauth(set.timestamp, set.delivery, 1_000) };
    const original = stalled(port, head, 10, 600);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect((await stalled(port, head, 10)).status).toBe(409);
    expect((await original).status).toBe(-1);
  });

  it("lets the sender retry the same delivery after an attempt that failed its body signature", async () => {
    const port = await listen(adapter.build(true, stage));
    const set = captured(adapter, Buffer.from("{}"));
    expect(await sendCaptured(port, adapter, { ...set, signature: "sha256=" + "0".repeat(64) })).toBe(401);
    expect(await sendCaptured(port, adapter, set)).toBe(400);
  });

  it("lets the sender retry the same delivery after an upload that was aborted", async () => {
    const port = await listen(adapter.build(true, stage));
    const set = captured(adapter, Buffer.from("{}"));
    const head = { path: `/ingress/${adapter.profileId}`, contentLength: 1_000, timestamp: set.timestamp, delivery: set.delivery, signature: set.signature, preauth: adapter.preauth(set.timestamp, set.delivery, 1_000) };
    expect((await stalled(port, head, 10, 400)).status).toBe(-1);
    for (const socket of sockets.splice(0)) socket.destroy();
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(await sendCaptured(port, adapter, set)).toBe(400);
  });
});

describe("DeliveryReplayCache", () => {
  let now = 1_700_000_000_000;
  const cache = (maxPerProfile = 3) => new DeliveryReplayCache({ ttlMs: 600_000, maxPerProfile, now: () => now });

  it("claims a delivery once per profile and forgets it after the window", () => {
    const store = cache();
    expect(store.claim("p", "d1")).toBe(true);
    expect(store.claim("p", "d1")).toBe(false);
    expect(store.claim("q", "d1")).toBe(true);
    now += 599_999;
    expect(store.claim("p", "d1")).toBe(false);
    now += 2;
    expect(store.claim("p", "d1")).toBe(true);
  });

  it("lets a released delivery be claimed again", () => {
    const store = cache();
    expect(store.claim("p", "d1")).toBe(true);
    store.release("p", "d1");
    expect(store.claim("p", "d1")).toBe(true);
  });

  it("stays bounded: a full profile evicts its oldest settled delivery and never an active one", () => {
    const store = cache(3);
    for (const id of ["d1", "d2", "d3"]) {
      expect(store.claim("p", id)).toBe(true);
      store.settle("p", id);
    }
    expect(store.claim("p", "d4")).toBe(true);
    expect(store.size("p")).toBe(3);
    expect(store.claim("p", "d1")).toBe(true);
    expect(store.claim("p", "d4")).toBe(false);
  });

  it("refuses a new delivery when every entry is still in flight, instead of dropping one", () => {
    const store = cache(2);
    expect(store.claim("p", "a")).toBe(true);
    expect(store.claim("p", "b")).toBe(true);
    expect(store.claim("p", "c")).toBe(false);
    expect(store.size("p")).toBe(2);
  });

  it("does not let one profile fill another's table", () => {
    const store = cache(2);
    for (let index = 0; index < 50; index += 1) {
      store.claim("busy", `d${index}`);
      store.settle("busy", `d${index}`);
    }
    expect(store.size("busy")).toBe(2);
    expect(store.claim("quiet", "d0")).toBe(true);
  });
});

describe("video ingress end to end with the pre-authenticated protocol", () => {
  it("stages the exact bytes of a request that carries both signatures", async () => {
    const bytes = await readFile(new URL("../fixtures/video/standard-h264-320x240-1s.mp4", import.meta.url));
    const now = Date.now();
    const raw = Buffer.from(
      JSON.stringify({
        mp4_base64: bytes.toString("base64"),
        url: "https://media.fixture.invalid/video.mp4",
        ai_generated: false,
        immutable: true,
        rights: { granted: true, purpose: "facebook_video_publishing", checked_at: now, expires_at: now + 3_600_000 },
      }),
    );
    const port = await listen(adapters[1].build(true, stage));

    expect(await signedPost(port, adapters[1], raw)).toBe(202);

    expect(stage).toHaveBeenCalledTimes(1);
    const source = (stage.mock.calls[0] as unknown as [unknown, string, { bytes: Uint8Array }])[2];
    expect(Buffer.from(source.bytes)).toEqual(bytes);
  });
});

describe("the legacy body-only signature", () => {
  it("is still accepted in test and development runs and when an operator names the exception", () => {
    expect(legacyBodySignatureAllowed({ NODE_ENV: "test" })).toBe(true);
    expect(legacyBodySignatureAllowed({ NODE_ENV: "development" })).toBe(true);
    expect(legacyBodySignatureAllowed({ NODE_ENV: "production", LUMIN_INGRESS_ALLOW_LEGACY_BODY_SIGNATURE: "true" })).toBe(true);
  });

  it("is refused in production, when NODE_ENV is unset or empty, and for any spelling of the exception other than exactly true", () => {
    expect(legacyBodySignatureAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(legacyBodySignatureAllowed({})).toBe(false);
    expect(legacyBodySignatureAllowed({ NODE_ENV: "" })).toBe(false);
    for (const value of ["TRUE", "1", "yes", " true", "false", ""]) {
      expect(legacyBodySignatureAllowed({ NODE_ENV: "production", LUMIN_INGRESS_ALLOW_LEGACY_BODY_SIGNATURE: value })).toBe(false);
    }
  });

  it("is accepted end to end under the named exception", async () => {
    vi.stubEnv("LUMIN_INGRESS_ALLOW_LEGACY_BODY_SIGNATURE", "true");
    const adapter = adapters[1];
    const port = await listen(adapter.build(true, stage));
    const raw = Buffer.from("{}");
    const timestamp = String(Date.now());
    const response = await fetch(`http://127.0.0.1:${port}/ingress/${adapter.profileId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lumin-timestamp": timestamp, "x-lumin-delivery": "synthetic-delivery", "x-lumin-signature": adapter.legacy(raw, timestamp, "synthetic-delivery") },
      body: raw,
    });
    expect(response.status).toBe(400);
  });
});

describe("pre-auth signature", () => {
  it("is separated by router, profile, binding, timestamp, delivery and length", () => {
    const base = ["video", "p", "b", "1700000000000", "d", 10, KEY] as const;
    const reference = ingressPreauthSignature(...base);
    expect(reference).toMatch(/^sha256=[a-f0-9]{64}$/);
    const variants = [
      ingressPreauthSignature("publishing-video", "p", "b", "1700000000000", "d", 10, KEY),
      ingressPreauthSignature("video", "q", "b", "1700000000000", "d", 10, KEY),
      ingressPreauthSignature("video", "p", "c", "1700000000000", "d", 10, KEY),
      ingressPreauthSignature("video", "p", "b", "1700000000001", "d", 10, KEY),
      ingressPreauthSignature("video", "p", "b", "1700000000000", "e", 10, KEY),
      ingressPreauthSignature("video", "p", "b", "1700000000000", "d", 11, KEY),
      ingressPreauthSignature("video", "p", "b", "1700000000000", "d", 10, "b".repeat(64)),
    ];
    for (const variant of variants) expect(variant).not.toBe(reference);
    expect(new Set(variants).size).toBe(variants.length);
  });
});
