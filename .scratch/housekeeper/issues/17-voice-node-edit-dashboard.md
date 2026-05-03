Status: done

# Voice Node edit form in dashboard

## What to build

Add inline editing of label and location for confirmed Voice Nodes. When saved, the PUT /api/voice-nodes/:id request triggers a config_update push to the node if it is online — implemented in issue 16. Currently the dashboard only shows label/location as read-only text with no way to change them.

## Acceptance criteria

- [x] Confirmed Voice Nodes table has an Edit button per row
- [x] Clicking Edit opens an inline form pre-filled with current label and location
- [x] Saving calls PUT /api/voice-nodes/:id with { label, location }
- [x] Table refreshes after save (label/location update visible immediately)
- [x] Cancel discards changes and restores read-only row
- [x] Edit button hidden when node is being edited (row replaced by form)

## Blocked by

- Issue 16 (voice node config push)
