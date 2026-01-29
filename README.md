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
});

console.log(formatResults(results));

if (results.hasErrors) Deno.exit(1);
```

## Installation

```bash
deno add jsr:@hiisi/viola
```

## Configuration

Configure via `deno.json` under the `viola` field. Config is scoped by file patterns:

```json
{
  "viola": {
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

## Built-in Linters

| Linter | Description |
|------|-------------|
| `type-location` | Types must be in `types/` directories |
| `similar-functions` | Detect similar function names |
| `similar-types` | Detect similar type names |
| `duplicate-strings` | Find repeated string literals |
| `deprecation` | Find deprecated code past its removal date |

## Custom Linters

```ts
import { BaseLinter, registry } from "@hiisi/viola";

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
    "my-linter/very-bad-name": { 
      category: "consistency", 
      impact: "major",
      description: "Name is confusing or misleading"
    },
  };

  readonly requirements = { functions: true };

  lint(data, config) {
    const issues = [];
    // Analyze data.functions, emit issues with kind from catalog
    return issues;
  }
}

registry.register(new MyLinter());
```

## API

### High-Level

- `runViola(options)` — Crawl and check, returns `LintResults`
- `formatResults(results)` — Format for console output

### Runtime

- `crawlCodebase(config)` — Extract codebase data
- `DEFAULT_CONFIG` — Default configuration

### Registry

- `registry.register(linter)` — Register a linter
- `registry.get(id)` — Get linter by ID
- `registry.getAll()` — List all linters
- `runLinters(data, options)` — Run linters on data

### Types

- `ViolaConfig` — Configuration options
- `LintResults` — Check results
- `Issue` — Single convention violation with category, impact, confidence
- `CodebaseData` — Extracted codebase structure
- `BaseLinter` — Base class for custom linters

## Support

Whether you use this project, have learned something from it, or just like it,
please consider supporting it by buying me a coffee, so I can dedicate more time
on open-source projects like this :)

<a href="https://buymeacoffee.com/orgrinrt" target="_blank"><img src="https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png" alt="Buy Me A Coffee" style="height: auto !important;width: auto !important;" ></a>

## License

> You can check out the full license [here](https://github.com/hiisi-digital/viola/blob/main/LICENSE)

This project is licensed under the terms of the **Mozilla Public License 2.0**.

`SPDX-License-Identifier: MPL-2.0`
