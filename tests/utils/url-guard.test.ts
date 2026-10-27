import { describe, expect, it, vi } from "vitest";
import {
  assertSafePublicUrl,
  UnsafeUrlError,
  unsafeIpReason,
} from "../../src/utils/url-guard.js";

function fakeResolve(addresses: string[]) {
  return async (_hostname: string) => addresses.map((address) => ({ address }));
}

describe("assertSafePublicUrl", () => {
  it("accepts a public https URL whose host resolves to a public IP", async () => {
    const url = await assertSafePublicUrl("https://example.com/path", {
      resolve: fakeResolve(["93.184.216.34"]),
    });
    expect(url.toString()).toBe("https://example.com/path");
  });

  it("rejects http://", async () => {
    await expect(
      assertSafePublicUrl("http://example.com/x", { resolve: fakeResolve(["8.8.8.8"]) }),
    ).rejects.toThrow(UnsafeUrlError);
  });

  it("rejects file://", async () => {
    await expect(
      assertSafePublicUrl("file:///etc/passwd", { resolve: fakeResolve([]) }),
    ).rejects.toThrow(UnsafeUrlError);
  });

  it("rejects malformed URLs", async () => {
    await expect(
      assertSafePublicUrl("not-a-url", { resolve: fakeResolve([]) }),
    ).rejects.toThrow(/malformed/i);
  });

  it("rejects literal RFC1918 IPs", async () => {
    await expect(
      assertSafePublicUrl("https://10.0.0.1/", { resolve: fakeResolve([]) }),
    ).rejects.toThrow(/RFC1918 10\.0\.0\.0\/8/);
    await expect(
      assertSafePublicUrl("https://192.168.1.1/", { resolve: fakeResolve([]) }),
    ).rejects.toThrow(/RFC1918 192\.168/);
    await expect(
      assertSafePublicUrl("https://172.20.0.1/", { resolve: fakeResolve([]) }),
    ).rejects.toThrow(/RFC1918 172\.16/);
  });

  it("rejects literal loopback IPs", async () => {
    await expect(
      assertSafePublicUrl("https://127.0.0.1/", { resolve: fakeResolve([]) }),
    ).rejects.toThrow(/loopback/i);
  });

  it("rejects the GCP metadata service IP", async () => {
    await expect(
      assertSafePublicUrl("https://169.254.169.254/computeMetadata/v1/", {
        resolve: fakeResolve([]),
      }),
    ).rejects.toThrow(/link-local|GCP metadata/i);
  });

  it("rejects hostnames that resolve to a private IP (DNS rebinding defense)", async () => {
    await expect(
      assertSafePublicUrl("https://attacker-controlled.com/x", {
        resolve: fakeResolve(["10.1.2.3"]),
      }),
    ).rejects.toThrow(/resolves to private IP 10\.1\.2\.3/);
  });

  it("rejects when one of multiple resolved IPs is private (mixed A records)", async () => {
    await expect(
      assertSafePublicUrl("https://example.com/x", {
        resolve: fakeResolve(["8.8.8.8", "127.0.0.1"]),
      }),
    ).rejects.toThrow(/127\.0\.0\.1/);
  });

  it("rejects IPv6 loopback", async () => {
    await expect(
      assertSafePublicUrl("https://[::1]/", { resolve: fakeResolve([]) }),
    ).rejects.toThrow(/IPv6 loopback/i);
  });

  it("rejects IPv6 link-local", async () => {
    await expect(
      assertSafePublicUrl("https://[fe80::1]/", { resolve: fakeResolve([]) }),
    ).rejects.toThrow(/link-local/i);
  });

  it("rejects IPv6 unique-local", async () => {
    await expect(
      assertSafePublicUrl("https://[fd00::1]/", { resolve: fakeResolve([]) }),
    ).rejects.toThrow(/unique-local/i);
  });

  it("rejects IPv4-mapped IPv6 to a private v4", async () => {
    await expect(
      assertSafePublicUrl("https://[::ffff:127.0.0.1]/", {
        resolve: fakeResolve([]),
      }),
    ).rejects.toThrow(/IPv4-mapped/);
  });

  it("rejects when DNS resolution fails", async () => {
    await expect(
      assertSafePublicUrl("https://nope.invalid/", {
        resolve: async () => {
          throw new Error("ENOTFOUND");
        },
      }),
    ).rejects.toThrow(/Cannot resolve/);
  });

  it("rejects when DNS returns no addresses", async () => {
    await expect(
      assertSafePublicUrl("https://nope.invalid/", { resolve: fakeResolve([]) }),
    ).rejects.toThrow(/did not resolve/);
  });
});

