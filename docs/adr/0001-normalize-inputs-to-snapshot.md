# Normalize external designs to Snapshot

tokenloom normalizes plugin exports and REST responses to one `Snapshot` before parsing or token generation.
This keeps Figma transport fields and plan-specific behavior inside adapters, so the deterministic core remains usable with committed sample designs and future input routes.
