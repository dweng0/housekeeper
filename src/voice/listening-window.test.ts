import { describe, it, expect, vi } from "vitest";
import { makeListeningWindow } from "./listening-window.js";

describe("ListeningWindow", () => {
  it("calls onDirectedQuestion when System Name detected in utterance", () => {
    const handler = vi.fn();
    const window = makeListeningWindow({ systemName: "Jarvis", onDirectedQuestion: handler });
    window.addUtterance("hey Jarvis turn on the lights");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("does not call onDirectedQuestion when System Name absent", () => {
    const handler = vi.fn();
    const window = makeListeningWindow({ systemName: "Jarvis", onDirectedQuestion: handler });
    window.addUtterance("turn on the lights");
    expect(handler).not.toHaveBeenCalled();
  });

  it("detection is case-insensitive", () => {
    const handler = vi.fn();
    const window = makeListeningWindow({ systemName: "Jarvis", onDirectedQuestion: handler });
    window.addUtterance("JARVIS what time is it");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("dispatches only current utterance (system name stripped) when system name in current utterance", () => {
    const handler = vi.fn();
    const window = makeListeningWindow({ systemName: "Jarvis", onDirectedQuestion: handler });
    window.addUtterance("the front door just opened");
    window.addUtterance("Jarvis turn on the porch light");
    const transcript = handler.mock.calls[0][0] as string;
    expect(transcript).toBe("turn on the porch light");
    expect(transcript).not.toContain("Jarvis");
  });

  it("dispatches full window when system name arrives standalone", () => {
    const handler = vi.fn();
    const window = makeListeningWindow({ systemName: "Jarvis", onDirectedQuestion: handler });
    window.addUtterance("turn on the porch light");
    window.addUtterance("Jarvis");
    const transcript = handler.mock.calls[0][0] as string;
    expect(transcript).toContain("turn on the porch light");
    expect(transcript).not.toContain("Jarvis");
  });

  it("prunes utterances older than window duration", () => {
    const handler = vi.fn();
    const now = Date.now();
    const window = makeListeningWindow({ systemName: "Jarvis", windowDurationMs: 5000, onDirectedQuestion: handler });
    window.addUtterance("old utterance", now - 6000);
    window.addUtterance("Jarvis turn on the lights", now);
    const transcript = handler.mock.calls[0][0] as string;
    expect(transcript).not.toContain("old utterance");
    expect(transcript).toContain("turn on the lights");
    expect(transcript).not.toContain("Jarvis");
  });

  it("calls onAmbientUtterance for utterances that do not contain System Name", () => {
    const directedHandler = vi.fn();
    const ambientHandler = vi.fn();
    const window = makeListeningWindow({
      systemName: "Jarvis",
      onDirectedQuestion: directedHandler,
      onAmbientUtterance: ambientHandler,
    });
    window.addUtterance("actually turn it off");
    expect(directedHandler).not.toHaveBeenCalled();
    expect(ambientHandler).toHaveBeenCalledOnce();
    expect(ambientHandler).toHaveBeenCalledWith("actually turn it off");
  });

  it("does not call onAmbientUtterance when System Name is present", () => {
    const ambientHandler = vi.fn();
    const window = makeListeningWindow({
      systemName: "Jarvis",
      onDirectedQuestion: vi.fn(),
      onAmbientUtterance: ambientHandler,
    });
    window.addUtterance("Jarvis turn on the lights");
    expect(ambientHandler).not.toHaveBeenCalled();
  });

  it("does not fire again for subsequent non-directed utterances", () => {
    const handler = vi.fn();
    const window = makeListeningWindow({ systemName: "Jarvis", onDirectedQuestion: handler });
    window.addUtterance("Jarvis turn on the lights");
    window.addUtterance("actually never mind");
    expect(handler).toHaveBeenCalledOnce();
  });
});
