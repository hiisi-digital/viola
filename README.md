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

## Configuration

Create a `viola.config.ts` in your project root:

```ts
import { viola } from "@hiisi/viola";
import defaultLints from "@hiisi/viola-default-lints";

export default viola()
  .use(defaultLints)  // plugin adds linters + default rules
  .rule(report.off, when.in("**/*_test.ts"));  // your overrides
```

Plugins configure the builder with linters and default rules. Your rules are always checked first (first match wins), so you can override plugin defaults.

### Full Example

```ts
import { viola, report, when, Impact, Category } from "@hiisi/viola";
import defaultLints from "@hiisi/viola-default-lints";
import { myCustomLinter } from "./lints/my-custom.ts";

export default viola()
  // Plugins (add linters + their default rules)
  .use(defaultLints)
  
  // Individual linters (no default rules)
  .add(myCustomLinter)
  
  // Linter settings
  .set("similar-functions.threshold", 0.85)
  .set("duplicate-strings", { minLength: 12, threshold: 3 })
  
  // Your rules (checked BEFORE plugin rules)
  // File-scoped rules
  .rule(report.off, when.in("**/*_test.ts"))
  .rule(report.off, when.in("**/*.spec.ts"))
  .rule(report.skip, when.in("src/generated/**"))
  
  // Category rules
  .rule(report.error, when.category.is(Category.Correctness))
  .rule(report.hint, when.category.is(Category.Style))
  
  // Combine conditions
  .rule(report.error, when.in("packages/core/**").and(when.impact.atLeast(Impact.Minor)))
  
  // Confidence filtering
  .rule(report.off, when.confidence.below(50));
```

### Without Plugin Defaults

If you want just linters without a plugin's default rules:

```ts
import { viola, report, when, Impact } from "@hiisi/viola";
import { linters } from "@hiisi/viola-default-lints";

export default viola()
  .add(linters)  // just linters, no default rules
  .rule(report.error, when.impact.atLeast(Impact.Critical))
  .rule(report.warn, when.impact.atLeast(Impact.Major))
  .rule(report.info, when.impact.is(Impact.Minor));
```

## API

### Core Imports

```ts
import { 
  viola,          // Config builder
  plugin,         // Create plugin from function
  report,         // Report level actions
  when,           // Condition builders
  Impact,         // Impact levels enum
  Category,       // Category enum
  runViola,       // Run linters
  formatResults,  // Format output
} from "@hiisi/viola";
```

### `viola()` - Config Builder

| Method | Description |
|--------|-------------|
| `.use(plugin)` | Add a plugin (linters + rules) |
| `.add(linter)` | Add a linter or array of linters |
| `.set(key, value)` | Configure a linter (`"linter.option"` or `"linter", { options }`) |
| `.rule(action, condition)` | Add a classification rule |

### `report` - Report Actions

| Action | Description |
|--------|-------------|
| `report.error` | Fails build, exits non-zero |
| `report.warn` | Yellow output, doesn't fail |
| `report.info` | Blue, informational |
| `report.hint` | Dim, subtle suggestion |
| `report.off` | Suppress, don't show |
| `report.skip` | Don't run linters at all (file-scope only) |

### `when` - Condition Builders

**By impact:**
```ts
when.impact.atLeast(Impact.Major)  // >= major
when.impact.atMost(Impact.Minor)   // <= minor
when.impact.is(Impact.Critical)    // exactly critical
when.impact.not(Impact.Trivial)    // not trivial
when.impact.above(Impact.Minor)    // > minor
when.impact.below(Impact.Major)    // < major
```

**By category:**
```ts
when.category.is(Category.Correctness)
when.category.not(Category.Style)
when.category.in(Category.Correctness, Category.Maintainability)
```

**By file pattern:**
```ts
when.in("**/*_test.ts")
when.in("src/**", "lib/**")  // multiple patterns
```

**By linter:**
```ts
when.linter("similar-functions")
when.linter("similar-*")  // glob
```

**By confidence:**
```ts
when.confidence.atLeast(80)
when.confidence.below(50)
```

**Combining conditions:**
```ts
when.in("packages/core/**").and(when.impact.atLeast(Impact.Minor))
when.category.is(Category.Style).or(when.category.is(Category.Consistency))
when.in("**/*_test.ts").not()
when.all(when.in("src/**"), when.impact.atLeast(Impact.Major))
when.any(when.in("**/*_test.ts"), when.in("**/*.spec.ts"))
```

### Enums

**Impact** (how urgent):
```ts
enum Impact {
  Critical,  // Must fix, blocks release
  Major,     // Should fix soon
  Minor,     // Fix when convenient
  Trivial,   // Nice to have
}
```

**Category** (what kind of problem):
```ts
enum Category {
  Correctness,     // Code is wrong
  Maintainability, // Harder to work with
  Consistency,     // Breaks conventions
  Performance,     // Slower than needed
  Style,           // Cosmetic
}
```

## Writing Plugins

Plugins configure the builder with linters, rules, and settings:

```ts
import { plugin, report, when, Impact, type ViolaPlugin } from "@hiisi/viola";
import { myLinter } from "./my-linter.ts";

// Object form
export const myPlugin: ViolaPlugin = {
  build(viola) {
    viola
      .add(myLinter)
      .rule(report.error, when.impact.atLeast(Impact.Major))
      .set("my-linter.threshold", 0.9);
  }
};

// Function form
export const myPlugin = plugin((viola) => {
  viola
    .add(myLinter)
    .rule(report.error, when.impact.atLeast(Impact.Major));
});
```

Plugin rules are checked AFTER user rules, so users can always override defaults.

## Writing Linters

Linters define a **catalog** of issue kinds (with category, impact, description). When they find problems, they create issues referencing those kinds.

```ts
import { BaseLinter, type CodebaseData, type Issue, type IssueCatalog } from "@hiisi/viola";

class NoUnderscoreFunctions extends BaseLinter {
  readonly meta = {
    id: "no-underscore-functions",
    name: "No Underscore Functions",
    description: "Disallow function names starting with underscore",
  };

  readonly catalog: IssueCatalog = {
    "no-underscore-functions/underscore-prefix": {
      category: "consistency",
      impact: "minor",
      description: "Function name starts with underscore",
    },
  };

  readonly requirements = { functions: true };

  lint(data: CodebaseData): Issue[] {
    return data.allFunctions
      .filter(fn => fn.name.startsWith("_"))
      .map(fn => this.issue(
        "underscore-prefix",
        fn.location,
        `Function "${fn.name}" starts with underscore`,
      ));
  }
}

export const noUnderscoreFunctions = new NoUnderscoreFunctions();
```

### Data Requirements

Declare what data your linter needs:

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

## Integration

### Deno Task

```json
{
  "tasks": {
    "lint:conventions": "deno run -A jsr:@hiisi/viola-cli",
    "build": "deno task lint:conventions && deno task compile"
  }
}
```

### Pre-commit Hook

```bash
#!/bin/sh
deno run -A jsr:@hiisi/viola-cli || exit 1
```

### CI Workflow

```yaml
- name: Convention Lint
  run: deno run -A jsr:@hiisi/viola-cli
```

## Programmatic API

```ts
import { runViola, formatResults } from "@hiisi/viola";

const results = await runViola({ projectRoot: "." });
console.log(formatResults(results));
if (results.hasErrors) Deno.exit(1);
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
