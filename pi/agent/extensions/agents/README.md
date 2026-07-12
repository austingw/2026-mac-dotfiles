# Agents extension

Configuration lives at `~/.config/pi/agent/agents.jsonc`.

- `/agents` lists configured profiles.
- `/agent <id>` switches the active top-level (`"type": "agent"`) profile.
- `"type": "subagent"` profiles are delegated with the `subagent` tool.
- A subagent runs in Pi RPC mode. Its `"ask"` permission rules are relayed to the parent Pi UI.

Use `shortName` (1–5 alphanumeric/`_`/`-` characters) for compact UI labels, `displayName` for readable text, and `promptFile` for longer role instructions. `tools` controls what the agent can call; `permissions` controls whether those available calls are allowed, asked, or denied.
