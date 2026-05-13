import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeConversationContext } from "./conversation-context.js";

describe("ConversationContext", () => {
  it("reset clears all turns and closes the context", () => {
    const ctx = makeConversationContext();
    ctx.addTurn("hello", "hi");
    ctx.reset();
    expect(ctx.isOpen()).toBe(false);
    expect(ctx.getHistory(10_000)).toEqual([]);
  });

  it("isOpen returns false before any turn is added", () => {
    const ctx = makeConversationContext();
    expect(ctx.isOpen()).toBe(false);
  });

  it("isOpen returns true after addTurn", () => {
    const ctx = makeConversationContext();
    ctx.addTurn("hello", "hi");
    expect(ctx.isOpen()).toBe(true);
  });

  it("isOpen returns false after reset", () => {
    const ctx = makeConversationContext();
    ctx.addTurn("hello", "hi");
    expect(ctx.isOpen()).toBe(true);
    ctx.reset();
    expect(ctx.isOpen()).toBe(false);
  });

  it("getHistory drops oldest turns first when total content exceeds token budget", () => {
    const ctx = makeConversationContext();
    ctx.addTurn("a".repeat(50), "b".repeat(50)); // 100 chars
    ctx.addTurn("c".repeat(50), "d".repeat(50)); // 100 chars

    // budget of 110 — first turn (100 chars) would push total to 200, so drop it
    const history = ctx.getHistory(110);
    expect(history).toHaveLength(2);
    expect(history[0]).toEqual({ role: "user", content: "c".repeat(50) });
    expect(history[1]).toEqual({ role: "assistant", content: "d".repeat(50) });
  });

  it("getHistory returns empty array when context has no turns", () => {
    const ctx = makeConversationContext();
    expect(ctx.getHistory(10_000)).toEqual([]);
  });

  describe("idle timeout", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-12T12:00:00Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("isOpen returns false once idleTimeoutMs has elapsed since last addTurn", () => {
      const ctx = makeConversationContext({ idleTimeoutMs: 30_000 });
      ctx.addTurn("hello", "hi");
      vi.advanceTimersByTime(30_000);
      expect(ctx.isOpen()).toBe(false);
    });

    it("isOpen still true just before idleTimeoutMs elapses", () => {
      const ctx = makeConversationContext({ idleTimeoutMs: 30_000 });
      ctx.addTurn("hello", "hi");
      vi.advanceTimersByTime(29_999);
      expect(ctx.isOpen()).toBe(true);
    });

    it("addTurn after idle close reopens the context and refreshes lastTurnAt", () => {
      const ctx = makeConversationContext({ idleTimeoutMs: 30_000 });
      ctx.addTurn("hello", "hi");
      vi.advanceTimersByTime(60_000);
      expect(ctx.isOpen()).toBe(false);
      ctx.addTurn("again", "ok");
      expect(ctx.isOpen()).toBe(true);
      vi.advanceTimersByTime(29_999);
      expect(ctx.isOpen()).toBe(true);
    });

    it("default idleTimeoutMs is 30_000 when not provided", () => {
      const ctx = makeConversationContext();
      ctx.addTurn("hello", "hi");
      vi.advanceTimersByTime(29_999);
      expect(ctx.isOpen()).toBe(true);
      vi.advanceTimersByTime(1);
      expect(ctx.isOpen()).toBe(false);
    });

    it("reset closes the context immediately regardless of timeout", () => {
      const ctx = makeConversationContext({ idleTimeoutMs: 30_000 });
      ctx.addTurn("hello", "hi");
      ctx.reset();
      expect(ctx.isOpen()).toBe(false);
    });
  });

  it("getHistory returns turns as classifier-shaped user/assistant pairs", () => {
    const ctx = makeConversationContext();
    ctx.addTurn("turn on the porch light", "Done — porch light is on.");
    ctx.addTurn("actually turn it off", "Done — porch light is off.");

    const history = ctx.getHistory(10_000);
    expect(history).toEqual([
      { role: "user", content: "turn on the porch light" },
      { role: "assistant", content: "Done — porch light is on." },
      { role: "user", content: "actually turn it off" },
      { role: "assistant", content: "Done — porch light is off." },
    ]);
  });
});
