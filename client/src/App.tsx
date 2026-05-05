import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, Plus } from "lucide-react";

interface Device {
  id: string;
  label: string;
  topic: string;
  type: "sensor" | "actuator";
  commandMap?: Record<string, string>;
}

interface AppConfig {
  defaultOutputNodeId?: string;
  systemName?: string;
  persona?: string;
}

interface VoiceNode {
  id: string;
  label: string;
  location: string;
  capabilities: ("mic" | "speaker")[];
  confirmed: boolean;
  online: boolean;
}

type LogEntry =
  | { type: "directed-question"; timestamp: string; nodeId: string; transcript: string; intent: { type: string }; outcome: string }
  | { type: "automation-firing"; timestamp: string; automationId: string; triggerTopic: string; triggerPayload: string; actions: { topic: string; command: string }[] };

interface Automation {
  id: string;
  enabled: boolean;
  trigger: { deviceLabel: string; event: string };
  actions: { deviceLabel: string; command: string; durationSeconds?: number; reverseCommand?: string }[];
}

type FormState = {
  id: string | null;
  label: string;
  topic: string;
  type: "sensor" | "actuator";
  commandMap: Record<string, string>;
};

type AutomationFormState = {
  id: string | null;
  enabled: boolean;
  triggerLabel: string;
  triggerEvent: string;
  actionLabel: string;
  actionCommand: string;
  durationSeconds: string;
  reverseCommand: string;
};

