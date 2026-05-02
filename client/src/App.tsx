import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, Plus, Tag } from "lucide-react";

interface Device {
  id: string;
  label: string;
  topic: string;
  type: "sensor" | "actuator";
}

interface UnregisteredDevice {
  topic: string;
}

interface AppConfig {
  autoDiscovery: boolean;
}

type FormState = {
  id: string | null;
  label: string;
  topic: string;
  type: "sensor" | "actuator";
};

const EMPTY_FORM: FormState = { id: null, label: "", topic: "", type: "sensor" };

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export default function App() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [unregistered, setUnregistered] = useState<UnregisteredDevice[]>([]);
  const [config, setConfig] = useState<AppConfig>({ autoDiscovery: false });
  const [form, setForm] = useState<FormState | null>(null);
  const [labelForm, setLabelForm] = useState<{ topic: string; label: string; type: "sensor" | "actuator" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [labelError, setLabelError] = useState<string | null>(null);

  async function load() {
    const [data, cfg, unrg] = await Promise.all([
      apiFetch<Device[]>("/api/devices"),
      apiFetch<AppConfig>("/api/config"),
      apiFetch<UnregisteredDevice[]>("/api/unregistered-devices"),
    ]);
    setDevices(data);
    setConfig(cfg);
    setUnregistered(unrg);
  }

  useEffect(() => { load(); }, []);

  async function toggleAutoDiscovery() {
    const updated = await apiFetch<AppConfig>("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoDiscovery: !config.autoDiscovery }),
    });
    setConfig(updated);
    if (!updated.autoDiscovery) setUnregistered([]);
    else {
      const unrg = await apiFetch<UnregisteredDevice[]>("/api/unregistered-devices");
      setUnregistered(unrg);
    }
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setError(null);
  }

  function openEdit(device: Device) {
    setForm({ id: device.id, label: device.label, topic: device.topic, type: device.type });
    setError(null);
  }

  function openLabel(topic: string) {
    setLabelForm({ topic, label: "", type: "sensor" });
    setLabelError(null);
  }

  async function handleDelete(id: string) {
    await apiFetch<undefined>(`/api/devices/${id}`, { method: "DELETE" });
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
      if (form.id) {
        await apiFetch<Device>(`/api/devices/${form.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: form.label, topic: form.topic, type: form.type }),
        });
      } else {
        await apiFetch<Device>("/api/devices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: form.label, topic: form.topic, type: form.type }),
        });
      }
      setForm(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    }
  }

  async function handleLabelSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!labelForm) return;
    if (!labelForm.label.trim()) {
      setLabelError("Label is required");
      return;
    }
    setLabelError(null);
    try {
      await apiFetch<Device>("/api/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: labelForm.label, topic: labelForm.topic, type: labelForm.type }),
      });
      setLabelForm(null);
      await load();
    } catch (err) {
      setLabelError(err instanceof Error ? err.message : "Request failed");
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 text-left">
      {/* Auto-discovery toggle */}
      <div className="flex items-center justify-between mb-8 rounded-lg border border-border bg-card px-5 py-4">
        <div>
          <p className="text-sm font-medium text-card-foreground">Auto-discovery</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Watch MQTT broker for new topics and surface unregistered Devices
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={config.autoDiscovery}
          onClick={toggleAutoDiscovery}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${
            config.autoDiscovery ? "bg-primary" : "bg-muted"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              config.autoDiscovery ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {/* Unregistered devices */}
      {config.autoDiscovery && unregistered.length > 0 && (
        <div className="mb-8">
          <h2 className="text-base font-medium text-foreground mb-3">
            Unregistered Devices
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              ({unregistered.length} new topic{unregistered.length !== 1 ? "s" : ""} seen)
            </span>
          </h2>

          {labelForm && (
            <form
              onSubmit={handleLabelSubmit}
              className="mb-4 rounded-lg border border-border bg-card p-4 space-y-3"
            >
              <p className="text-xs text-muted-foreground font-mono">{labelForm.topic}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label className="text-sm text-muted-foreground" htmlFor="unreg-label">
                    Label <span className="text-destructive">*</span>
                  </label>
                  <input
                    id="unreg-label"
                    className="rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                    value={labelForm.label}
                    onChange={(e) => setLabelForm({ ...labelForm, label: e.target.value })}
                    placeholder="Hallway sensor"
                    autoFocus
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm text-muted-foreground" htmlFor="unreg-type">
                    Type
                  </label>
                  <select
                    id="unreg-type"
                    className="rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                    value={labelForm.type}
                    onChange={(e) => setLabelForm({ ...labelForm, type: e.target.value as "sensor" | "actuator" })}
                  >
                    <option value="sensor">Sensor</option>
                    <option value="actuator">Actuator</option>
                  </select>
                </div>
              </div>
              {labelError && <p className="text-sm text-destructive">{labelError}</p>}
              <div className="flex gap-2">
                <Button type="submit" size="sm">Register</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setLabelForm(null)}>Cancel</Button>
              </div>
            </form>
          )}

          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">MQTT Topic</th>
                  <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {unregistered.map((u) => (
                  <tr key={u.topic} className="hover:bg-muted/40 transition-colors">
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{u.topic}</td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openLabel(u.topic)}
                        aria-label={`Assign label to ${u.topic}`}
                      >
                        <Tag className="mr-1 h-3 w-3" />
                        Assign Label
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
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
    </div>
  );
}
