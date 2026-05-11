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

export function makeConversationContext(timeoutMs = 30_000): ConversationContext {
  let turns: ConversationTurn[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let open = false;

  function resetTimer() {
    if (timer) clearTimeout(timer);
    open = true;
    timer = setTimeout(() => { open = false; }, timeoutMs);
  }

  return {
    addTurn(userUtterance, systemResponse) {
      turns.push({ userUtterance, systemResponse });
      resetTimer();
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
      return open;
    },

    reset() {
      turns = [];
      if (timer) clearTimeout(timer);
      timer = null;
      open = false;
    },
  };
}
