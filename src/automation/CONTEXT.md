# Automation Context

Manages the Device registry and Automation rules. Executes Automations deterministically against the MQTT broker — no AI involvement at runtime.

## Language

**Device**:
An MQTT-connected entity with a human-readable Label. May be a Sensor or an Actuator.
_Avoid_: thing, node, endpoint

**Sensor**:
A Device that emits state events (e.g. motion detected, door opened).
_Avoid_: trigger, input device

**Actuator**:
A Device that receives commands (e.g. light switch, thermostat).
_Avoid_: output device, switch (too specific)

**Label**:
The human-readable name assigned to a Device (e.g. "Hallway sensor"). Used by the AI to resolve natural language references to specific MQTT topics.
_Avoid_: name, alias, friendly name

**Auto-discovery**:
A toggleable mode in which the system watches the MQTT broker for new topics and surfaces unregistered Devices in the dashboard for labelling. Disabled for security when only known Devices should be visible.
_Avoid_: device scan, discovery mode

**Automation**:
A persisted rule that maps a Trigger to one or more Actions. Stored in `data/automations.json`. Executed by the automation engine without AI involvement.
_Avoid_: rule, scene, script

**Trigger**:
The condition that activates an Automation (e.g. a Sensor emitting a specific event).
_Avoid_: condition, event, when-clause

**Action**:
A command sent to an Actuator when an Automation fires.
_Avoid_: effect, then-clause, command

## Relationships

- A **Device** has exactly one **Label**
- A **Device** must be registered before it can be referenced in an **Automation**
- An **Automation** has one **Trigger** and one or more **Actions**
- A **Trigger** references a **Sensor** by Label
- An **Action** references an **Actuator** by Label

## Storage

- `data/devices.json` — Device registry
- `data/automations.json` — Automation rules
