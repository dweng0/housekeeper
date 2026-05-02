// Inbound ports

export interface SpeechInput {
  startListening(): void;
  stopListening(): void;
  onUtterance(handler: (transcript: string) => void): void;
}

export interface IntentClassifier {
  classify(utterance: string, residentId?: string, memories?: string[]): Promise<ClassifiedIntent>;
}

export interface HttpApi {
  listen(port: number): void;
  close(): void;
}

export interface SpeechOutput {
  speak(text: string): Promise<void>;
}

// Outbound ports

export interface AutomationRepository {
  findAll(): Promise<Automation[]>;
  findById(id: string): Promise<Automation | null>;
  save(automation: Automation): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface DeviceRepository {
  findAll(): Promise<Device[]>;
  findByLabel(label: string): Promise<Device | null>;
  save(device: Device): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface DeviceGateway {
  publish(topic: string, payload: string): Promise<void>;
  subscribe(topic: string, handler: (payload: string) => void): void;
}

export interface ConfigRepository {
  get(): Promise<AppConfig>;
  save(config: AppConfig): Promise<void>;
}

export interface AutoDiscoveryService {
  start(): void;
  stop(): void;
  getUnregisteredTopics(): string[];
}

export interface MemoryStore {
  store(residentId: string, fact: string): Promise<void>;
  search(residentId: string, query: string): Promise<string[]>;
  clear(residentId: string): Promise<void>;
}

// Domain types

export interface Device {
  id: string;
  label: string;
  topic: string;
  type: "sensor" | "actuator";
}

export interface Automation {
  id: string;
  enabled: boolean;
  trigger: Trigger;
  actions: Action[];
}

export interface Trigger {
  deviceLabel: string;
  event: string;
}

export interface Action {
  deviceLabel: string;
  command: string;
  durationSeconds?: number;
  reverseCommand?: string;
}

export interface AppConfig {
  autoDiscovery: boolean;
}

export interface ClassifiedIntent {
  type: "create-automation" | "query" | "unknown";
  automation?: Omit<Automation, "id">;
  query?: string;
}
