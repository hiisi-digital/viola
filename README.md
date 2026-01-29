# `viola`

<div align="center" style="text-align: center;">

[![JSR](https://jsr.io/badges/@hiisi/viola)](https://jsr.io/@hiisi/viola)
[![GitHub Issues](https://img.shields.io/github/issues/hiisi-digital/viola.svg)](https://github.com/hiisi-digital/viola/issues)
![License](https://img.shields.io/github/license/hiisi-digital/viola?color=%23009689)

> Convention linter for codebases. Finds style and structure issues that language linters miss.

</div>

## What it does

`viola` checks for convention violations — naming patterns, file organization, code duplication,
and project-specific rules. Not a replacement for ESLint or `deno lint`; those handle language
correctness. This handles everything else.

Crawls the codebase once, extracts structured data (functions, types, imports, strings), and
runs multiple rules against it. Each rule declares what data it needs and gets only that.

```ts
import { runViola, formatResults } from "@hiisi/viola";

const results = await runViola({
  projectRoot: Deno.cwd(),
  include: ["src", "packages"],
  plugins: ["@hiisi/viola-default-lints"],
});

console.log(formatResults(results));

if (results.hasErrors) Deno.exit(1);
```

## Installation

```bash
deno add jsr:@hiisi/viola jsr:@hiisi/viola-default-lints
```

## Plugin-Based Architecture

Viola has no built-in linters. All linters are loaded as plugins, giving you full control over
what checks run in your project. The official linter package is `@hiisi/viola-default-lints`.

## Configuration

Configure via `deno.json` under the `viola` field:

```json
{
  "viola": {
    "plugins": ["@hiisi/viola-default-lints"],
    "**/*.ts": {
      "*>=major": "error",
      "*>=minor": "warn",
      "*=trivial": "off",
      
      "similar-functions/*": "error",
      "deprecation/stale": "error"
    },
    "**/*_test.ts": {
      "*>=major": "warn",
      "deprecation/*": "off"
    }
  }
}
```

### Plugins

Linters are loaded from the `plugins` array. Any module that exports linters can be a plugin:

```json
{
  "viola": {
    "plugins": [
      "@hiisi/viola-default-lints",
      "./my-local-linters.ts",
      "jsr:@org/custom-lints"
    ]
  }
}
```

### Config Presets

Plugins can provide configuration presets. Inherit from them using the `inherit` field:

```json
{
  "viola": {
    "plugins": ["@hiisi/viola-default-lints"],
    "inherit": ["strict"],
    "**/*.ts": {
      "*>=major": "error"
    }
  }
}
```

A preset named `"default"` is auto-applied when a plugin loads. Your config always takes
precedence over presets.

### Per-Linter Configuration

Configure individual linters via the `config` field:

```json
{
  "viola": {
    "plugins": ["@hiisi/viola-default-lints"],
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

Plugins provide JSON schemas for their linter configs; viola validates against them and
warns about typos or invalid values.

### Issue Classification

Every issue has two dimensions:

**Category** (what kind of problem):
- `correctness` — code is wrong or broken
- `maintainability` — harder to work with over time
- `consistency` — breaks project conventions
- `performance` — slower than needed
- `style` — cosmetic/formatting

**Impact** (how urgent, ordered):
1. `critical` — must fix, blocks release
2. `major` — should fix soon
3. `minor` — fix when convenient
4. `trivial` — nice to have

Each issue also has a **confidence** score (0-100) indicating how certain the rule is.

### Pattern Syntax

Patterns match against `rule/issue` identifiers:

| Pattern | Matches |
|---------|---------|
| `deprecation/stale` | Exact issue |
| `deprecation/*` | All issues from rule |
| `*::correctness` | All issues with category |
| `*>=major` | All issues with impact major or higher |
| `*=minor` | All issues with exactly minor impact |
| `*!=trivial` | All issues except trivial |
| `similar-functions/*::maintainability` | Category filter on specific rule |

**Operators for impact:**
- `=` equals
- `!=` not equals
- `>=` greater or equal
- `<=` less or equal
- `>` greater
- `<` less

**Category filter:** `::category`

### Pattern Resolution

Patterns are matched in order; last match wins. More specific patterns should come after general ones:

```json
{
  "**/*.ts": {
    "*>=major": "error",
    "*>=minor": "warn",
    "similar-functions/*": "error",
    "similar-functions/near-match": { "severity": "warn", "minConfidence": 80 }
  }
}
```

### Value Format

Pattern values can be:
- `"error"` | `"warn"` | `"info"` | `"off"` — simple severity
- `{ "severity": "warn", "minConfidence": 80 }` — with confidence threshold

## Default Linters

The `@hiisi/viola-default-lints` package provides these linters:

| Linter | Description |
|------|-------------|
| `type-location` | Types must be in `types/` directories |
| `similar-functions` | Detect similar function names |
| `similar-types` | Detect similar type names |
| `duplicate-strings` | Find repeated string literals |
| `duplicate-logic` | Find duplicated code patterns |
| `deprecation-check` | Find deprecated code past its removal date |
| `missing-docs` | Find exports without documentation |
| `orphaned-code` | Find unused internal code |
| `schema-collision` | Find conflicting schema definitions |

## Creating Plugins

A plugin is any module that exports linters. The simplest plugin:

```ts
// my-plugin.ts
import { BaseLinter, type CodebaseData, type LinterConfig, type Violation } from "@hiisi/viola";

class MyLinter extends BaseLinter {
  readonly meta = {
    id: "my-linter",
    name: "My Linter",
    description: "Checks naming conventions",
  };

  readonly catalog = {
    "my-linter/bad-name": { 
      category: "consistency", 
      impact: "minor",
      description: "Name does not follow convention"
    },
  };

  readonly requirements = { functions: true };

  lint(data: CodebaseData, config: LinterConfig): Violation[] {
    const violations: Violation[] = [];
    
    for (const fn of data.allFunctions) {
      if (fn.name.startsWith("_")) {
        violations.push(this.warning(
          "bad-name",
          `Function "${fn.name}" starts with underscore`,
          fn.location
        ));
      }
    }
    
    return violations;
  }
}

// Export as linters array (preferred)
export const linters = [new MyLinter()];
```

Use it in your config:

```json
{
  "viola": {
    "plugins": ["./my-plugin.ts"]
  }
}
```

### Plugin Exports

Plugins can export:

- `linters: BaseLinter[]` — Array of linter instances (preferred)
- Individual named exports that are linters
- A default export (single linter or array)
- `bundles: Record<string, BaseLinter[]>` — Named linter collections
- `configPresets: Record<string, ViolaConfigPreset>` — Configuration presets
- `schemas: Record<string, JSONSchema>` — JSON schemas for linter config validation

### Bundles

Bundle groups of linters for convenience:

```ts
export const bundles = {
  minimal: [typeLocationLinter],
  standard: [typeLocationLinter, similarFunctionsLinter, duplicateStringsLinter],
  strict: [...allLinters],
};
```

### Config Presets

Provide default configurations:

```ts
export const configPresets = {
  default: {
    "**/*.ts": {
      "*>=major": "error",
      "*>=minor": "warn",
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

### Config Schemas

Provide JSON schemas for linter config validation:

```ts
export const schemas = {
  "type-location": {
    type: "object",
    properties: {
      allowedDirs: { 
        type: "array", 
        items: { type: "string" },
        description: "Directories where types are allowed"
      },
    },
  },
};
```

## API

### High-Level

- `runViola(options)` — Crawl and check, returns `LintResults`
- `formatResults(results)` — Format for console output

### Runtime

- `crawlCodebase(config)` — Extract codebase data
- `DEFAULT_CONFIG` — Default configuration

### Plugin Loading

- `discoverPlugins(specifiers)` — Load and discover all plugin exports
- `registerDiscoveredLinters(discovery)` — Register discovered linters

### Registry

- `registry.register(linter)` — Register a linter
- `registry.get(id)` — Get linter by ID
- `registry.getAll()` — List all linters
- `runLinters(data, options)` — Run linters on data

### Config Validation

- `validateLinterConfig(config, discovery, ids)` — Validate config against schemas
- `formatValidationErrors(result)` — Format validation errors for display

### Types

- `ViolaConfig` — Configuration options
- `LintResults` — Check results
- `Violation` — Single convention violation
- `CodebaseData` — Extracted codebase structure
- `BaseLinter` — Base class for custom linters
- `ViolaPlugin` — Plugin interface
- `JSONSchema` — JSON Schema type for config validation

## CLI

Use `@hiisi/viola-cli` for command-line access:

```bash
deno run -A jsr:@hiisi/viola-cli
```

Or install globally:

```bash
deno install -A -n viola jsr:@hiisi/viola-cli
```

## Support

Whether you use this project, have learned something from it, or just like it,
please consider supporting it by buying me a coffee, so I can dedicate more time
on open-source projects like this :)

<a href="https://buymeacoffee.com/orgrinrt" target="_blank"><img src="https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png" alt="Buy Me A Coffee" style="height: auto !important;width: auto !important;" ></a>

## License

> You can check out the full license [here](https://github.com/hiisi-digital/viola/blob/main/LICENSE)

This project is licensed under the terms of the **Mozilla Public License 2.0**.

`SPDX-License-Identifier: MPL-2.0`
