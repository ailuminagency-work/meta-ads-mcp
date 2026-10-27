import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFfmpeg, FfmpegError, type ExecFileFn } from "../../src/media/ffmpeg.js";
import { looksLikeMp4 } from "../../src/media/video-delivery.js";

const exec = promisify(execFile);
const MP4_DEMUXER = "mov,mp4,m4a,3gp,3g2,mj2";
const ALLOWED_FORMATS = `${MP4_DEMUXER},matroska,webm`;

const PROBE_JSON = JSON.stringify({
  streams: [
    { codec_type: "video", codec_name: "h264", width: 320, height: 240, r_frame_rate: "10/1" },
    { codec_type: "audio", codec_name: "aac" },
  ],
  format: { format_name: MP4_DEMUXER, duration: "4.0", nb_streams: 2 },
});

interface Call {
  file: string;
  args: string[];
  options: Parameters<ExecFileFn>[2];
}

/** An execFile that records every invocation and fabricates the output a caller reads back. */
function recorder() {
  const calls: Call[] = [];
  const execFileStub: ExecFileFn = async (file, args, options) => {
    calls.push({ file, args, options });
    const last = args[args.length - 1];
    if (file.endsWith("ffprobe")) return { stdout: Buffer.from(PROBE_JSON), stderr: Buffer.alloc(0) };
    if (args[0] !== "-version" && path.isAbsolute(last)) await fs.writeFile(last, Buffer.from("out"));
    return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  };
  return { calls, ffmpeg: createFfmpeg({ execFile: execFileStub, ffmpegPath: "ffmpeg", ffprobePath: "ffprobe" }) };
}

