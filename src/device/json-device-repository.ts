import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { Device, DeviceRepository } from "../ports.js";

const filePath = join(process.cwd(), "data", "devices.json");

async function read(): Promise<Device[]> {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as Device[];
  } catch {
    return [];
  }
}

async function write(devices: Device[]): Promise<void> {
  await writeFile(filePath, JSON.stringify(devices, null, 2));
}

export const jsonDeviceRepository: DeviceRepository = {
  async findAll() {
    return read();
  },
  async findByLabel(label) {
    const devices = await read();
    return devices.find((d) => d.label === label) ?? null;
  },
  async save(device) {
    const devices = await read();
    const idx = devices.findIndex((d) => d.id === device.id);
    if (idx >= 0) {
      devices[idx] = device;
    } else {
      devices.push(device);
    }
    await write(devices);
  },
  async delete(id) {
    const devices = await read();
    await write(devices.filter((d) => d.id !== id));
  },
};
