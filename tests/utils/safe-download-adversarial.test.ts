import { EventEmitter } from "node:events";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadSafePublicImage } from "../../src/utils/safe-download.js";
import { downloadSafePublicVideo as downloadBufferedVideo } from "../../src/utils/safe-video-download.js";
import { followSafeRedirects } from "../../src/utils/safe-http.js";
import { UnsafeUrlError } from "../../src/utils/url-guard.js";

interface FakeResponse {
  statusCode?: number;
  headers?: IncomingHttpHeaders;
  chunks?: Array<Buffer | string>;
  /** Keep the body open and send one byte this often, forever. */
  dripEveryMs?: number;
}

const META_HOSTS = [".fbcdn.net", ".facebook.com", ".cdninstagram.com"];

function fakeResolve(map: Record<string, string[] | (() => string[])>) {
  return async (hostname: string) => {
    const entry = map[hostname];
    const addresses = typeof entry === "function" ? entry() : entry ?? [];
    return addresses.map((address) => ({ address }));
  };
}

function makeRequest(responses: FakeResponse[]) {
  const calls: Array<{ url: URL; options: Record<string, unknown>; destroyed: ReturnType<typeof vi.fn> }> = [];
  const timers: NodeJS.Timeout[] = [];
  const request = vi.fn((urlInput: URL, options: Record<string, unknown>, callback: (res: IncomingMessage) => void) => {
    const req = new EventEmitter() as EventEmitter & {
      setTimeout: (ms: number, cb?: () => void) => void;
      end: () => void;
      destroy: (err?: Error) => void;
    };
    const destroyed = vi.fn();
    req.setTimeout = vi.fn();
    req.destroy = vi.fn((err?: Error) => {
      destroyed();
      if (err) queueMicrotask(() => req.emit("error", err));
    });
    calls.push({ url: urlInput, options, destroyed });
    req.end = vi.fn(() => {
      queueMicrotask(() => {
        const next = responses.shift();
        if (!next) {
          req.emit("error", new Error("No fake response queued"));
          return;
        }
        const res = new PassThrough() as IncomingMessage;
        res.statusCode = next.statusCode ?? 200;
        res.headers = next.headers ?? {};
        callback(res);
        for (const chunk of next.chunks ?? []) res.write(chunk);
        if (next.dripEveryMs !== undefined) {
          const timer = setInterval(() => {
            if (!res.destroyed) res.write("x");
          }, next.dripEveryMs);
          timers.push(timer);
          res.once("close", () => clearInterval(timer));
          req.once("error", () => clearInterval(timer));
          return;
        }
        res.end();
      });
    });
    return req;
  });
  return { request: request as never, calls, stop: () => timers.forEach(clearInterval) };
}

function lookupOf(options: Record<string, unknown>, hostname: string): Promise<{ address: string; family: number }> {
  const lookup = options.lookup as (
    host: string,
    opts: Record<string, unknown>,
    cb: (err: Error | null, address: string, family: number) => void,
  ) => void;
  return new Promise((resolve, reject) => {
    lookup(hostname, {}, (err, address, family) => (err ? reject(err) : resolve({ address, family })));
  });
}

const PNG = { "content-type": "image/png" };

