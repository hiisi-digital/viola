# TODO

## Plugin System Overhaul - COMPLETED

All phases of the plugin system overhaul have been implemented. See README.md for full documentation.

### Summary of Implementation

#### Plugin Interface (`src/types/plugin.ts`)
- `ViolaPlugin` interface with `linters`, `bundles`, `configPresets`, `schemas`
- `ViolaConfigPreset` type for preset configuration
- `DiscoveredBundle`, `DiscoveredPreset`, `DiscoveredSchema` types
- `PluginDiscoveryResult` and `PluginsDiscoveryResult` for aggregated results
- Helper functions: `derivePluginName()`, `qualifiedName()`, `parseQualifiedName()`

#### Plugin Loader (`src/runtime/plugins.ts`)
- `discoverPlugin()` - full discovery of linters, bundles, presets, schemas
- `discoverPlugins()` - batch discovery with collision detection
- `resolveBundle()`, `resolvePreset()` - name resolution with collision handling
- `registerDiscoveredLinters()` - register discovered linters

#### Config System
- `inherit` field for preset inheritance
- `config` field for per-linter configuration
- `mergeConfigWithPresets()` - merge presets with user config
- `mergeLinterConfig()` - merge per-linter configs
- `validateLinterConfig()` - validate against JSON schemas
- Warn on unknown linter IDs (typo detection)

#### Runtime Integration (`mod.ts`)
- `runViola()` loads plugins with full discovery
- Applies default presets automatically
- Merges inherited presets and user config
- Validates linter config against schemas
- Passes merged config to linters

#### Clean Up
- Removed linter implementations from `src/linters/` (now plugin-only)
- Linters live in separate `@hiisi/viola-default-lints` package
- Core only provides infrastructure: `BaseLinter`, `registry`, `runLinters`

---

## Future Improvements

### Open Questions (deferred)

1. Should `inherit` support inline presets, or only named references?
2. Should we support disabling default presets? (e.g., `"inherit": ["!default"]`)
3. How to handle circular inheritance if presets can inherit from other presets?
4. Should bundles be usable in the `plugins` field directly?

### Potential Enhancements

- [ ] Add CLI support for plugin management
- [ ] Support bundle selection in plugins array (e.g., `"@hiisi/viola-default-lints/minimal"`)
- [ ] Add `--init` command to generate starter config
- [ ] Performance: lazy-load plugin schemas (only validate when config present)
- [ ] Add schema caching for faster repeated validation
