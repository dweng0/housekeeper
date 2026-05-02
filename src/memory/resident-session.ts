export const HOUSEHOLD_RESIDENT_ID = "household";

export interface ResidentSession {
  getActive(): string | null;
  setActive(name: string): void;
  clear(): void;
  getResidentId(): string;
}

export function makeResidentSession(): ResidentSession {
  let active: string | null = null;

  return {
    getActive: () => active,
    setActive: (name) => { active = name; },
    clear: () => { active = null; },
    getResidentId: () => active ?? HOUSEHOLD_RESIDENT_ID,
  };
}
