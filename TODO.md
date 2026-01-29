# TODO

## Plugin System Overhaul

### Overview

Viola needs a proper plugin specification. Currently plugins just export linters, but we need
a richer interface that supports bundles, config presets, and schema validation.

---

## Plugin Interface

Each plugin module can implement any combination of these exports:

### `linters`

Array of `BaseLinter` instances. Current spec is sufficient.

```ts
export const linters: BaseLinter[] = [
  typeLocationLinter,
  similarFunctionsLinter,
  // ...
];
```

### `bundles`

Named collections of linters for convenience. A bundle is just a curated subset of the plugin's
linters that users can reference by name.

```ts
export const bundles: Record<string, BaseLinter[]> = {
  default: [typeLocationLinter, similarFunctionsLinter, duplicateStringsLinter],
  strict: [...allLinters],
  minimal: [typeLocationLinter],
};
```

**Collision handling:**
- Bundle names should be unique across all loaded plugins
- If collision detected, require explicit `<plugin>/<bundle>` syntax (e.g., `viola-default-lints/default`)
- If still ambiguous after explicit prefix, error and abort

### `configPresets`

Reusable configuration presets that can be inherited/underlaid.

```ts
export const configPresets: Record<string, ViolaConfigPreset> = {
  default: {
    "**/*.ts": {
      "*>=major": "error",
      "*>=minor": "warn",
      "*=trivial": "off",
    },
  },
  strict: {
    "**/*.ts": {
      "*>=minor": "error",
      "*=trivial": "warn",
    },
  },
};
```

**Behavior:**
- If a preset is named `"default"`, it's automatically applied (underlaid) when the plugin loads
- Other presets must be explicitly enabled via `inherit` field in user config
- User config always wins over preset config (presets are underlaid, not overlaid)

### `schemas`

JSON schemas for validating plugin-specific configuration options.

```ts
export const schemas: Record<string, JSONSchema> = {
  "type-location": {
    type: "object",
    properties: {
      allowedDirs: { type: "array", items: { type: "string" } },
      // ...
    },
  },
};
```

**Purpose:**
- Viola has no knowledge of plugin internals
- Plugins provide schemas so viola can validate user-provided config for that plugin's linters

---

## Config Structure Changes

### Current Structure

```json
{
  "viola": {
    "plugins": ["@hiisi/viola-default-lints"],
    "**/*.ts": {
      "*>=major": "error"
    }
  }
}
```

### New Structure

```json
{
  "viola": {
    "plugins": ["@hiisi/viola-default-lints"],
    "inherit": ["strict"],
    "config": {
      "type-location": {
        "allowedDirs": ["src/types", "packages/*/types"]
      },
      "duplicate-strings": {
        "minLength": 10,
        "threshold": 3
      }
    },
    "**/*.ts": {
      "*>=major": "error"
    }
  }
}
```

### New Fields

#### `inherit`

Array of preset names to inherit from loaded plugins.

```json
{
  "inherit": ["strict", "viola-default-lints/experimental"]
}
```

- Presets are applied in order (later presets override earlier)
- User's own rules are applied last (always win)
- `"default"` presets from plugins are auto-applied before explicit inherits

#### `config`

Per-linter configuration options. Keys are linter IDs.

```json
{
  "config": {
    "type-location": { ... },
    "duplicate-strings": { ... }
  }
}
```

- Validated against schemas provided by plugins
- If no schema exists for a linter, config is passed through without validation
- Unknown linter IDs should warn (typo detection)

---

## Implementation Tasks

### Phase 1: Plugin Interface Types

- [ ] Define `ViolaPlugin` interface in `src/types/plugin.ts`
  - `linters?: BaseLinter[]`
  - `bundles?: Record<string, BaseLinter[]>`
  - `configPresets?: Record<string, ViolaConfigPreset>`
  - `schemas?: Record<string, JSONSchema>`
- [ ] Define `ViolaConfigPreset` type
- [ ] Update `PluginLoadResult` to include discovered bundles, presets, schemas

### Phase 2: Plugin Loader Updates

- [ ] Update `discoverLinters()` to also discover bundles, presets, schemas
- [ ] Track loaded plugins by name for collision detection
- [ ] Implement bundle name collision detection and resolution
- [ ] Store schemas in a global schema registry for validation

### Phase 3: Config Schema Updates

- [ ] Add `inherit` field to `viola-config.schema.json`
- [ ] Add `config` field to `viola-config.schema.json`
- [ ] Update `ViolaConfig` type in `src/data/types.ts`

### Phase 4: Config Loader Updates

- [ ] Parse `inherit` field
- [ ] Parse `config` field
- [ ] Implement preset resolution (find preset by name across plugins)
- [ ] Implement config merging (presets -> user config)
- [ ] Auto-apply `"default"` presets from loaded plugins

### Phase 5: Config Validation

- [ ] Implement schema validation for `config` entries
- [ ] Warn on unknown linter IDs in `config`
- [ ] Validate against plugin-provided schemas

### Phase 6: Runtime Integration

- [ ] Update `runViola()` to:
  1. Load plugins
  2. Collect default presets
  3. Resolve explicit inherits
  4. Merge configs (presets underlaid, user on top)
  5. Validate linter configs against schemas
  6. Run linters with merged config

### Phase 7: Clean Up Viola Core

- [ ] Remove any remaining "builtin" references
- [ ] Remove linter implementations from `src/linters/` (keep only base, registry, types)
- [ ] Update dogfooding to use `@hiisi/viola-default-lints` from JSR
- [ ] Update README to reflect plugin-only architecture
- [ ] Remove `packages/linters/` directory (now in separate repo)

### Phase 8: Documentation

- [ ] Document plugin authoring guide
- [ ] Document available exports (`linters`, `bundles`, `configPresets`, `schemas`)
- [ ] Document config inheritance
- [ ] Document per-linter config options
- [ ] Add examples for common use cases

---

## Open Questions

1. Should `inherit` also support inline presets, or only named references?
2. Should we support disabling default presets? (e.g., `"inherit": ["!default"]`)
3. How to handle circular inheritance if presets can inherit from other presets?
4. Should bundles be usable in the `plugins` field directly? (e.g., `"plugins": ["@hiisi/viola-default-lints/minimal"]`)

---

## Notes

- Plugin name for collision resolution should be derived from the import specifier
  - `@hiisi/viola-default-lints` -> `viola-default-lints`
  - `jsr:@hiisi/viola-default-lints` -> `viola-default-lints`
  - `./local-plugin.ts` -> `local-plugin`
- Keep the plugin interface optional - a module that just exports `linters` array should still work
- Schemas use JSON Schema draft-07 (same as our config schema)
