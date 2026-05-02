{ pkgs, config, ... }:
{
  packages = [
    pkgs.nodejs_22
    pkgs.typescript
    pkgs.piper-tts
    pkgs.whisper-cpp
    pkgs.curl
  ];

  languages.typescript.enable = true;

  services.mosquitto = {
    enable = true;
  };

  processes.housekeeper = {
    exec = "npm run dev";
  };

  processes.ollama = {
    exec = "ollama serve";
  };

  processes.download-vad = {
    exec = "./scripts/download-silero-vad.sh";
    processRunner = "oneshot";
  };

  scripts.test-backend.exec = "npm test";
  scripts.test-frontend.exec = "cd client && npm test";

  env = {
    MQTT_HOST = "localhost";
    MQTT_PORT = "1883";
    LLM_ENDPOINT = "http://localhost:11434/v1";
    LLM_MODEL = "llama3.2";
    PORT = "3000";
    PIPER_VOICE = "data/piper-voices/en_US-lessac-medium.onnx";
    WHISPER_MODEL = "data/whisper-models/ggml-base.en.bin";
    VAD_MODEL = "data/vad-models/ggml-silero-v6.2.0.bin";
    SYSTEM_NAME = "Jarvis";
    VAD_SILENCE_MS = "700";
  };
}
