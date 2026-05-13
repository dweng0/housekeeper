interface ConversationTurn {
  userUtterance: string;
  systemResponse: string;
}

export interface ConversationContext {
  addTurn(userUtterance: string, systemResponse: string): void;
  getHistory(tokenBudget: number): Array<{ role: "user" | "assistant"; content: string }>;
  isOpen(): boolean;
  reset(): void;
}

export interface ConversationContextOptions {
  idleTimeoutMs?: number;
  now?: () => number;
}

const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

export function makeConversationContext(opts: ConversationContextOptions = {}): ConversationContext {
  const idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const now = opts.now ?? Date.now;
  let turns: ConversationTurn[] = [];
  let open = false;
  let lastTurnAt = 0;

  return {
    addTurn(userUtterance, systemResponse) {
      turns.push({ userUtterance, systemResponse });
      open = true;
      lastTurnAt = now();
    },

    getHistory(tokenBudget) {
      const pairs = turns.map((t) => [
        { role: "user" as const, content: t.userUtterance },
        { role: "assistant" as const, content: t.systemResponse },
      ]);
      const flat = pairs.flat();
      let cost = flat.reduce((sum, m) => sum + m.content.length, 0);
      while (cost > tokenBudget && pairs.length > 0) {
        const dropped = pairs.shift()!;
        cost -= dropped[0].content.length + dropped[1].content.length;
      }
      return pairs.flat();
    },

    isOpen() {
      const result = open && turns.length > 0 && now() - lastTurnAt < idleTimeoutMs;
      if (!result && turns.length > 0) {
        console.log(`[ConversationContext] isOpen=false (open=${open}, turns=${turns.length}, elapsed=${now() - lastTurnAt}ms, timeout=${idleTimeoutMs}ms)`);
      }
      return result;
    },

    reset() {
      console.log(`[ConversationContext] reset() called — clearing turns (${turns.length}), setting open=false`);
      turns = [];
      open = false;
      lastTurnAt = 0;
    },
  };
}
