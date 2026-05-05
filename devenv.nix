{ pkgs, ... }:
{
  packages = [
    pkgs.nodejs_22
    pkgs.typescript
    pkgs.piper-tts
    pkgs.curl
    pkgs.zigbee2mqtt
  ];

  languages.typescript.enable = true;

  dotenv.enable = true;

  services.mosquitto = {
    enable = true;
  };

  processes.housekeeper = {
    exec = "npm run dev";
  };

  processes.frontend = {
    exec = "cd client && npm run dev";
  };

  processes.ollama = {
    exec = "ollama serve";
  };

  processes.zigbee2mqtt = {
    exec = ''
      DATA_DIR="$PWD/data/zigbee2mqtt"
      cd /tmp
      ZIGBEE2MQTT_DATA="$DATA_DIR" ZIGBEE2MQTT_CONFIG_SERIAL_PORT="$ZIGBEE_PORT" zigbee2mqtt
    '';
  };

  scripts.test-backend.exec = "npm test";
  scripts.test-frontend.exec = "cd client && npm test";
  scripts.test-all.exec = "npm test && cd client && npm test";
  scripts.test-watch.exec = "npx vitest";

  scripts.health.exec = ''
    curl -s http://localhost:$PORT/health | python3 -m json.tool
  '';

  scripts.nodes.exec = ''
    curl -s http://localhost:$PORT/api/voice-nodes | python3 -m json.tool
  '';

  scripts.logs.exec = ''
    curl -s "http://localhost:$PORT/api/logs''${1:+?type=$1}" | python3 -m json.tool
  '';

  enterShell = ''
    printf '\033[36m'
    printf ' _                     _                         \n'
    printf '| |_  ___ _  _ ___ ___| |_____ ___ _ __  ___ _ _ \n'
    printf '| '"'"' \/ _ \ || (_-</ -_) / / -_) -_) '"'"'_ \/ -_) '"'"'_|\n'
    printf '|_||_\___/\_,_/__/\___|_\_\___\___| .__/\___|_|  \n'
    printf '                                  |_|            \n'
    printf '\033[0m\n'
    printf '\033[33m  AI-centric smart home system\033[0m\n\n'

    printf '\033[1mCommands\033[0m\n'
    printf '  \033[32mtest-backend\033[0m     run backend tests\n'
    printf '  \033[32mtest-frontend\033[0m    run frontend tests\n'
    printf '  \033[32mtest-all\033[0m         run all tests\n'
    printf '  \033[32mtest-watch\033[0m       vitest in watch mode\n'
    printf '  \033[32mhealth\033[0m           server health + connected nodes\n'
    printf '  \033[32mnodes\033[0m            list voice nodes\n'
    printf '  \033[32mlogs [type]\033[0m      tail logs (optional: type filter)\n\n'

    printf "\033[90m  server    http://localhost:$PORT\n"
    printf "  frontend  http://localhost:5173\n"
    printf "  voice     ws://localhost:$VOICE_NODE_PORT\n"
    printf "  llm     $LLM_ENDPOINT ($LLM_MODEL)\n"
    printf "  mqtt    $MQTT_HOST:$MQTT_PORT\n"
    printf "  z2m     http://localhost:8080\033[0m\n\n"
    printf '\033[90m  zigbee dongle: '
    ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null | tr '\n' ' ' || printf 'not found'
    printf '\033[0m\n\n'
  '';

  env = {
    MQTT_HOST = "localhost";
    MQTT_PORT = "1883";
    VOICE_NODE_PORT = "3001";
    PORT = "3000";
    PIPER_VOICE = "data/piper-voices/en_US-lessac-medium.onnx";
    SYSTEM_NAME = "housekeeper";
    ZIGBEE_PORT = "/dev/ttyUSB0";
  };
}
