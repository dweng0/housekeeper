import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "events";
import { makePiperDaemonTtsRenderer } from "./piper-daemon-tts-renderer.js";

type SpawnFn = (cmd: string, args: string[]) => FakeProcess;

class FakeProcess extends EventEmitter {
  stdin = { write: vi.fn(), end: vi.fn() };
  stdout = new EventEmitter() as EventEmitter & { emit(event: "data", chunk: Buffer): boolean };
  stderr = new EventEmitter();
  exitCode: number | null = null;

  simulateOutput(chunks: Buffer[], delayMs = 0): void {
    for (const chunk of chunks) {
      if (delayMs > 0) {
        setTimeout(() => this.stdout.emit("data", chunk), delayMs);
      } else {
        this.stdout.emit("data", chunk);
      }
    }
  }

  simulateCrash(code = 1): void {
    this.exitCode = code;
    this.emit("exit", code);
    this.emit("error", new Error(`piper exited with code ${code}`));
  }
}

function makeSpawnFn(procs: FakeProcess[]): SpawnFn {
  let i = 0;
  return () => procs[i++];
}

describe("makePiperDaemonTtsRenderer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders text and returns PCM buffer", async () => {
    const proc = new FakeProcess();
    const spawnFn = makeSpawnFn([proc]);
    const renderer = makePiperDaemonTtsRenderer("voice.onnx", spawnFn);

    const expected = Buffer.from([0x01, 0x02, 0x03, 0x04]);

    // Emit output immediately after render is called, then let 150ms silence trigger resolve
    const renderPromise = renderer.render("Hello world");
    proc.simulateOutput([expected]);

    const result = await renderPromise;
    expect(result).toEqual(expected);
  });

  it("spawns piper with correct args", async () => {
    const proc = new FakeProcess();
    const spawnFn = vi.fn(() => proc) as unknown as SpawnFn;
    const renderer = makePiperDaemonTtsRenderer("my-voice.onnx", spawnFn);

    const renderPromise = renderer.render("Hi");
    proc.simulateOutput([Buffer.from("pcm")]);
    await renderPromise;

    expect(spawnFn).toHaveBeenCalledOnce();
    expect(spawnFn).toHaveBeenCalledWith("piper", ["--model", "my-voice.onnx", "--output-raw"]);
  });

  it("reuses process across multiple render calls", async () => {
    const proc = new FakeProcess();
    const spawnFn = vi.fn(() => proc) as unknown as SpawnFn;
    const renderer = makePiperDaemonTtsRenderer("voice.onnx", spawnFn);

    const p1 = renderer.render("First");
    proc.simulateOutput([Buffer.from("pcm1")]);
    await p1;

    const p2 = renderer.render("Second");
    proc.simulateOutput([Buffer.from("pcm2")]);
    await p2;

    expect(spawnFn).toHaveBeenCalledOnce();
  });

  it("queues concurrent render calls — second waits for first", async () => {
    const proc = new FakeProcess();
    const spawnFn = makeSpawnFn([proc]);
    const renderer = makePiperDaemonTtsRenderer("voice.onnx", spawnFn);

    const order: string[] = [];

    const p1 = renderer.render("First").then((r) => { order.push("first"); return r; });
    const p2 = renderer.render("Second").then((r) => { order.push("second"); return r; });

    // Emit data for first, wait for it to settle, then second
    proc.simulateOutput([Buffer.from("pcm1")]);
    await p1;
    proc.simulateOutput([Buffer.from("pcm2")]);
    await p2;

    expect(order).toEqual(["first", "second"]);
  });

  it("spawns fresh process after crash and in-flight render rejects", async () => {
    const proc1 = new FakeProcess();
    const proc2 = new FakeProcess();
    const spawnFn = makeSpawnFn([proc1, proc2]);
    const renderer = makePiperDaemonTtsRenderer("voice.onnx", spawnFn);

    // First render — crash before output
    const p1 = renderer.render("crash me");
    proc1.simulateCrash();
    await expect(p1).rejects.toThrow();

    // Second render — fresh process works fine
    const p2 = renderer.render("recover");
    proc2.simulateOutput([Buffer.from("recovered-pcm")]);
    const result = await p2;

    expect(result).toEqual(Buffer.from("recovered-pcm"));
  });

  it("writes text as line to stdin", async () => {
    const proc = new FakeProcess();
    const spawnFn = makeSpawnFn([proc]);
    const renderer = makePiperDaemonTtsRenderer("voice.onnx", spawnFn);

    const renderPromise = renderer.render("Say this");
    proc.simulateOutput([Buffer.from("pcm")]);
    await renderPromise;

    expect(proc.stdin.write).toHaveBeenCalledWith("Say this\n");
  });

  it("concatenates multiple stdout chunks into single buffer", async () => {
    const proc = new FakeProcess();
    const spawnFn = makeSpawnFn([proc]);
    const renderer = makePiperDaemonTtsRenderer("voice.onnx", spawnFn);

    const renderPromise = renderer.render("Multi chunk");
    proc.simulateOutput([Buffer.from([0x01, 0x02]), Buffer.from([0x03, 0x04])]);
    const result = await renderPromise;

    expect(result).toEqual(Buffer.from([0x01, 0x02, 0x03, 0x04]));
  });
});
