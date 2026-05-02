import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Automation, AutomationRepository, Device, DeviceGateway, DeviceRepository } from "../ports.js";
import { makeAutomationEngine } from "./automation-engine.js";

const frontDoor: Device = { id: "d1", label: "Front Door", topic: "home/front-door", type: "sensor" };
const porchLight: Device = { id: "d2", label: "Porch Light", topic: "home/porch-light", type: "actuator" };

const automation: Automation = {
  id: "a1",
  enabled: true,
  trigger: { deviceLabel: "Front Door", event: "open" },
  actions: [{ deviceLabel: "Porch Light", command: "on" }],
};

function makeDeviceRepo(devices: Device[]): DeviceRepository {
  return {
    findAll: async () => devices,
    findByLabel: async (label) => devices.find((d) => d.label === label) ?? null,
    save: async () => {},
    delete: async () => {},
  };
}

function makeAutomationRepo(automations: Automation[]): AutomationRepository {
  let stored = [...automations];
  return {
    findAll: async () => stored,
    findById: async (id) => stored.find((a) => a.id === id) ?? null,
    save: async (a) => {
      const idx = stored.findIndex((x) => x.id === a.id);
      if (idx >= 0) stored[idx] = a; else stored.push(a);
    },
    delete: async (id) => { stored = stored.filter((a) => a.id !== id); },
  };
}

function makeGateway() {
  const published: Array<{ topic: string; payload: string }> = [];
  const subscriptions = new Map<string, (payload: string) => void>();
  const gateway: DeviceGateway = {
    publish: async (topic, payload) => { published.push({ topic, payload }); },
    subscribe: (topic, handler) => { subscriptions.set(topic, handler); },
  };
  return { gateway, published, subscriptions };
}

describe("AutomationEngine", () => {
  it("fires Action when Sensor event matches enabled Automation Trigger", async () => {
    const { gateway, published, subscriptions } = makeGateway();
    const engine = makeAutomationEngine({
      devices: makeDeviceRepo([frontDoor, porchLight]),
      automations: makeAutomationRepo([automation]),
      gateway,
    });

    await engine.start();
    subscriptions.get("home/front-door")!("open");
    await vi.waitFor(() => expect(published).toHaveLength(1));

    expect(published[0]).toEqual({ topic: "home/porch-light", payload: "on" });
  });

  it("skips disabled Automation", async () => {
    const { gateway, published, subscriptions } = makeGateway();
    const engine = makeAutomationEngine({
      devices: makeDeviceRepo([frontDoor, porchLight]),
      automations: makeAutomationRepo([{ ...automation, enabled: false }]),
      gateway,
    });

    await engine.start();
    subscriptions.get("home/front-door")!("open");
    await new Promise((r) => setTimeout(r, 10));

    expect(published).toHaveLength(0);
  });

  it("does not fire when event payload does not match Trigger event", async () => {
    const { gateway, published, subscriptions } = makeGateway();
    const engine = makeAutomationEngine({
      devices: makeDeviceRepo([frontDoor, porchLight]),
      automations: makeAutomationRepo([automation]),
      gateway,
    });

    await engine.start();
    subscriptions.get("home/front-door")!("close");
    await new Promise((r) => setTimeout(r, 10));

    expect(published).toHaveLength(0);
  });

  it("auto-reverses duration Action after timeout", async () => {
    vi.useFakeTimers();
    const { gateway, published, subscriptions } = makeGateway();
    const durAutomation: Automation = {
      ...automation,
      actions: [{ deviceLabel: "Porch Light", command: "on", durationSeconds: 30, reverseCommand: "off" }],
    };
    const engine = makeAutomationEngine({
      devices: makeDeviceRepo([frontDoor, porchLight]),
      automations: makeAutomationRepo([durAutomation]),
      gateway,
    });

    await engine.start();
    subscriptions.get("home/front-door")!("open");
    await vi.waitFor(() => expect(published).toHaveLength(1));

    vi.advanceTimersByTime(30_000);
    expect(published).toHaveLength(2);
    expect(published[1]).toEqual({ topic: "home/porch-light", payload: "off" });

    vi.useRealTimers();
  });

  it("uses latest automations from repo on each event (live reload)", async () => {
    const { gateway, published, subscriptions } = makeGateway();
    const automationRepo = makeAutomationRepo([{ ...automation, enabled: false }]);
    const engine = makeAutomationEngine({
      devices: makeDeviceRepo([frontDoor, porchLight]),
      automations: automationRepo,
      gateway,
    });

    await engine.start();
    subscriptions.get("home/front-door")!("open");
    await new Promise((r) => setTimeout(r, 10));
    expect(published).toHaveLength(0);

    await automationRepo.save({ ...automation, enabled: true });
    subscriptions.get("home/front-door")!("open");
    await vi.waitFor(() => expect(published).toHaveLength(1));
  });
});
