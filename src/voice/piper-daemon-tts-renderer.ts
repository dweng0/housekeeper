import { spawn as nodeSpawn } from "child_process";
import type { ChildProcess } from "child_process";
import type { TtsRenderer } from "../ports.js";

type SpawnFn = (cmd: string, args: string[]) => ChildProcess;

const SILENCE_MS = 150;

export function makePiperDaemonTtsRenderer(
  voicePath: string,
  spawnFn: SpawnFn = nodeSpawn,
): TtsRenderer {
  let proc: ChildProcess | null = null;
  let idle = true;
  let queue: Promise<void> = Promise.resolve();

  function ensureProcess(): ChildProcess {
    if (proc !== null && proc.exitCode === null) return proc;
    const p = spawnFn("piper", ["--model", voicePath, "--output-raw"]);
    proc = p;
    p.on("exit", () => { if (proc === p) proc = null; });
    p.on("error", () => { if (proc === p) proc = null; });
    return p;
  }

  function renderOnce(text: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const p = ensureProcess();
      const chunks: Buffer[] = [];
      let timer: ReturnType<typeof setTimeout>;
      let settled = false;

      function finish() {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        p.stdout!.off("data", onData);
        p.off("exit", onExit);
        p.off("error", onError);
        resolve(Buffer.concat(chunks));
      }

      function onData(chunk: Buffer) {
        chunks.push(chunk);
        clearTimeout(timer);
        timer = setTimeout(finish, SILENCE_MS);
      }

      function onExit(code: number | null) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        p.stdout!.off("data", onData);
        p.off("error", onError);
        reject(new Error(`piper exited with code ${code}`));
      }

      function onError(err: Error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        p.stdout!.off("data", onData);
        p.off("exit", onExit);
        reject(err);
      }

      p.stdout!.on("data", onData);
      p.once("exit", onExit);
      p.once("error", onError);

      p.stdin!.write(text + "\n");
    });
  }

  return {
    render(text: string): Promise<Buffer> {
      if (idle) {
        idle = false;
        const result = renderOnce(text);
        queue = result.then(() => { idle = true; }, () => { idle = true; });
        return result;
      }

      const result = queue.then(() => {
        idle = false;
        return renderOnce(text);
      });
      queue = result.then(() => { idle = true; }, () => { idle = true; });
      return result;
    },
  };
}
