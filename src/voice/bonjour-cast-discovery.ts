import { Bonjour } from "bonjour-service";
import type { CastDiscovery, CastDeviceInfo } from "../ports.js";

export function makeBonjourCastDiscovery(): CastDiscovery {
  const bonjour = new Bonjour();
  let browser: ReturnType<typeof bonjour.find> | null = null;
  let foundHandler: ((info: CastDeviceInfo) => void) | null = null;
  let lostHandler: ((uuid: string) => void) | null = null;

  return {
    onDeviceFound(h) { foundHandler = h; },
    onDeviceLost(h) { lostHandler = h; },

    start() {
      browser = bonjour.find({ type: "googlecast" });
      browser.on("up", (service) => {
        const uuid = service.txt?.id as string | undefined;
        if (!uuid) return;
        const host = service.addresses?.[0] ?? service.host;
        foundHandler?.({ uuid, name: service.name, host, port: service.port });
      });
      browser.on("down", (service) => {
        const uuid = service.txt?.id as string | undefined;
        if (uuid) lostHandler?.(uuid);
      });
    },

    stop() {
      browser?.stop();
      bonjour.destroy();
    },
  };
}
