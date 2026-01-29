# `viola`

<div align="center" style="text-align: center;">

[![JSR](https://jsr.io/badges/@hiisi/viola)](https://jsr.io/@hiisi/viola)
[![GitHub Issues](https://img.shields.io/github/issues/hiisi-digital/viola.svg)](https://github.com/hiisi-digital/viola/issues)
![License](https://img.shields.io/github/license/hiisi-digital/viola?color=%23009689)

> Convention linter runtime for codebases. Plugin-based, zero opinions.

</div>

## What is Viola?

Viola is a **runtime and framework** for convention linting. It crawls your codebase once, extracts structured data (functions, types, imports, strings), and runs linter plugins against it.

Viola itself has **no built-in linters** and **no opinions**. You bring your own linters - whether that's your own custom rules, third-party plugins, or the `@hiisi/viola-default-lints` package.

Think of it like a test runner that doesn't include any test assertions - you bring the assertions (linters) you need.

## Installation

```bash
deno add jsr:@hiisi/viola
```

## Integration Examples

### Deno Test Suite

```ts
// conventions_test.ts
import { runViola } from "@hiisi/viola";
import { assertEquals } from "@std/assert";

Deno.test("no underscore functions", async () => {
  const results = await runViola({ plugins: ["./linters.ts"], only: ["no-underscore-functions"] });
  assertEquals(results.violations.length, 0, results.violations.map(v => v.message).join("\n"));
});
```

### Pre-commit Hook

```bash
#!/bin/sh
deno run -A jsr:@hiisi/viola-cli --plugins ./linters.ts || exit 1
```

### Build Pipeline Step

```json
{
  "tasks": {
    "build": "deno task lint:conventions && deno task compile",
    "lint:conventions": "deno run -A jsr:@hiisi/viola-cli"
  }
}
```

### CI Workflow

```yaml
- name: Convention Lint
  run: deno run -A jsr:@hiisi/viola-cli --report-only
```

### Watch Mode (Development)

```bash
deno run --watch -A jsr:@hiisi/viola-cli --plugins ./linters.ts
```

### Monorepo (Per-Package Linting)

```ts
for (const pkg of ["packages/core", "packages/cli"]) {
  const results = await runViola({ projectRoot: pkg, plugins: ["../../linters.ts"] });
  console.log(`${pkg}: ${results.violations.length} issues`);
}
```

## Usage

### Programmatic API

```ts
import { runViola, formatResults } from "@hiisi/viola";

const results = await runViola({
  projectRoot: Deno.cwd(),
  include: ["src"],
  plugins: ["./my-linters.ts"],  // Your linters
});

console.log(formatResults(results));
if (results.hasErrors) Deno.exit(1);
```

### With CLI

For command-line usage, see [`@hiisi/viola-cli`](https://jsr.io/@hiisi/viola-cli).

```bash
deno install -A -n viola jsr:@hiisi/viola-cli
viola --plugins ./my-linters.ts
```

## Configuration

Configure via `deno.json` under the `viola` field:

```json
{
  "viola": {
    "plugins": ["./my-linters.ts"],
    "**/*.ts": {
      "*>=major": "error",
      "*>=minor": "warn",
      "*=trivial": "off"
    },
    "**/*_test.ts": {
      "*": "off"
    }
  }
}
```

### Plugins

The `plugins` array specifies which linter modules to load. Plugins can be:

- Local files: `"./my-linters.ts"`
- JSR packages: `"jsr:@org/linters"`
- npm packages: `"npm:some-linters"`
- Import map references: `"@org/linters"`

### Severity Rules

File patterns map to severity configurations:

```json
{
  "**/*.ts": {
    "*>=major": "error",        // All major+ issues are errors
    "my-linter/*": "warn",      // All issues from my-linter are warnings
    "my-linter/specific": "off" // Disable specific issue
  }
}
```

### Per-Linter Configuration

Configure individual linters via the `config` field:

```json
{
  "viola": {
    "plugins": ["./my-linters.ts"],
    "config": {
      "my-linter": {
        "someOption": true,
        "threshold": 5
      }
    }
  }
}
```

### Config Presets

Plugins can provide presets. Inherit from them using `inherit`:

```json
{
  "viola": {
    "plugins": ["./my-linters.ts"],
    "inherit": ["strict"]
  }
}
```

## Writing Linters

This is a minimal linter:

```ts
import { 
  BaseLinter, 
  type CodebaseData, 
  type LinterConfig, 
  type Violation 
} from "@hiisi/viola";

class NoUnderscoreFunctions extends BaseLinter {
  readonly meta = {
    id: "no-underscore-functions",
    name: "No Underscore Functions",
    description: "Disallow function names starting with underscore",
  };

  readonly requirements = { functions: true };

  lint(data: CodebaseData, _config: LinterConfig): Violation[] {
    const violations: Violation[] = [];
    
    for (const fn of data.allFunctions) {
      if (fn.name.startsWith("_")) {
        violations.push(this.warning(
          "underscore-prefix",
          `Function "${fn.name}" starts with underscore`,
          fn.location
        ));
      }
    }
    
    return violations;
  }
}

// Export for plugin discovery
export const linters = [new NoUnderscoreFunctions()];
```

### Data Requirements

Linters declare what data they need:

```ts
readonly requirements = {
  functions: true,   // FunctionInfo[]
  types: true,       // TypeInfo[]
  strings: true,     // StringLiteral[]
  exports: true,     // ExportInfo[]
  imports: true,     // ImportInfo[]
  schemas: true,     // SchemaInfo[]
  files: true,       // FileInfo[]
};
```

### Issue Catalog

For richer issue classification:

```ts
readonly catalog = {
  "my-linter/bad-name": { 
    category: "consistency",  // correctness | maintainability | consistency | performance | style
    impact: "minor",          // critical | major | minor | trivial
    description: "Name does not follow convention"
  },
};
```

### Plugin Exports

Plugins can export:

- `linters: BaseLinter[]` - Array of linter instances (preferred)
- Individual named exports that are linters
- Default export (single linter or array)
- `bundles: Record<string, BaseLinter[]>` - Named linter collections
- `configPresets: Record<string, ViolaConfigPreset>` - Configuration presets
- `schemas: Record<string, JSONSchema>` - JSON schemas for config validation

For a complete example, see [`@hiisi/viola-default-lints`](https://jsr.io/@hiisi/viola-default-lints).

## Pattern Syntax

Severity patterns match against `linter-id/issue-code`:

| Pattern | Matches |
|---------|---------|
| `my-linter/specific` | Exact issue |
| `my-linter/*` | All issues from linter |
| `*::correctness` | All correctness issues |
| `*>=major` | Impact major or higher |
| `*=minor` | Exactly minor impact |
| `*!=trivial` | All except trivial |

**Impact operators:** `=`, `!=`, `>=`, `<=`, `>`, `<`

**Category filter:** `::category`

## API Reference

### High-Level

- `runViola(options)` - Run linters, returns `LintResults`
- `formatResults(results)` - Format for console output

### Runtime

- `crawlCodebase(config)` - Extract codebase data
- `discoverPlugins(specifiers)` - Load plugin modules
- `registerDiscoveredLinters(discovery)` - Register linters from plugins

### Registry

- `registry.register(linter)` - Register a linter
- `registry.get(id)` - Get linter by ID
- `registry.getAll()` - List all registered linters
- `runLinters(data, options)` - Run registered linters

### Types

- `BaseLinter` - Base class for linters
- `CodebaseData` - Extracted codebase structure
- `Violation` - Single lint violation
- `LintResults` - Aggregated results
- `ViolaConfig` - Configuration options

## Support

Whether you use this project, have learned something from it, or just like it,
please consider supporting it by buying me a coffee, so I can dedicate more time
on open-source projects like this :)

<a href="https://buymeacoffee.com/orgrinrt" target="_blank"><img src="https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png" alt="Buy Me A Coffee" style="height: auto !important;width: auto !important;" ></a>

## License

> You can check out the full license [here](https://github.com/hiisi-digital/viola/blob/main/LICENSE)

This project is licensed under the terms of the **Mozilla Public License 2.0**.

`SPDX-License-Identifier: MPL-2.0`
