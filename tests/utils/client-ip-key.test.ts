import { describe, expect, it } from "vitest";
import { clientIpKey } from "../../src/utils/client-ip-key.js";

describe("clientIpKey", () => {
  it("keys an IPv4 client by its address", () => {
    expect(clientIpKey("203.0.113.9")).toBe("203.0.113.9");
    expect(clientIpKey("203.0.113.10")).not.toBe(clientIpKey("203.0.113.9"));
  });

  it("gives every address in one IPv6 /64 the same key, however it is written", () => {
    const key = clientIpKey("2001:db8:abcd:12::1");
    expect(key).toBe("2001:0db8:abcd:0012::/64");
    expect(clientIpKey("2001:DB8:ABCD:0012:ffff:ffff:ffff:ffff")).toBe(key);
    expect(clientIpKey("2001:db8:abcd:12:0:0:0:2")).toBe(key);
    expect(clientIpKey("2001:db8:abcd:12:aaaa:bbbb:cccc:dddd")).toBe(key);
  });

  it("separates different /64 networks", () => {
    expect(clientIpKey("2001:db8:abcd:13::1")).not.toBe(clientIpKey("2001:db8:abcd:12::1"));
    expect(clientIpKey("2001:db8:abce:12::1")).not.toBe(clientIpKey("2001:db8:abcd:12::1"));
  });

  it("treats an IPv4-mapped IPv6 address as the IPv4 address it carries", () => {
    expect(clientIpKey("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(clientIpKey("::ffff:cb00:7109")).toBe("203.0.113.9");
  });

  it("ignores the zone identifier of a link-local address", () => {
    expect(clientIpKey("fe80::1%eth0")).toBe(clientIpKey("fe80::2"));
  });

  it("handles the loopback, unspecified and NAT64 forms", () => {
    expect(clientIpKey("::1")).toBe("0000:0000:0000:0000::/64");
    expect(clientIpKey("::")).toBe("0000:0000:0000:0000::/64");
    expect(clientIpKey("64:ff9b::198.51.100.7")).toBe("0064:ff9b:0000:0000::/64");
  });

  it("never throws on junk and keeps a stable key", () => {
    expect(clientIpKey(undefined)).toBe("unknown");
    expect(clientIpKey(null)).toBe("unknown");
    expect(clientIpKey("")).toBe("unknown");
    expect(clientIpKey("not an address")).toBe("not an address");
    expect(clientIpKey("2001:db8::1::2")).toBe("2001:db8::1::2");
    expect(clientIpKey("1:2:3:4:5:6:7:8:9")).toBe("1:2:3:4:5:6:7:8:9");
  });
});
