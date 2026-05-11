import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { makeConversationContext } from "./conversation-context.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("ConversationContext", () => {
  it("reset clears all turns and closes the context immediately", () => {
    const ctx = makeConversationContext(5_000);
    ctx.addTurn("hello", "hi");
    ctx.reset();
    expect(ctx.isOpen()).toBe(false);
    expect(ctx.getHistory(10_000)).toEqual([]);
  });

  it("reset cancels the expiry timer so no late close occurs", () => {
    const ctx = makeConversationContext(5_000);
    ctx.addTurn("hello", "hi");
    ctx.reset();
    ctx.addTurn("new start", "fresh");
    vi.advanceTimersByTime(5_001);
    // The pre-reset timer should not have interfered — new turn's timer fires here
    expect(ctx.isOpen()).toBe(false);
  });

  it("isOpen returns false before any turn is added", () => {
    const ctx = makeConversationContext();
    expect(ctx.isOpen()).toBe(false);
  });

  it("isOpen returns true immediately after addTurn", () => {
    const ctx = makeConversationContext();
    ctx.addTurn("hello", "hi");
    expect(ctx.isOpen()).toBe(true);
  });

  it("isOpen returns false after timeout elapses with no new turn", () => {
    const ctx = makeConversationContext(5_000);
    ctx.addTurn("hello", "hi");
    vi.advanceTimersByTime(5_001);
    expect(ctx.isOpen()).toBe(false);
  });

  it("addTurn resets the expiry timer", () => {
    const ctx = makeConversationContext(5_000);
    ctx.addTurn("hello", "hi");
    vi.advanceTimersByTime(4_000);
    ctx.addTurn("follow up", "sure");
    vi.advanceTimersByTime(4_000); // 8s total but timer was reset at 4s
    expect(ctx.isOpen()).toBe(true);
    vi.advanceTimersByTime(1_001); // now past 5s since last turn
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
