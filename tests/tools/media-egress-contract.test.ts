import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const net = vi.hoisted(() => ({
  lookup: vi.fn(async (hostname: string) =>
    hostname.endsWith("fbcdn.net") ? [{ address: "203.0.113.10", family: 4 }] : [{ address: "203.0.113.66", family: 4 }],
  ),
  request: vi.fn(),
}));

vi.mock("node:dns", () => ({ promises: { lookup: net.lookup } }));
vi.mock("node:https", () => ({ default: { request: net.request }, request: net.request }));

import { registerAdDossierTools } from "../../src/tools/ad-dossier.js";
import { registerCreativeMediaTools } from "../../src/tools/creative-media.js";
import { cleanupTestToken, createMockMcpServer, mockFetchResponse, setupTestToken } from "../setup.js";

type ToolResult = { content: Array<{ type: string; text?: string }> };

const ATTACKER_PICTURE = "https://attacker.example.org:8443/pixel.png";
const GOOD_PICTURE = "https://scontent.xx.fbcdn.net/good.png";

function pngRequest(destination: URL, _options: unknown, callback: (res: unknown) => void) {
  const req = new EventEmitter() as EventEmitter & { setTimeout: () => void; end: () => void; destroy: () => void };
  req.setTimeout = vi.fn();
  req.destroy = vi.fn();
  req.end = () => {
    queueMicrotask(() => {
      const res = new PassThrough() as PassThrough & { statusCode: number; headers: Record<string, string> };
      res.statusCode = 200;
      res.headers = { "content-type": "image/png" };
      callback(res);
      res.end(Buffer.from("png"));
    });
  };
  void destination;
  return req;
}

function hostsContacted(): string[] {
  return net.request.mock.calls.map((call) => (call[0] as URL).hostname);
}

function routeGraph(routes: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    for (const [fragment, body] of Object.entries(routes)) {
      if (path.endsWith(fragment)) return mockFetchResponse(body);
    }
    return mockFetchResponse({ data: [] });
  });
}

const CREATIVE = {
  id: "5001",
  name: "Hostile picture",
  object_story_spec: {
    page_id: "900",
    link_data: {
      link: "https://shop.example.com/",
      picture: ATTACKER_PICTURE,
      child_attachments: [
        { link: "https://shop.example.com/a", picture: GOOD_PICTURE },
        { link: "https://shop.example.com/b", picture: "https://203.0.113.66/pixel.png" },
        { link: "https://shop.example.com/c", picture: "http://scontent.xx.fbcdn.net/plain.png" },
        { link: "https://shop.example.com/d", picture: "https://scontent.xx.fbcdn.net:6379/pixel.png" },
      ],
    },
  },
};

beforeEach(() => {
  setupTestToken();
  net.lookup.mockClear();
  net.request.mockReset();
  net.request.mockImplementation(pngRequest);
});

afterEach(() => {
  cleanupTestToken();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Meta-origin media egress", () => {
  it("ads_get_creative_media fetches only Meta CDN images, whatever the creative's picture fields say", async () => {
    const server = createMockMcpServer();
    registerCreativeMediaTools(server as never);
    const handler = server._registeredTools[0].handler;
    vi.stubGlobal("fetch", routeGraph({ "/5001": CREATIVE }));

    const result = (await handler({ creative_id: "5001" })) as ToolResult;

    expect(net.lookup.mock.calls.map((call) => call[0])).toEqual(["scontent.xx.fbcdn.net"]);
    expect(hostsContacted()).toEqual(["scontent.xx.fbcdn.net"]);
    expect(result.content.filter((block) => block.type === "image")).toHaveLength(1);
    const json = JSON.parse(result.content[result.content.length - 1].text as string) as { images: Array<{ source_url: string; downloaded: boolean; error?: string }> };
    const refused = json.images.filter((image) => !image.downloaded);
    expect(refused).toHaveLength(4);
    for (const image of refused) expect(image.error).toMatch(/not an allowed image host|port is not allowed|only https/);
  });

  it("ads_get_ad_dossier applies the same policy to the same creative", async () => {
    const server = createMockMcpServer();
    registerAdDossierTools(server as never, { deliverVideos: vi.fn(async () => ({ blocks: [], videos: [], warnings: [], bytes: 0 })) as never });
    const tool = server._registeredTools.find((t) => t.name === "ads_get_ad_dossier")!;
    vi.stubGlobal(
      "fetch",
      routeGraph({
        "/8001": { id: "8001", name: "Ad", account_id: "act_1", creative: { id: "5001" } },
        "/5001": CREATIVE,
      }),
    );

    const result = (await tool.handler(
      { ad_id: "8001", include_insights: false, include_targeting: false },
      { signal: new AbortController().signal },
    )) as ToolResult;

    expect(net.lookup.mock.calls.map((call) => call[0])).toEqual(["scontent.xx.fbcdn.net"]);
    expect(hostsContacted()).toEqual(["scontent.xx.fbcdn.net"]);
    expect(result.content.filter((block) => block.type === "image")).toHaveLength(1);
  });

  it("a creative whose every image is off-list costs no DNS lookup and no connection", async () => {
    const server = createMockMcpServer();
    registerCreativeMediaTools(server as never);
    const handler = server._registeredTools[0].handler;
    vi.stubGlobal(
      "fetch",
      routeGraph({
        "/5001": {
          id: "5001",
          name: "Only hostile",
          object_story_spec: { link_data: { link: "https://shop.example.com/", picture: ATTACKER_PICTURE } },
        },
      }),
    );

    await handler({ creative_id: "5001" });

    expect(net.lookup).not.toHaveBeenCalled();
    expect(net.request).not.toHaveBeenCalled();
  });
});