let dir: string;
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "meta-ads-ffmpeg-hardening-"));
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function pair(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

describe("every ffmpeg and ffprobe invocation", () => {
  const operations: Array<[string, (f: ReturnType<typeof recorder>["ffmpeg"], input: string, out: string) => Promise<unknown>]> = [
    ["probe", (f, input) => f.probe(input)],
    ["extractFrames", (f, input, out) => f.extractFrames(input, { outDir: out, count: 2, durationSeconds: 4, maxWidth: 320, demuxer: MP4_DEMUXER })],
    ["contactSheet", (f, input, out) => f.contactSheet(input, { outDir: out, count: 4, columns: 2, durationSeconds: 4, tileWidth: 160, demuxer: MP4_DEMUXER })],
    ["compact", (f, input, out) => f.compact(input, { outDir: out, maxBytes: 1_000_000, durationSeconds: 4, maxSeconds: 60, height: 480, demuxer: MP4_DEMUXER })],
    ["extractAudio", (f, input, out) => f.extractAudio(input, { outDir: out, durationSeconds: 4, demuxer: MP4_DEMUXER })],
  ];

  it.each(operations)("%s runs without a shell, on a pinned environment, with only local files and known containers", async (_name, run) => {
    const { ffmpeg, calls } = recorder();
    const input = path.join(dir, "in.mp4");
    await fs.writeFile(input, "x");
    await run(ffmpeg, input, dir);

    expect(calls.length).toBeGreaterThan(0);
    for (const { file, args, options } of calls) {
      expect(["ffmpeg", "ffprobe"]).toContain(file);
      expect(Array.isArray(args)).toBe(true);
      expect(options).not.toHaveProperty("shell");
      expect(Object.keys(options.env)).toEqual(["PATH"]);
      expect(options.killSignal).toBe("SIGKILL");
      expect(options.timeout).toBeGreaterThan(0);
      expect(options.timeout).toBeLessThanOrEqual(150_000);
      expect(options.maxBuffer).toBeLessThanOrEqual(1024 * 1024);
      expect(pair(args, "-protocol_whitelist")).toBe("file");
      expect(pair(args, "-format_whitelist")).toBe(ALLOWED_FORMATS);
      expect(pair(args, "-max_alloc")).toBeDefined();
      expect(pair(args, "-max_streams")).toBeDefined();
      expect(pair(args, "-max_pixels")).toBeDefined();
      expect(args.join(" ")).not.toMatch(/(^| )(concat|lavfi|http|https|tcp|udp|pipe|rtmp|ftp|data|subfile|crypto):/);
      if (file === "ffmpeg") {
        expect(args).toContain("-nostdin");
        const i = args.indexOf("-i");
        expect(i).toBeGreaterThan(0);
        expect(args[i + 1]).toBe(input);
        expect(args.indexOf("-f")).toBeLessThan(i);
        expect(pair(args, "-f")).toBe(MP4_DEMUXER);
      } else {
        expect(args[args.length - 1]).toBe(input);
      }
    }
  });
});

describe("what a caller can hand the wrapper", () => {
  it.each(["concat", "hls", "lavfi", "image2", "rawvideo", "mov,mp4,m4a,3gp,3g2,mj2,concat", "", "-i"])(
    "refuses to force the container %j",
    async (demuxer) => {
      const { ffmpeg, calls } = recorder();
      const input = path.join(dir, "in.mp4");
      await expect(ffmpeg.extractFrames(input, { outDir: dir, count: 1, durationSeconds: 4, maxWidth: 320, demuxer })).rejects.toBeInstanceOf(FfmpegError);
      await expect(ffmpeg.compact(input, { outDir: dir, maxBytes: 1000, durationSeconds: 4, maxSeconds: 60, height: 480, demuxer })).rejects.toBeInstanceOf(FfmpegError);
      expect(calls).toHaveLength(0);
    },
  );

  it.each(["relative.mp4", "-i", "concat:/etc/passwd|/etc/hosts", "http://127.0.0.1/x.mp4", "file:/etc/passwd", `${path.join(os.tmpdir(), "a")}\n-i /etc/passwd`, `${path.join(os.tmpdir(), "a")}\0.mp4`])(
    "refuses the input %j",
    async (input) => {
      const { ffmpeg, calls } = recorder();
      await expect(ffmpeg.probe(input)).rejects.toBeInstanceOf(FfmpegError);
      await expect(ffmpeg.extractAudio(input, { outDir: dir, durationSeconds: 4, demuxer: MP4_DEMUXER })).rejects.toBeInstanceOf(FfmpegError);
      expect(calls).toHaveLength(0);
    },
  );

  it("never lets a hostile file name become an option", async () => {
    const { ffmpeg, calls } = recorder();
    const input = path.join(dir, "-i evil; rm -rf.mp4");
    await fs.writeFile(input, "x");
    await ffmpeg.probe(input);
    expect(calls[0].file).toBe("ffprobe");
    expect(calls[0].args[calls[0].args.length - 1]).toBe(input);
    expect(calls[0].args.filter((a) => a === "-i")).toHaveLength(0);
  });
});

describe("ftyp spoofing", () => {
  const box = (type: string, payload: Buffer) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(payload.length + 8);
    header.write(type, 4, "ascii");
    return Buffer.concat([header, payload]);
  };

  it("passes the cheap header check, which is why bytes are never trusted on it alone", () => {
    const spoof = Buffer.concat([box("ftyp", Buffer.from("isom0000")), Buffer.from("ffconcat version 1.0\nfile '/etc/passwd'\n")]);
    expect(looksLikeMp4(spoof)).toBe(true);
    expect(looksLikeMp4(Buffer.from("ffconcat version 1.0\nfile '/etc/passwd'\n"))).toBe(false);
  });
});

async function ffmpegOnPath(): Promise<boolean> {
  try {
    await exec("ffprobe", ["-version"]);
    await exec("ffmpeg", ["-version"]);
    return true;
  } catch {
    return false;
  }
}

const available = await ffmpegOnPath();
if (!available && process.env.FFMPEG_REQUIRED === "1") {
  throw new Error("ffmpeg is required (FFMPEG_REQUIRED=1) but not on PATH");
}