describe("reserved IPv4 ranges", () => {
  it.each([
    "https://0.0.0.1/",
    "https://10.255.255.255/",
    "https://100.64.0.1/",
    "https://100.127.255.255/",
    "https://127.255.255.255/",
    "https://169.254.169.254/",
    "https://169.254.0.1/",
    "https://172.16.0.1/",
    "https://172.31.255.255/",
    "https://192.0.0.1/",
    "https://192.0.0.170/",
    "https://192.88.99.1/",
    "https://192.168.255.255/",
    "https://198.18.0.1/",
    "https://198.19.255.254/",
    "https://224.0.0.1/",
    "https://239.255.255.255/",
    "https://240.0.0.1/",
    "https://255.255.255.255/",
  ])("refuses literal %s", async (target) => {
    await expect(assertSafePublicUrl(target, { resolve: fakeResolve([]) })).rejects.toThrow(/private IP/);
  });

  it.each([
    "https://8.8.8.8/",
    "https://172.15.255.255/",
    "https://172.32.0.1/",
    "https://100.63.255.255/",
    "https://100.128.0.1/",
    "https://192.0.1.1/",
    "https://198.17.255.255/",
    "https://198.20.0.1/",
    "https://223.255.255.255/",
  ])("keeps the boundary: %s is public", async (target) => {
    await expect(assertSafePublicUrl(target, { resolve: fakeResolve([]) })).resolves.toBeInstanceOf(URL);
  });

  it("refuses a host name that resolves into a newly covered range", async () => {
    for (const address of ["192.0.0.9", "198.18.5.5", "198.19.0.1"]) {
      await expect(
        assertSafePublicUrl("https://cdn.example.com/x", { resolve: fakeResolve([address]) }),
      ).rejects.toThrow(/resolves to private IP/);
    }
  });
});

