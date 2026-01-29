# `viola`

<div align="center" style="text-align: center;">

[![JSR](https://jsr.io/badges/@hiisi/viola)](https://jsr.io/@hiisi/viola)
[![GitHub Issues](https://img.shields.io/github/issues/hiisi-digital/viola.svg)](https://github.com/hiisi-digital/viola/issues)
![License](https://img.shields.io/github/license/hiisi-digital/viola?color=%23009689)

> Unified lint runtime — crawl once, lint many.

</div>

## What it does

`viola` crawls your codebase once, extracts structured data (functions, types, imports, strings),
freezes it immutably, and feeds it to multiple linters. Each linter declares what data it needs
and receives only that — no redundant file parsing, no mutable state.

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

```ts
import { runViola, formatResults, registry } from "@hiisi/viola";
```

## Built-in Linters

| Linter | Description |
|--------|-------------|
| `type-location` | Types must be in `types/` directories |
| `similar-functions` | Detect similar function names (potential duplicates) |
| `similar-types` | Detect similar type names |
| `duplicate-strings` | Find repeated string literals |
| `deprecation-check` | Find deprecated code past its removal date |

## Custom Linters

```ts
import { BaseLinter, registry } from "@hiisi/viola";

class MyLinter extends BaseLinter {
  readonly meta = {
    id: "my-linter",
    name: "My Linter",
    description: "Checks something important",
    defaultSeverity: "warning",
  };

  readonly requirements = { functions: true };

  lint(data, config) {
    const violations = [];
    // Analyze data.functions, return violations
    return violations;
  }
}

registry.register(new MyLinter());
```

## API

### High-Level

- `runViola(options)` — crawl and lint, returns `LintResults`
- `formatResults(results)` — format for console output

### Runtime

- `crawlCodebase(config)` — extract codebase data
- `DEFAULT_CONFIG` — default configuration

### Registry

- `registry.register(linter)` — register a linter
- `registry.get(id)` — get linter by ID
- `registry.getAll()` — list all linters
- `runLinters(data, options)` — run linters on data

### Built-in Linter Classes

- `TypeLocationLinter`, `SimilarFunctionsLinter`, `SimilarTypesLinter`
- `DuplicateStringsLinter`, `DeprecationCheckLinter`

### Types

- `ViolaConfig` — configuration options
- `LintResults` — lint run results
- `Violation` — single violation
- `CodebaseData` — extracted codebase structure
- `BaseLinter` — base class for custom linters

## Support

Whether you use this project, have learned something from it, or just like it,
please consider supporting it by buying me a coffee, so I can dedicate more time
on open-source projects like this :)

<a href="https://buymeacoffee.com/orgrinrt" target="_blank"><img src="https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png" alt="Buy Me A Coffee" style="height: auto !important;width: auto !important;" ></a>

## License

> You can check out the full license [here](https://github.com/hiisi-digital/viola/blob/main/LICENSE)

This project is licensed under the terms of the **Mozilla Public License 2.0**.

`SPDX-License-Identifier: MPL-2.0`