describe.skipIf(!available)("hostile files against the real binaries", () => {
  const real = createFfmpeg();
  const SECRET = "SYNTHETIC-SECRET-CONTENT-NOT-REAL";
  let secretPath: string;
  let listener: net.Server;
  let hits: number;
  let port: number;

  beforeAll(async () => {
    secretPath = path.join(dir, "secret.txt");
    await fs.writeFile(secretPath, SECRET);
    hits = 0;
    listener = net.createServer((socket) => {
      hits += 1;
      socket.destroy();
    });
    await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
    port = (listener.address() as net.AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => listener.close(() => resolve()));
  });

  async function hostile(name: string, content: Buffer | string): Promise<string> {
    const file = path.join(dir, name);
    await fs.writeFile(file, content);
    return file;
  }

  it("does not read a file named by an ffconcat script, even behind an mp4 name and an ftyp box", async () => {
    const script = `ffconcat version 1.0\nfile '${secretPath}'\n`;
    const header = Buffer.alloc(8);
    header.writeUInt32BE(16);
    header.write("ftyp", 4, "ascii");
    for (const [name, content] of [
      ["concat.mp4", script],
      ["concat-spoofed.mp4", Buffer.concat([header, Buffer.from("isom0000"), Buffer.from(script)])],
      ["concat-padded.mp4", `\n\n# comment\n${script}`],
    ] as const) {
      const file = await hostile(name, content);
      const error = await real.probe(file).catch((e: unknown) => e as Error);
      expect(error).toBeInstanceOf(Error);
      expect(String((error as Error).message)).not.toContain(SECRET);
    }
  });

  it("does not forward a hostile script to the frame extractor either, even with an allowed container forced", async () => {
    const file = await hostile("concat-frames.mp4", `ffconcat version 1.0\nfile '${secretPath}'\n`);
    const outDir = await fs.mkdtemp(path.join(dir, "frames-"));
    await expect(real.extractFrames(file, { outDir, count: 1, durationSeconds: 4, maxWidth: 160, demuxer: MP4_DEMUXER })).rejects.toBeInstanceOf(FfmpegError);
    expect(await fs.readdir(outDir)).toEqual([]);
  });

  it("control: the listener does see a connection when ffprobe is simply pointed at it", async () => {
    await exec("ffprobe", ["-v", "error", "-timeout", "1000000", "-i", `http://127.0.0.1:${port}/x.mp4`]).catch(() => undefined);
    expect(hits).toBeGreaterThan(0);
    hits = 0;
  });

  it("refuses a network location as the input before any process starts", async () => {
    await expect(real.probe(`http://127.0.0.1:${port}/x.mp4`)).rejects.toBeInstanceOf(FfmpegError);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(hits).toBe(0);
  });

  it("opens no network connection for a playlist that names one", async () => {
    const playlist = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttp://127.0.0.1:${port}/segment.ts\n#EXT-X-ENDLIST\n`;
    const file = await hostile("playlist.mp4", playlist);
    await expect(real.probe(file)).rejects.toThrow();
    const outDir = await fs.mkdtemp(path.join(dir, "playlist-"));
    await expect(real.extractFrames(file, { outDir, count: 1, durationSeconds: 4, maxWidth: 160, demuxer: MP4_DEMUXER })).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(hits).toBe(0);
  });

  it("refuses a Matroska or mp4 file only when it really is one, and a raw H.264 stream never", async () => {
    const raw = await hostile("raw.mp4", Buffer.from([0, 0, 0, 1, 0x67, 0x42, 0, 0x1e, 0, 0, 0, 1, 0x68, 0xce, 0x06, 0xe2]));
    await expect(real.probe(raw)).rejects.toThrow();
  });

  it("probes a genuine clip, so the hardening is not simply rejecting everything", async () => {
    const clip = path.join(dir, "genuine.mp4");
    await exec("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc=duration=2:size=160x120:rate=5",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", clip,
    ]);
    const probe = await real.probe(clip);
    expect(probe.width).toBe(160);
    expect(probe.demuxer).toBe(MP4_DEMUXER);
  });
});