describe("host policy runs before any DNS lookup", () => {
  it("never resolves a redirect target the allowlist refuses", async () => {
    const { request, calls } = makeRequest([
      { statusCode: 302, headers: { location: "https://attacker.example.org/x.png" } },
    ]);
    const resolver = vi.fn(fakeResolve({ "scontent.xx.fbcdn.net": ["203.0.113.10"], "attacker.example.org": ["203.0.113.66"] }));

    await expect(
      downloadSafePublicImage("https://scontent.xx.fbcdn.net/a.png", {
        request,
        resolve: resolver,
        allowedHostSuffixes: META_HOSTS,
        maxRedirects: 2,
      }),
    ).rejects.toThrow(/not an allowed image host/);

    expect(resolver.mock.calls.map((call) => call[0])).toEqual(["scontent.xx.fbcdn.net"]);
    expect(calls).toHaveLength(1);
  });

  it("never resolves a first hop the allowlist refuses", async () => {
    const { request } = makeRequest([]);
    const resolver = vi.fn(fakeResolve({ "attacker.example.org": ["203.0.113.66"] }));

    await expect(
      downloadSafePublicImage("https://attacker.example.org/x.png", {
        request,
        resolve: resolver,
        allowedHostSuffixes: META_HOSTS,
      }),
    ).rejects.toThrow(/not an allowed image host/);

    expect(resolver).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("applies the same order to the buffered video downloader", async () => {
    const { request } = makeRequest([]);
    const resolver = vi.fn(fakeResolve({ "attacker.example.org": ["203.0.113.66"] }));

    await expect(
      downloadBufferedVideo("https://attacker.example.org/v.mp4", { request, resolve: resolver, allowedHostSuffixes: META_HOSTS }),
    ).rejects.toThrow(/not an allowed video host/);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("treats an allowlist entry without a leading dot as an exact host, not a suffix", async () => {
    const { request } = makeRequest([]);
    const resolver = vi.fn(fakeResolve({ "evilcdn.example.com": ["203.0.113.66"] }));

    await expect(
      downloadSafePublicImage("https://evilcdn.example.com/x.png", {
        request,
        resolve: resolver,
        allowedHostSuffixes: ["cdn.example.com"],
      }),
    ).rejects.toThrow(/not an allowed image host/);
    expect(resolver).not.toHaveBeenCalled();
  });

  it.each([
    ["a look-alike", "https://evilfbcdn.net/x.png"],
    ["a suffix inside another domain", "https://scontent.fbcdn.net.attacker.example.org/x.png"],
    ["a trailing-dot look-alike", "https://fbcdn.net.evil.com./x.png"],
    ["the allowed name as userinfo", "https://scontent.xx.fbcdn.net@attacker.example.org/x.png"],
    ["the allowed name in the path", "https://attacker.example.org/scontent.xx.fbcdn.net/x.png"],
    ["the allowed name in the query", "https://attacker.example.org/x.png?h=scontent.xx.fbcdn.net"],
    ["the allowed name in the fragment", "https://attacker.example.org/x.png#scontent.xx.fbcdn.net"],
  ])("refuses %s", async (_name, target) => {
    const { request } = makeRequest([]);
    const resolver = vi.fn(fakeResolve({}));
    await expect(
      downloadSafePublicImage(target, { request, resolve: resolver, allowedHostSuffixes: META_HOSTS }),
    ).rejects.toThrow(UnsafeUrlError);
    expect(resolver).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("accepts the bare domain and a subdomain of an allowed suffix", async () => {
    for (const host of ["fbcdn.net", "scontent-ams4-1.xx.fbcdn.net", "SCONTENT.CDNINSTAGRAM.COM"]) {
      const { request } = makeRequest([{ headers: PNG, chunks: [Buffer.from("png")] }]);
      const image = await downloadSafePublicImage(`https://${host}/x.png`, {
        request,
        resolve: fakeResolve({ [host.toLowerCase()]: ["203.0.113.10"] }),
        allowedHostSuffixes: META_HOSTS,
      });
      expect(image.buffer.toString()).toBe("png");
    }
  });
});

describe("redirect abuse", () => {
  it("refuses a redirect to a private literal without opening a socket to it", async () => {
    const { request, calls } = makeRequest([
      { statusCode: 302, headers: { location: "https://10.0.0.5/admin" } },
    ]);
    await expect(
      downloadSafePublicImage("https://cdn.example.com/a.png", {
        request,
        resolve: fakeResolve({ "cdn.example.com": ["203.0.113.10"] }),
        maxRedirects: 2,
      }),
    ).rejects.toThrow(/private IP/);
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["decimal metadata", "https://2852039166/latest/meta-data/"],
    ["hex metadata", "https://0xa9fea9fe/"],
    ["IPv6 mapped metadata", "https://[::ffff:a9fe:a9fe]/"],
    ["NAT64 metadata", "https://[64:ff9b::a9fe:a9fe]/"],
    ["IPv6 loopback", "https://[::1]/"],
    ["metadata name", "https://metadata.google.internal/computeMetadata/v1/"],
    ["credentialed", "https://user:pass@cdn.example.com/a.png"],
    ["off-port", "https://cdn.example.com:6379/a.png"],
    ["downgrade", "http://cdn.example.com/a.png"],
  ])("refuses a redirect to %s", async (_name, location) => {
    const { request, calls } = makeRequest([{ statusCode: 301, headers: { location } }]);
    await expect(
      downloadSafePublicImage("https://cdn.example.com/a.png", {
        request,
        resolve: fakeResolve({ "cdn.example.com": ["203.0.113.10"] }),
        maxRedirects: 3,
      }),
    ).rejects.toThrow(UnsafeUrlError);
    expect(calls).toHaveLength(1);
  });

  it("stops a redirect chain at the cap", async () => {
    const hop = (n: number) => ({ statusCode: 302, headers: { location: `https://cdn.example.com/${n}` } });
    const { request, calls } = makeRequest([hop(1), hop(2), hop(3), hop(4), hop(5)]);
    await expect(
      downloadSafePublicImage("https://cdn.example.com/0", {
        request,
        resolve: fakeResolve({ "cdn.example.com": ["203.0.113.10"] }),
        maxRedirects: 2,
      }),
    ).rejects.toThrow(/Too many redirects/);
    expect(calls).toHaveLength(3);
  });

  it("refuses a Location that is missing or unparseable", async () => {
    for (const headers of [{}, { location: "https://[bad" }]) {
      const { request } = makeRequest([{ statusCode: 302, headers }]);
      await expect(
        downloadSafePublicImage("https://cdn.example.com/a.png", {
          request,
          resolve: fakeResolve({ "cdn.example.com": ["203.0.113.10"] }),
          maxRedirects: 2,
        }),
      ).rejects.toThrow(UnsafeUrlError);
    }
  });
});

describe("DNS rebinding", () => {
  it("connects only to the address that was validated, however the name resolves next", async () => {
    let lookups = 0;
    const resolve = fakeResolve({ "cdn.example.com": () => (lookups++ === 0 ? ["203.0.113.10"] : ["169.254.169.254"]) });
    const { request, calls } = makeRequest([{ headers: PNG, chunks: [Buffer.from("png")] }]);

    await downloadSafePublicImage("https://cdn.example.com/a.png", { request, resolve });

    expect(lookups).toBe(1);
    await expect(lookupOf(calls[0].options, "cdn.example.com")).resolves.toEqual({ address: "203.0.113.10", family: 4 });
    await expect(lookupOf(calls[0].options, "other.example.com")).rejects.toThrow(/Unexpected lookup hostname/);
  });

  it("re-validates a redirect hop that now resolves privately", async () => {
    let lookups = 0;
    const resolve = fakeResolve({ "cdn.example.com": () => (lookups++ === 0 ? ["203.0.113.10"] : ["10.1.2.3"]) });
    const { request, calls } = makeRequest([{ statusCode: 302, headers: { location: "https://cdn.example.com/second" } }]);

    await expect(
      downloadSafePublicImage("https://cdn.example.com/first", { request, resolve, maxRedirects: 2 }),
    ).rejects.toThrow(/resolves to private IP 10\.1\.2\.3/);
    expect(calls).toHaveLength(1);
  });

  it("rejects a name with one public and one metadata record", async () => {
    const { request } = makeRequest([]);
    await expect(
      downloadSafePublicImage("https://cdn.example.com/a.png", {
        request,
        resolve: fakeResolve({ "cdn.example.com": ["203.0.113.10", "64:ff9b::a9fe:a9fe"] }),
      }),
    ).rejects.toThrow(/NAT64/);
    expect(request).not.toHaveBeenCalled();
  });
});

describe("oversized and slow bodies", () => {
  afterEach(() => vi.useRealTimers());

  it("tears down a body that outgrows the cap without declaring a length", async () => {
    const { request, calls } = makeRequest([{ headers: PNG, chunks: [Buffer.alloc(6), Buffer.alloc(6)] }]);
    await expect(
      downloadSafePublicImage("https://cdn.example.com/a.png", {
        request,
        maxBytes: 10,
        resolve: fakeResolve({ "cdn.example.com": ["203.0.113.10"] }),
      }),
    ).rejects.toThrow(/too large/);
    expect(calls[0].destroyed).toHaveBeenCalled();
  });

  it("tears down a body whose declared length lies below what it sends", async () => {
    const { request, calls } = makeRequest([
      { headers: { ...PNG, "content-length": "4" }, chunks: [Buffer.alloc(8), Buffer.alloc(8)] },
    ]);
    await expect(
      downloadSafePublicImage("https://cdn.example.com/a.png", {
        request,
        maxBytes: 10,
        resolve: fakeResolve({ "cdn.example.com": ["203.0.113.10"] }),
      }),
    ).rejects.toThrow(/too large/);
    expect(calls[0].destroyed).toHaveBeenCalled();
  });

  it("cuts off a peer that drips one byte at a time, which the idle timeout never would", async () => {
    const fake = makeRequest([{ headers: PNG, dripEveryMs: 5 }]);
    const started = Date.now();

    await expect(
      downloadSafePublicImage("https://cdn.example.com/a.png", {
        request: fake.request,
        resolve: fakeResolve({ "cdn.example.com": ["203.0.113.10"] }),
        maxBytes: 5_000_000,
        timeoutMs: 30_000,
        deadlineMs: 120,
      }),
    ).rejects.toThrow(/timed out after 120ms/);

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(fake.calls[0].destroyed).toHaveBeenCalled();
    fake.stop();
  });

  it("cuts off a dripping buffered video the same way", async () => {
    const fake = makeRequest([{ headers: { "content-type": "video/mp4" }, dripEveryMs: 5 }]);
    await expect(
      downloadBufferedVideo("https://video.xx.fbcdn.net/v.mp4", {
        request: fake.request,
        resolve: fakeResolve({ "video.xx.fbcdn.net": ["203.0.113.10"] }),
        allowedHostSuffixes: META_HOSTS,
        deadlineMs: 120,
      }),
    ).rejects.toThrow(/timed out after 120ms/);
    fake.stop();
  });

  it("counts a slow DNS answer against the deadline", async () => {
    const slow = () => new Promise<Array<{ address: string }>>((resolve) => setTimeout(() => resolve([{ address: "203.0.113.10" }]), 2_000).unref());
    const { request } = makeRequest([]);
    const started = Date.now();
    await expect(
      downloadSafePublicImage("https://cdn.example.com/a.png", { request, resolve: slow, deadlineMs: 100 }),
    ).rejects.toThrow(/timed out after 100ms/);
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps a caller abort distinct from the deadline", async () => {
    const fake = makeRequest([{ headers: PNG, dripEveryMs: 5 }]);
    const controller = new AbortController();
    const pending = downloadSafePublicImage("https://cdn.example.com/a.png", {
      request: fake.request,
      resolve: fakeResolve({ "cdn.example.com": ["203.0.113.10"] }),
      signal: controller.signal,
      deadlineMs: 10_000,
    });
    setTimeout(() => controller.abort(), 30);
    await expect(pending).rejects.toThrow(/aborted/i);
    fake.stop();
  });

  it("does not leave a deadline timer running after a normal download", async () => {
    vi.useFakeTimers();
    const { request } = makeRequest([{ headers: PNG, chunks: [Buffer.from("png")] }]);
    const pending = downloadSafePublicImage("https://cdn.example.com/a.png", {
      request,
      resolve: fakeResolve({ "cdn.example.com": ["203.0.113.10"] }),
      deadlineMs: 5_000,
    });
    await vi.advanceTimersByTimeAsync(10);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("followSafeRedirects budget", () => {
  it("hands the same combined signal to every hop", async () => {
    const seen: Array<AbortSignal | undefined> = [];
    const resolve = fakeResolve({ "cdn.example.com": ["203.0.113.10"] });
    await followSafeRedirects("https://cdn.example.com/a", { maxRedirects: 1, resolve, deadlineMs: 5_000 }, async (resolved, signal) => {
      seen.push(signal);
      return seen.length === 1 ? { redirectUrl: new URL("https://cdn.example.com/b") } : { done: true, host: resolved.url.hostname };
    });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]?.aborted).toBe(false);
  });
});
