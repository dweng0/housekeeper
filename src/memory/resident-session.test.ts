import { describe, it, expect } from "vitest";
import { makeResidentSession } from "./resident-session.js";

describe("ResidentSession", () => {
  it("has no active resident initially", () => {
    const session = makeResidentSession();
    expect(session.getActive()).toBeNull();
  });

  it("sets active resident by name", () => {
    const session = makeResidentSession();
    session.setActive("Jay");
    expect(session.getActive()).toBe("Jay");
  });

  it("clears active resident", () => {
    const session = makeResidentSession();
    session.setActive("Jay");
    session.clear();
    expect(session.getActive()).toBeNull();
  });

  it("returns HOUSEHOLD_CONTEXT when no resident active", () => {
    const session = makeResidentSession();
    expect(session.getResidentId()).toBe("household");
  });

  it("returns resident name as id when active", () => {
    const session = makeResidentSession();
    session.setActive("Jay");
    expect(session.getResidentId()).toBe("Jay");
  });
});
