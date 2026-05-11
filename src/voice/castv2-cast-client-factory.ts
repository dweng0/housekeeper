import { createRequire } from "module";
import type { CastClientFactory, CastClient } from "../ports.js";

const require = createRequire(import.meta.url);

export function makeCastv2ClientFactory(): CastClientFactory {
  return {
    connect(host, port): Promise<CastClient> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { Client, DefaultMediaReceiver } = require("castv2-client") as any;

      return new Promise((resolve, reject) => {
        const client = new Client();

        client.on("error", reject);

        client.connect({ host, port }, () => {
          client.launch(DefaultMediaReceiver, (err: Error | null, player: any) => {
            if (err) { reject(err); return; }

            resolve({
              playUrl(url): Promise<void> {
                return new Promise((res, rej) => {
                  const media = { contentId: url, contentType: "audio/wav", streamType: "BUFFERED" };
                  player.load(media, { autoplay: true }, (loadErr: Error | null) => {
                    if (loadErr) rej(loadErr); else res();
                  });
                });
              },
              close() {
                client.close();
              },
            });
          });
        });
      });
    },
  };
}