const EMPTY_FORM: FormState = { id: null, label: "", topic: "", type: "sensor", commandMap: {} };
const EMPTY_AUTOMATION_FORM: AutomationFormState = {
  id: null, enabled: true, triggerLabel: "", triggerEvent: "", actionLabel: "", actionCommand: "", durationSeconds: "", reverseCommand: ""
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export default function App() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [config, setConfig] = useState<AppConfig>({});
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [voiceNodes, setVoiceNodes] = useState<VoiceNode[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logFilter, setLogFilter] = useState<string>("");
  const [form, setForm] = useState<FormState | null>(null);
  const [automationForm, setAutomationForm] = useState<AutomationFormState | null>(null);
  const [voiceNodeEditForm, setVoiceNodeEditForm] = useState<{ id: string; label: string; location: string } | null>(null);
  const [personaForm, setPersonaForm] = useState<{ persona: string; systemName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [automationError, setAutomationError] = useState<string | null>(null);
  const [personaError, setPersonaError] = useState<string | null>(null);

  async function load() {
    const [data, cfg, autos, nodes] = await Promise.all([
      apiFetch<Device[]>("/api/devices"),
      apiFetch<AppConfig>("/api/config"),
      apiFetch<Automation[]>("/api/automations"),
      apiFetch<VoiceNode[]>("/api/voice-nodes"),
    ]);
    setDevices(data);
    setConfig(cfg);
    setAutomations(autos);
    setVoiceNodes(nodes);
  }

  async function loadLogs() {
    const filter = logFilter ? `?type=${logFilter}` : "";
    const entries = await apiFetch<LogEntry[]>(`/api/logs${filter}`);
    setLogs(entries);
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { loadLogs(); const t = setInterval(loadLogs, 4000); return () => clearInterval(t); }, [logFilter]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setError(null);
  }

  function openEdit(device: Device) {
    setForm({ id: device.id, label: device.label, topic: device.topic, type: device.type, commandMap: device.commandMap ?? {} });
    setError(null);
  }

  function openEditPersona() {
    setPersonaForm({
      persona: config.persona ?? "",
      systemName: config.systemName ?? "",
    });
    setPersonaError(null);
  }

  async function handlePersonaSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!personaForm) return;
    if (!personaForm.systemName.trim()) {
      setPersonaError("System name is required");
      return;
    }
    setPersonaError(null);
    try {
      const updated = await apiFetch<AppConfig>("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultOutputNodeId: config.defaultOutputNodeId,
          systemName: personaForm.systemName,
          persona: personaForm.persona,
        }),
      });
      setConfig(updated);
      setPersonaForm(null);
    } catch (err) {
      setPersonaError(err instanceof Error ? err.message : "Request failed");
    }
  }

  function openCreateAutomation() {
    setAutomationForm(EMPTY_AUTOMATION_FORM);
    setAutomationError(null);
  }

  function openEditAutomation(automation: Automation) {
    setAutomationForm({
      id: automation.id,
      enabled: automation.enabled,
      triggerLabel: automation.trigger.deviceLabel,
      triggerEvent: automation.trigger.event,
      actionLabel: automation.actions[0]?.deviceLabel ?? "",
      actionCommand: automation.actions[0]?.command ?? "",
      durationSeconds: automation.actions[0]?.durationSeconds?.toString() ?? "",
      reverseCommand: automation.actions[0]?.reverseCommand ?? "",
    });
    setAutomationError(null);
  }

  async function handleDelete(id: string) {
    await apiFetch<undefined>(`/api/devices/${id}`, { method: "DELETE" });
    await load();
  }

  async function handleDeleteAutomation(id: string) {
    await apiFetch<undefined>(`/api/automations/${id}`, { method: "DELETE" });
    await load();
  }

  async function handleToggleAutomation(automation: Automation) {
    await apiFetch<Automation>(`/api/automations/${automation.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: !automation.enabled,
        trigger: automation.trigger,
        actions: automation.actions,
      }),
    });
    await load();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    if (!form.label.trim()) {
      setError("Label is required");
      return;
    }
    setError(null);
    try {
      const body = { label: form.label, topic: form.topic, type: form.type, commandMap: Object.keys(form.commandMap).length > 0 ? form.commandMap : undefined };
      if (form.id) {
        await apiFetch<Device>(`/api/devices/${form.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        await apiFetch<Device>("/api/devices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      setForm(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    }
  }

  async function handleAutomationSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!automationForm) return;
    if (!automationForm.triggerLabel || !automationForm.actionLabel) {
      setAutomationError("Trigger and Action devices are required");
      return;
    }
    setAutomationError(null);
    const payload = {
      enabled: automationForm.enabled,
      trigger: { deviceLabel: automationForm.triggerLabel, event: automationForm.triggerEvent },
      actions: [{
        deviceLabel: automationForm.actionLabel,
        command: automationForm.actionCommand,
        durationSeconds: automationForm.durationSeconds ? parseInt(automationForm.durationSeconds) : undefined,
        reverseCommand: automationForm.reverseCommand || undefined,
      }],
    };
    try {
      if (automationForm.id) {
        await apiFetch<Automation>(`/api/automations/${automationForm.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch<Automation>("/api/automations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      setAutomationForm(null);
      await load();
    } catch (err) {
      setAutomationError(err instanceof Error ? err.message : "Request failed");
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 text-left">
      {/* Assistant Settings */}
      <div className="mb-8 rounded-lg border border-border bg-card px-5 py-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-card-foreground">Assistant Settings</p>
          <Button variant="ghost" size="icon-sm" onClick={openEditPersona} aria-label="Edit assistant settings">
            <Pencil />
          </Button>
        </div>
        <div className="text-xs text-muted-foreground">
          <p>System name: <span className="font-medium">{config.systemName ?? "housekeeper"}</span></p>
          <p className="mt-1 truncate">Persona: <span className="font-medium">{config.persona?.substring(0, 60) ?? "You are a friendly and helpful smart home assistant..."}{config.persona && config.persona.length > 60 && "..."}</span></p>
        </div>
      </div>

      {personaForm && (
        <form
          onSubmit={handlePersonaSubmit}
          className="mb-8 rounded-lg border border-border bg-card p-5 space-y-4"
        >
          <h2 className="text-base font-medium text-card-foreground">Edit Assistant Settings</h2>

          <div className="flex flex-col gap-1">
            <label className="text-sm text-muted-foreground" htmlFor="systemName">
              System Name <span className="text-destructive">*</span>
            </label>
            <input
              id="systemName"
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
              value={personaForm.systemName}
              onChange={(e) => setPersonaForm({ ...personaForm, systemName: e.target.value })}
              placeholder="housekeeper"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm text-muted-foreground" htmlFor="persona">
              Persona
            </label>
            <textarea
              id="persona"
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring min-h-32"
              value={personaForm.persona}
              onChange={(e) => setPersonaForm({ ...personaForm, persona: e.target.value })}
              placeholder="You are a friendly and helpful smart home assistant..."
            />
            <p className="text-xs text-muted-foreground">Use {'{SYSTEM_NAME}'} as a placeholder for the system name</p>
          </div>

          {personaError && <p className="text-sm text-destructive">{personaError}</p>}

          <div className="flex gap-2">
            <Button type="submit" size="sm">Save</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setPersonaForm(null)}>Cancel</Button>
          </div>
        </form>
      )}

      {/* Registered devices */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold text-foreground">Devices</h1>
        <Button onClick={openCreate} size="sm">
          <Plus />
          Add Device
        </Button>
      </div>

      {form && (
        <form
          onSubmit={handleSubmit}
          className="mb-8 rounded-lg border border-border bg-card p-5 space-y-4"
        >
          <h2 className="text-base font-medium text-card-foreground">
            {form.id ? "Edit Device" : "New Device"}
          </h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground" htmlFor="label">
                Label <span className="text-destructive">*</span>
              </label>
              <input
                id="label"
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="Hallway sensor"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground" htmlFor="topic">
                MQTT Topic
              </label>
              <input
                id="topic"
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={form.topic}
                onChange={(e) => setForm({ ...form, topic: e.target.value })}
                placeholder="home/hallway/motion"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground" htmlFor="type">
                Type
              </label>
              <select
                id="type"
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as "sensor" | "actuator" })}
              >
                <option value="sensor">Sensor</option>
                <option value="actuator">Actuator</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm text-muted-foreground">Command Map</label>
            {Object.entries(form.commandMap).map(([key, value]) => (
              <div key={key} className="flex gap-2 items-center">
                <input
                  className="w-28 rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                  value={key}
                  readOnly
                  placeholder="command"
                />
                <span className="text-muted-foreground">→</span>
                <input
                  className="w-28 rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                  value={value}
                  onChange={(e) => setForm({ ...form, commandMap: { ...form.commandMap, [key]: e.target.value } })}
                  placeholder="payload"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const { [key]: _, ...rest } = form.commandMap;
                    setForm({ ...form, commandMap: rest });
                  }}
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => {
                const newKey = prompt("Command name (e.g. on, off):");
                if (newKey && !form.commandMap[newKey]) {
                  setForm({ ...form, commandMap: { ...form.commandMap, [newKey]: "" } });
                }
              }}
            >
              + Add entry
            </Button>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2">
            <Button type="submit" size="sm">
              {form.id ? "Save" : "Create"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setForm(null)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {devices.length === 0 ? (
        <p className="text-sm text-muted-foreground">No devices registered yet.</p>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Label</th>
                <th className="px-4 py-2.5 text-left font-medium">MQTT Topic</th>
                <th className="px-4 py-2.5 text-left font-medium">Type</th>
                <th className="px-4 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {devices.map((device) => (
                <tr key={device.id} className="hover:bg-muted/40 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground">{device.label}</td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{device.topic}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        device.type === "sensor"
                          ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                      }`}
                    >
                      {device.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openEdit(device)}
                        aria-label={`Edit ${device.label}`}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="destructive"
                        size="icon-sm"
                        onClick={() => handleDelete(device.id)}
                        aria-label={`Delete ${device.label}`}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Voice Nodes */}
      <div className="mt-10 mb-4">
        <h1 className="text-2xl font-semibold text-foreground mb-4">Voice Nodes</h1>

        {/* Unconfirmed nodes */}
        {voiceNodes.filter(n => !n.confirmed).length > 0 && (
          <div className="mb-6">
            <h2 className="text-base font-medium text-foreground mb-3">
              Unconfirmed Nodes
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                ({voiceNodes.filter(n => !n.confirmed).length} pending)
              </span>
            </h2>
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">ID</th>
                    <th className="px-4 py-2.5 text-left font-medium">Location</th>
                    <th className="px-4 py-2.5 text-left font-medium">Capabilities</th>
                    <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-card">
                  {voiceNodes.filter(n => !n.confirmed).map(node => (
                    <tr key={node.id} className="hover:bg-muted/40 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{node.id}</td>
                      <td className="px-4 py-3">{node.location}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{node.capabilities.join(", ")}</td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" onClick={async () => {
                          await apiFetch(`/api/voice-nodes/${node.id}`, {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ confirmed: true }),
                          });
                          await load();
                        }}>Confirm</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Confirmed nodes */}
        {voiceNodes.filter(n => n.confirmed).length === 0 ? (
          <p className="text-sm text-muted-foreground">No confirmed Voice Nodes yet.</p>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden mb-4">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Label</th>
                  <th className="px-4 py-2.5 text-left font-medium">Location</th>
                  <th className="px-4 py-2.5 text-left font-medium">Capabilities</th>
                  <th className="px-4 py-2.5 text-left font-medium">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {voiceNodes.filter(n => n.confirmed).map(node => {
                  const isEditing = voiceNodeEditForm?.id === node.id;
                  return isEditing ? (
                    <tr key={node.id} className="bg-muted/40">
                      <td className="px-4 py-2">
                        <input
                          className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
                          value={voiceNodeEditForm.label}
                          onChange={e => setVoiceNodeEditForm({ ...voiceNodeEditForm, label: e.target.value })}
                          placeholder="Label"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
                          value={voiceNodeEditForm.location}
                          onChange={e => setVoiceNodeEditForm({ ...voiceNodeEditForm, location: e.target.value })}
                          placeholder="Location"
                        />
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{node.capabilities.join(", ")}</td>
                      <td className="px-4 py-2">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${node.online ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}>
                          {node.online ? "online" : "offline"}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right flex gap-2 justify-end">
                        <Button size="sm" onClick={async () => {
                          await apiFetch(`/api/voice-nodes/${node.id}`, {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ label: voiceNodeEditForm.label, location: voiceNodeEditForm.location }),
                          });
                          setVoiceNodeEditForm(null);
                          await load();
                        }}>Save</Button>
                        <Button size="sm" variant="ghost" onClick={() => setVoiceNodeEditForm(null)}>Cancel</Button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={node.id} className="hover:bg-muted/40 transition-colors">
                      <td className="px-4 py-3 font-medium">{node.label}</td>
                      <td className="px-4 py-3 text-muted-foreground">{node.location}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{node.capabilities.join(", ")}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${node.online ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}>
                          {node.online ? "online" : "offline"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right flex gap-2 justify-end">
                        <Button variant="ghost" size="icon-sm" onClick={() => setVoiceNodeEditForm({ id: node.id, label: node.label, location: node.location })} aria-label={`Edit ${node.label}`}><Pencil /></Button>
                        <Button variant="destructive" size="icon-sm" onClick={async () => {
                          await apiFetch(`/api/voice-nodes/${node.id}`, { method: "DELETE" });
                          await load();
                        }} aria-label={`Delete ${node.label}`}><Trash2 /></Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Default output node selector */}
        <div className="flex items-center gap-3 mt-2">
          <label className="text-sm text-muted-foreground whitespace-nowrap">Default output node:</label>
          <select
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            value={config.defaultOutputNodeId ?? ""}
            onChange={async (e) => {
              const updated = await apiFetch<AppConfig>("/api/config", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ defaultOutputNodeId: e.target.value || undefined }),
              });
              setConfig(updated);
            }}
          >
            <option value="">None</option>
            {voiceNodes.filter(n => n.confirmed && n.capabilities.includes("speaker")).map(n => (
              <option key={n.id} value={n.id}>{n.label} ({n.location})</option>
            ))}
          </select>
        </div>
      </div>

      {/* Automations */}
      <div className="flex items-center justify-between mb-4 mt-10">
        <h1 className="text-2xl font-semibold text-foreground">Automations</h1>
        <Button onClick={openCreateAutomation} size="sm">
          <Plus />
          Add Automation
        </Button>
      </div>

      {automationForm && (
        <form
          onSubmit={handleAutomationSubmit}
          className="mb-8 rounded-lg border border-border bg-card p-5 space-y-4"
        >
          <h2 className="text-base font-medium text-card-foreground">
            {automationForm.id ? "Edit Automation" : "New Automation"}
          </h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground" htmlFor="triggerLabel">
                Trigger Sensor <span className="text-destructive">*</span>
              </label>
              <select
                id="triggerLabel"
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={automationForm.triggerLabel}
                onChange={(e) => setAutomationForm({ ...automationForm, triggerLabel: e.target.value })}
              >
                <option value="">Select sensor...</option>
                {devices.filter(d => d.type === "sensor").map(d => (
                  <option key={d.id} value={d.label}>{d.label}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground" htmlFor="triggerEvent">
                Trigger Event
              </label>
              <input
                id="triggerEvent"
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={automationForm.triggerEvent}
                onChange={(e) => setAutomationForm({ ...automationForm, triggerEvent: e.target.value })}
                placeholder="open"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground" htmlFor="actionLabel">
                Action Actuator <span className="text-destructive">*</span>
              </label>
              <select
                id="actionLabel"
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={automationForm.actionLabel}
                onChange={(e) => setAutomationForm({ ...automationForm, actionLabel: e.target.value })}
              >
                <option value="">Select actuator...</option>
                {devices.filter(d => d.type === "actuator").map(d => (
                  <option key={d.id} value={d.label}>{d.label}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground" htmlFor="actionCommand">
                Action Command
              </label>
              <input
                id="actionCommand"
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={automationForm.actionCommand}
                onChange={(e) => setAutomationForm({ ...automationForm, actionCommand: e.target.value })}
                placeholder="on"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground" htmlFor="durationSeconds">
                Duration (seconds)
              </label>
              <input
                id="durationSeconds"
                type="number"
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={automationForm.durationSeconds}
                onChange={(e) => setAutomationForm({ ...automationForm, durationSeconds: e.target.value })}
                placeholder="30"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground" htmlFor="reverseCommand">
                Reverse Command
              </label>
              <input
                id="reverseCommand"
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={automationForm.reverseCommand}
                onChange={(e) => setAutomationForm({ ...automationForm, reverseCommand: e.target.value })}
                placeholder="off"
              />
            </div>
          </div>

          {automationError && <p className="text-sm text-destructive">{automationError}</p>}

          <div className="flex gap-2">
            <Button type="submit" size="sm">
              {automationForm.id ? "Save" : "Create"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAutomationForm(null)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {automations.length === 0 ? (
        <p className="text-sm text-muted-foreground">No automations configured yet.</p>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium w-8">Enabled</th>
                <th className="px-4 py-2.5 text-left font-medium">Trigger</th>
                <th className="px-4 py-2.5 text-left font-medium">Action</th>
                <th className="px-4 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {automations.map((automation) => (
                <tr key={automation.id} className="hover:bg-muted/40 transition-colors">
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={automation.enabled}
                      onClick={() => handleToggleAutomation(automation)}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${
                        automation.enabled ? "bg-primary" : "bg-muted"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                          automation.enabled ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    <span className="font-medium">{automation.trigger.deviceLabel}</span>
                    <span className="text-muted-foreground ml-1">→ {automation.trigger.event}</span>
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    <span className="font-medium">{automation.actions[0]?.deviceLabel}</span>
                    <span className="text-muted-foreground ml-1">→ {automation.actions[0]?.command}</span>
                    {automation.actions[0]?.durationSeconds && (
                      <span className="text-xs text-muted-foreground ml-1">({automation.actions[0].durationSeconds}s)</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openEditAutomation(automation)}
                        aria-label={`Edit automation`}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="destructive"
                        size="icon-sm"
                        onClick={() => handleDeleteAutomation(automation.id)}
                        aria-label={`Delete automation`}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* Logs */}
      <div className="mt-10">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-semibold text-foreground">Activity Log</h1>
          <select
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            value={logFilter}
            onChange={(e) => setLogFilter(e.target.value)}
          >
            <option value="">All</option>
            <option value="directed-question">Directed Questions</option>
            <option value="automation-firing">Automation Firings</option>
          </select>
        </div>

        {logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Time</th>
                  <th className="px-4 py-2.5 text-left font-medium">Type</th>
                  <th className="px-4 py-2.5 text-left font-medium">Detail</th>
                  <th className="px-4 py-2.5 text-left font-medium">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {logs.map((entry, i) => (
                  <tr key={i} className="hover:bg-muted/40 transition-colors">
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap font-mono">
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        entry.type === "directed-question"
                          ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                      }`}>
                        {entry.type === "directed-question" ? "voice" : "automation"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">
                      {entry.type === "directed-question"
                        ? entry.transcript
                        : `${entry.triggerTopic} → ${entry.actions.map(a => a.command).join(", ")}`}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {entry.type === "directed-question" ? entry.outcome : "fired"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
