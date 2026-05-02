import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import type { Automation, AutomationRepository, Device, DeviceRepository } from "../ports.js";
import { makeAutomationRouter } from "./automation-router.js";

const sensor: Device = { id: "d1", label: "Front Door", topic: "home/front-door", type: "sensor" };
const actuator: Device = { id: "d2", label: "Porch Light", topic: "home/porch-light", type: "actuator" };

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

function makeAutomationRepo(initial: Automation[] = []): AutomationRepository {
  let stored = [...initial];
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

function makeApp(automationRepo: AutomationRepository, deviceRepo: DeviceRepository) {
  const app = express();
  app.use(express.json());
  app.use("/api/automations", makeAutomationRouter({ automations: automationRepo, devices: deviceRepo }));
  return app;
}

describe("GET /api/automations", () => {
  it("returns empty array when no automations", async () => {
    const app = makeApp(makeAutomationRepo(), makeDeviceRepo([sensor, actuator]));
    const res = await request(app).get("/api/automations");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns all automations", async () => {
    const app = makeApp(makeAutomationRepo([automation]), makeDeviceRepo([sensor, actuator]));
    const res = await request(app).get("/api/automations");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([automation]);
  });
});

describe("POST /api/automations", () => {
  it("creates automation and returns 201 with assigned id", async () => {
    const repo = makeAutomationRepo();
    const app = makeApp(repo, makeDeviceRepo([sensor, actuator]));
    const body = {
      enabled: true,
      trigger: { deviceLabel: "Front Door", event: "open" },
      actions: [{ deviceLabel: "Porch Light", command: "on" }],
    };
    const res = await request(app).post("/api/automations").send(body);
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.trigger).toEqual(body.trigger);
    expect((await repo.findAll())).toHaveLength(1);
  });

  it("returns 400 when trigger references unknown Device Label", async () => {
    const app = makeApp(makeAutomationRepo(), makeDeviceRepo([actuator]));
    const res = await request(app).post("/api/automations").send({
      enabled: true,
      trigger: { deviceLabel: "Unknown Sensor", event: "open" },
      actions: [{ deviceLabel: "Porch Light", command: "on" }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown Sensor/);
  });

  it("returns 400 when action references unknown Device Label", async () => {
    const app = makeApp(makeAutomationRepo(), makeDeviceRepo([sensor]));
    const res = await request(app).post("/api/automations").send({
      enabled: true,
      trigger: { deviceLabel: "Front Door", event: "open" },
      actions: [{ deviceLabel: "Unknown Light", command: "on" }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown Light/);
  });

  it("returns 400 when body is missing trigger", async () => {
    const app = makeApp(makeAutomationRepo(), makeDeviceRepo([sensor, actuator]));
    const res = await request(app).post("/api/automations").send({
      enabled: true,
      actions: [{ deviceLabel: "Porch Light", command: "on" }],
    });
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/automations/:id", () => {
  it("updates existing automation", async () => {
    const repo = makeAutomationRepo([automation]);
    const app = makeApp(repo, makeDeviceRepo([sensor, actuator]));
    const res = await request(app).put("/api/automations/a1").send({ ...automation, enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect((await repo.findById("a1"))?.enabled).toBe(false);
  });

  it("returns 404 when automation does not exist", async () => {
    const app = makeApp(makeAutomationRepo(), makeDeviceRepo([sensor, actuator]));
    const res = await request(app).put("/api/automations/nope").send(automation);
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/automations/:id", () => {
  it("deletes automation and returns 204", async () => {
    const repo = makeAutomationRepo([automation]);
    const app = makeApp(repo, makeDeviceRepo([sensor, actuator]));
    const res = await request(app).delete("/api/automations/a1");
    expect(res.status).toBe(204);
    expect(await repo.findAll()).toEqual([]);
  });
});
