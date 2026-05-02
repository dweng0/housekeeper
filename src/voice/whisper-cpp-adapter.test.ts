import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as childProcess from "child_process";
import { WhisperCppAdapter } from "./whisper-cpp-adapter.js";

vi.mock("child_process");

describe("WhisperCppAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("parsing whisper-stream output", () => {
    it("calls onUtterance with text from timestamped lines", () => {
      const handler = vi.fn();
      const adapter = new WhisperCppAdapter({
        modelPath: "/fake/model.bin",
        onUtterance: handler,
      });

      adapter.processLine("[00:00:00.000 --> 00:00:01.500]   hello world");

      expect(handler).toHaveBeenCalledWith("hello world");
    });

    it("ignores partial lines without timestamps", () => {
      const handler = vi.fn();
      const adapter = new WhisperCppAdapter({
        modelPath: "/fake/model.bin",
        onUtterance: handler,
      });

      adapter.processLine("partial transcription...");
      adapter.processLine("[00:00:00.000 --> 00:00:01.500]   final text");

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith("final text");
    });

    it("strips leading whitespace from transcription text", () => {
      const handler = vi.fn();
      const adapter = new WhisperCppAdapter({
        modelPath: "/fake/model.bin",
        onUtterance: handler,
      });

      adapter.processLine("[00:00:00.000 --> 00:00:01.500]     spaced text");

      expect(handler).toHaveBeenCalledWith("spaced text");
    });
  });

  describe("spawn arguments", () => {
    it("passes model path and VAD sliding window args", () => {
      const mockSpawn = vi.spyOn(childProcess, "spawn").mockReturnValue({
        stdout: { on: vi.fn() },
        kill: vi.fn(),
      } as unknown as childProcess.ChildProcess);

      const adapter = new WhisperCppAdapter({
        modelPath: "/path/to/model.bin",
        onUtterance: vi.fn(),
      });

      adapter.startListening();

      expect(mockSpawn).toHaveBeenCalledWith("whisper-stream", [
        "--model", "/path/to/model.bin",
        "--step", "0",
        "--length", "30000",
      ]);
    });

    it("includes VAD args when vadModelPath provided", () => {
      const mockSpawn = vi.spyOn(childProcess, "spawn").mockReturnValue({
        stdout: { on: vi.fn() },
        kill: vi.fn(),
      } as unknown as childProcess.ChildProcess);

      const adapter = new WhisperCppAdapter({
        modelPath: "/path/to/model.bin",
        vadModelPath: "/path/to/silero.bin",
        vadSilenceDurationMs: 700,
        onUtterance: vi.fn(),
      });

      adapter.startListening();

      expect(mockSpawn).toHaveBeenCalledWith("whisper-stream", [
        "--model", "/path/to/model.bin",
        "--step", "0",
        "--length", "30000",
        "--vad", "--vad-model", "/path/to/silero.bin",
        "--vad-min-silence-duration-ms", "700",
      ]);
    });
  });

  describe("process lifecycle", () => {
    it("kills subprocess on stopListening", () => {
      const mockKill = vi.fn();
      const mockSpawn = vi.spyOn(childProcess, "spawn").mockReturnValue({
        stdout: { on: vi.fn() },
        kill: mockKill,
      } as unknown as childProcess.ChildProcess);

      const adapter = new WhisperCppAdapter({
        modelPath: "/path/to/model.bin",
        onUtterance: vi.fn(),
      });

      adapter.startListening();
      adapter.stopListening();

      expect(mockKill).toHaveBeenCalled();
    });
  });
});