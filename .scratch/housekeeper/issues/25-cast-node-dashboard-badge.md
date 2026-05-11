Status: needs-triage

# Dashboard: transport badge on Voice Node list

## What to build

Cast Nodes appear in the Voice Node list (confirmed and unconfirmed) with no visual distinction from WebSocket Nodes. Add a transport badge so the user can tell at a glance whether a node is a Cast device (Nest Mini) or a WebSocket device (Pi).

## Acceptance criteria

- [ ] Each Voice Node row in the dashboard shows a transport badge: `Cast` or `WebSocket`
- [ ] Badge is visible in both the confirmed node list and the unconfirmed (pending confirmation) list
- [ ] No change to the existing confirm / edit / delete flows

## Blocked by

None - can start immediately