describe("IPv4 spelled as decimal, octal or hex", () => {
  it.each([
    ["decimal loopback", "https://2130706433/"],
    ["hex loopback", "https://0x7f000001/"],
    ["dotted hex loopback", "https://0x7f.0.0.1/"],
    ["octal loopback", "https://017700000001/"],
    ["dotted octal loopback", "https://0177.0.0.1/"],
    ["short loopback", "https://127.1/"],
    ["zero", "https://0/"],
    ["decimal metadata", "https://2852039166/computeMetadata/v1/"],
    ["hex metadata", "https://0xa9fea9fe/"],
    ["octal metadata", "https://025177524776/"],
    ["decimal RFC1918", "https://167772161/"],
    ["fullwidth digits", "https://１２７.０.０.１/"],
  ])("refuses %s", async (_name, target) => {
    const resolve = vi.fn(fakeResolve(["8.8.8.8"]));
    await expect(assertSafePublicUrl(target, { resolve })).rejects.toThrow(UnsafeUrlError);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("classifies unnormalised IPv4 strings handed over directly", () => {
    expect(unsafeIpReason("2130706433")).toMatch(/loopback/);
    expect(unsafeIpReason("0x7f000001")).toMatch(/loopback/);
    expect(unsafeIpReason("017700000001")).toMatch(/loopback/);
    expect(unsafeIpReason("127.1")).toMatch(/loopback/);
    expect(unsafeIpReason("0xa9fea9fe")).toMatch(/metadata/);
    expect(unsafeIpReason("8.8.8.8")).toBeNull();
    expect(unsafeIpReason("example.com")).toBeNull();
    expect(unsafeIpReason("1.2.3.4.5")).toBeNull();
  });
});

describe("reserved and embedded IPv6 ranges", () => {
  it.each([
    ["unspecified", "[::]"],
    ["loopback", "[::1]"],
    ["NAT64 loopback", "[64:ff9b::7f00:1]"],
    ["NAT64 metadata", "[64:ff9b::a9fe:a9fe]"],
    ["NAT64 dotted", "[64:ff9b::169.254.169.254]"],
    ["local-use NAT64", "[64:ff9b:1::1]"],
    ["site-local", "[fec0::1]"],
    ["site-local top", "[feff::1]"],
    ["link-local", "[fe80::1]"],
    ["link-local top", "[febf::1]"],
    ["unique-local fc", "[fc00::1]"],
    ["unique-local fd", "[fdff::1]"],
    ["multicast", "[ff02::1]"],
    ["mapped loopback", "[::ffff:127.0.0.1]"],
    ["mapped loopback hex", "[::ffff:7f00:1]"],
    ["mapped metadata", "[::ffff:169.254.169.254]"],
    ["mapped expanded", "[0:0:0:0:0:ffff:7f00:1]"],
    ["mapped RFC1918", "[::ffff:10.0.0.1]"],
    ["mapped CGNAT", "[::ffff:100.64.0.1]"],
    ["6to4 loopback", "[2002:7f00:1::]"],
    ["6to4 metadata", "[2002:a9fe:a9fe::1]"],
    ["IPv4-compatible", "[::127.0.0.1]"],
    ["discard-only", "[100::1]"],
    ["documentation", "[2001:db8::1]"],
    ["Teredo", "[2001::1]"],
  ])("refuses %s", async (_name, host) => {
    await expect(
      assertSafePublicUrl(`https://${host}/`, { resolve: fakeResolve([]) }),
    ).rejects.toThrow(/private IP/);
  });

  it("allows public IPv6 and a mapped public IPv4", async () => {
    await expect(assertSafePublicUrl("https://[2606:4700:4700::1111]/", { resolve: fakeResolve([]) })).resolves.toBeInstanceOf(URL);
    await expect(assertSafePublicUrl("https://[::ffff:8.8.8.8]/", { resolve: fakeResolve([]) })).resolves.toBeInstanceOf(URL);
    await expect(assertSafePublicUrl("https://[2002:808:808::1]/", { resolve: fakeResolve([]) })).resolves.toBeInstanceOf(URL);
  });

  it("refuses these forms when a resolver returns them in any spelling", async () => {
    for (const address of [
      "64:ff9b::a9fe:a9fe",
      "0:0:0:0:0:FFFF:7F00:1",
      "::FFFF:127.0.0.1",
      "FE80::1",
      "FEC0::1",
      "FC00::1",
      "0064:ff9b:0000:0000:0000:0000:a9fe:a9fe",
    ]) {
      await expect(
        assertSafePublicUrl("https://cdn.example.com/x", { resolve: fakeResolve([address]) }),
      ).rejects.toThrow(/resolves to private IP/);
    }
  });

  it("classifies IPv6 directly in any case or spelling", () => {
    expect(unsafeIpReason("::1")).toMatch(/loopback/);
    expect(unsafeIpReason("[::1]")).toMatch(/loopback/);
    expect(unsafeIpReason("FE80::1%eth0")).toMatch(/zone/);
    expect(unsafeIpReason("2606:4700:4700::1111")).toBeNull();
  });
});

describe("userinfo, ports and internal names", () => {
  it.each([
    "https://user:pass@example.com/",
    "https://user@example.com/",
    "https://:pass@example.com/",
    "https://127.0.0.1@example.com/",
    "https://127.0.0.1%2f@example.com/",
    "https://example.com:x@example.com/",
  ])("refuses credentials in %s", async (target) => {
    const resolve = vi.fn(fakeResolve(["8.8.8.8"]));
    await expect(assertSafePublicUrl(target, { resolve })).rejects.toThrow(/credentials/);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("judges the host the parser will actually connect to", async () => {
    await expect(
      assertSafePublicUrl("https://example.com@127.0.0.1/", { resolve: fakeResolve(["8.8.8.8"]) }),
    ).rejects.toThrow(UnsafeUrlError);
    const url = await assertSafePublicUrl("https://evil.example.com\\@127.0.0.1/", {
      resolve: fakeResolve(["8.8.8.8"]),
    });
    expect(url.hostname).toBe("evil.example.com");
  });

  it.each(["https://example.com:8443/", "https://example.com:22/", "https://example.com:6379/", "https://example.com:80/", "https://example.com:0/"])(
    "refuses %s",
    async (target) => {
      const resolve = vi.fn(fakeResolve(["8.8.8.8"]));
      await expect(assertSafePublicUrl(target, { resolve })).rejects.toThrow(/port/);
      expect(resolve).not.toHaveBeenCalled();
    },
  );

  it("accepts the default port spelled out, and a port a caller opts into", async () => {
    await expect(assertSafePublicUrl("https://example.com:443/", { resolve: fakeResolve(["8.8.8.8"]) })).resolves.toBeInstanceOf(URL);
    await expect(
      assertSafePublicUrl("https://example.com:8443/", { resolve: fakeResolve(["8.8.8.8"]), allowedPorts: [443, 8443] }),
    ).resolves.toBeInstanceOf(URL);
  });

  it.each([
    "https://localhost/",
    "https://LOCALHOST./",
    "https://app.localhost/",
    "https://metadata.google.internal/",
    "https://printer.local/",
    "https://intranet/",
    "https://router.lan/",
    "https://host.home.arpa/",
  ])("refuses the internal name in %s without resolving it", async (target) => {
    const resolve = vi.fn(fakeResolve(["8.8.8.8"]));
    await expect(assertSafePublicUrl(target, { resolve })).rejects.toThrow(/internal host name/);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("does not echo the offending URL or its credentials in the error", async () => {
    for (const target of ["https://user:hunter2@", "not a url hunter2", "https://hunter2:x@example.com/"]) {
      const err = await assertSafePublicUrl(target, { resolve: fakeResolve(["8.8.8.8"]) }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UnsafeUrlError);
      expect((err as Error).message).not.toContain("hunter2");
    }
  });
});
