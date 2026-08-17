# `viola`

<div align="center" style="text-align: center;">

[![JSR](https://jsr.io/badges/@hiisi/viola)](https://jsr.io/@hiisi/viola)
[![GitHub Issues](https://img.shields.io/github/issues/hiisi-digital/viola.svg)](https://github.com/hiisi-digital/viola/issues)
![License](https://img.shields.io/github/license/hiisi-digital/viola?color=%23009689)

> Language-agnostic convention linter runtime. Plugin-based, zero opinions.

</div>

## What is Viola?

Viola is a **runtime and framework** for convention linting that works with **any programming language**. It uses tree-sitter grammars to parse source code and extract structured data (functions, types, imports, strings), then runs linter plugins against that data.

Viola itself has **no built-in linters** and **no opinions**. You bring your own linters and grammars - whether that's your own custom rules, third-party plugins, or the `@hiisi/viola-default-lints` package.

### Key Features

- **Language-agnostic**: Support any language via tree-sitter grammar packages
- **Single-pass crawling**: Parse each file once, run multiple linters
- **Grammar relationships**: Configure override/supplement semantics between grammars
- **Fluent API**: Builder-pattern configuration with composable conditions
- **Plugin system**: Extend with linters, grammars, and presets

## Installation

```bash
deno add jsr:@hiisi/viola
```

## Quick Start

Create a `viola.config.ts` in your project root:

```ts
import { viola, report, when } from "@hiisi/viola";
import defaultLints from "@hiisi/viola-default-lints";
import typescript from "@hiisi/viola-grammar-ts";

export default viola()
  // Grammars (how to parse files)
  .add(typescript).as("ts")

  // Linter plugin
  .use(defaultLints)

  // Your rules (last wins!)
  .rule(report.off, when.in("**/*_test.ts"));
```

## Configuration

### The Builder API

```ts
viola()
  // Add grammars and linters
  .add(grammar).as("alias")    // Register a grammar with alias
  .add(linter)                  // Register a linter
  .add([linter1, linter2])     // Register multiple linters
  
  // Use plugins (add linters + default rules)
  .use(plugin)
  
  // Configure linter settings
  .set("linter.option", value)
  .set("linter", { option1: v1, option2: v2 })
  
  // Add rules (last wins!)
  .rule(action, condition)
  
  // Build final config
  .build()
```

### Grammar Relationships

When multiple grammars match a file, you can control how they interact:

```ts
// TypeScript completely replaces JavaScript for .ts files
.rule(grammar("ts").overrides("js"), when.in("*.ts", "*.tsx"))

// TypeScript supplements JavaScript for .js files (fills gaps)
.rule(grammar("ts").supplements("js"), when.in("*.js", "*.jsx"))
```

**Semantics:**
- **Default**: All matching grammars run in parallel, results merged
- **overrides**: Primary grammar replaces secondary entirely
- **supplements**: Primary runs first, secondary fills in gaps (elements not captured by primary)

A relationship applies only where both named grammars already match the file. The matching set comes
from each grammar's registered extensions and globs, and a relationship naming a grammar outside that
set is skipped.

### Report Actions

| Action | Description |
|--------|-------------|
| `report.error` | Fails build, exits non-zero |
| `report.warn` | Yellow output, doesn't fail |
| `report.info` | Blue, informational |
| `report.hint` | Dim, subtle suggestion |
| `report.off` | Suppress, don't show |
| `report.skip` | Don't run linters at all (file-scope) |

### Conditions (`when`)

**By file pattern:**
```ts
when.in("*.ts", "*.tsx")
when.in("**/tests/**")
when.in("src/**")
```

**By linter:**
```ts
when.linter("similar-functions")
when.linter("similar-*", "duplicate-*")
```

**By impact:**
```ts
when.impact.atLeast(Impact.Major)
when.impact.is(Impact.Critical)
when.impact.above(Impact.Minor)
when.impact.not(Impact.Trivial)
```

**By confidence:**
```ts
when.confidence.atLeast(80)
when.confidence.below(50)
when.confidence.between(50, 90)
```

**By category:**
```ts
when.category.is(Category.Consistency)
when.category.in(Category.Correctness, Category.Performance)
when.category.notIn(Category.Style)
```

**Combining conditions:**
```ts
when.in("src/**").and(when.impact.atLeast(Impact.Major))
when.category.is(Category.Style).not()
when.all(when.in("src/**"), when.impact.atLeast(Impact.Major))
when.any(when.in("**/*_test.ts"), when.in("**/*.spec.ts"))
```

### The condition-object builder

`when` above is the builder `.rule()` is written against. A second builder covers issue source and
environment, and is exported under a different name to keep the two apart:

```ts
import { whenCondition, atLeast, equals } from "@hiisi/viola";

whenCondition.issue.by("similar-functions")   // by linter ID
whenCondition.issue.impact(atLeast(Impact.Major))
whenCondition.env("CI").exists()
whenCondition.env("NODE_ENV").is(equals("production"))
```

Its conditions take comparison primitives rather than plain values:

```ts
equals(value)           // Exact equality
atLeast(min)            // >= comparison
atMost(max)             // <= comparison
lessThan(bound)         // < comparison
moreThan(bound)         // > comparison
between(min, max)       // Inclusive range
oneOf(...values)        // Match any value
noneOf(...values)       // Exclude values
contains(substring)     // String contains
startsWith(prefix)      // String prefix
endsWith(suffix)        // String suffix
matches(regex)          // Regex match
alwaysMatch()           // Always true
neverMatch()            // Always false
```

## Writing Grammars

Grammar packages provide tree-sitter queries and optional transforms:

```ts
import type { GrammarDefinition } from "@hiisi/viola/grammars";

export const typescript: GrammarDefinition = {
  meta: {
    id: "typescript",
    name: "TypeScript",
    extensions: [".ts", ".tsx", ".mts", ".cts"],
  },
  grammar: {
    source: "npm",
    package: "tree-sitter-typescript",
    wasm: "tree-sitter-typescript.wasm",
  },
  queries: {
    functions: `
      (function_declaration
        name: (identifier) @function.name
        parameters: (formal_parameters) @function.params
        body: (statement_block) @function.body)
    `,
    strings: `(string) @string.value`,
    imports: `
      (import_statement
        (import_clause (identifier) @import.name)?
        source: (string) @import.from)
    `,
  },
  transforms: {
    parseParams: parseTypeScriptParams,
    extractReturnType: extractTSReturnType,
  },
};
```

## Writing Linters

Linters receive structured data and return issues:

```ts
import { BaseLinter, type CodebaseData, type Issue } from "@hiisi/viola";

class NoUnderscoreFunctions extends BaseLinter {
  readonly meta = {
    id: "no-underscore-functions",
    name: "No Underscore Functions",
    description: "Disallow function names starting with underscore",
  };

  readonly catalog = {
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

## Writing Plugins

Plugins can add grammars, linters, and default rules:

```ts
import { plugin, report, when, Impact } from "@hiisi/viola";
import { typescript } from "./grammar.ts";
import { myLinter } from "./linter.ts";

export default plugin((viola) => {
  viola
    .add(typescript).as("ts")
    .add(myLinter)
    .rule(report.error, when.impact.atLeast(Impact.Critical))
    .set("my-linter.threshold", 0.9);
});
```

## Programmatic API

`runViola` requires a grammar registry with the grammars to parse with:

```ts
import { createGrammarRegistry, formatResults, runViola } from "@hiisi/viola";
import typescript from "@hiisi/viola-grammar-ts";

const grammarRegistry = createGrammarRegistry();
grammarRegistry.add(typescript);

const results = await runViola({ projectRoot: ".", grammarRegistry });
console.log(formatResults(results));
if (results.hasErrors) Deno.exit(1);
```

## Rule Evaluation

Rules use **"last wins"** semantics (like CSS):

```ts
viola()
  .rule(report.warn, when.impact.atLeast(Impact.Minor))         // base
  .rule(report.off, when.in("**/*_test.ts"))                    // override for tests
  .rule(report.error, when.in("packages/core/**"))              // override for core
```

For an issue in `packages/core/utils_test.ts`:
1. First rule matches → warn
2. Second rule matches → off
3. Third rule matches → error

**Result: error** (last matching rule wins)

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

## Architecture

Viola runs a single tree-sitter engine (WASM) at its core. Grammar packages supply the tree-sitter queries for each language. The crawler parses every matched file once, runs each matching grammar's queries, and merges the captures into one `CodebaseData` structure (functions, types, imports, exports, strings). Linters then run against that shared data, so adding a linter never adds another parse pass.

## Support

Whether you use this project, have learned something from it, or just like it,
please consider supporting it by buying me a coffee, so I can dedicate more time
on open-source projects like this :)

<a href="https://buymeacoffee.com/orgrinrt" target="_blank"><img src="https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png" alt="Buy Me A Coffee" style="height: auto !important;width: auto !important;" ></a>

## License

> You can check out the full license [here](https://github.com/hiisi-digital/viola/blob/main/LICENSE)

This project is licensed under the terms of the **Mozilla Public License 2.0**.

`SPDX-License-Identifier: MPL-2.0`
