import type { ResponseAudioCache } from "../ports.js";

export const nullResponseAudioCache: ResponseAudioCache = {
  lookup: async () => null,
  lookupNotFound: async () => null,
  lookupStopConfirmation: async () => null,
};
