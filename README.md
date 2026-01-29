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
runs multiple checkers against it. Each checker declares what data it needs and gets only that.

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

## Built-in Checkers

| Checker | Description |
|---------|-------------|
| `type-location` | Types must be in `types/` directories |
| `similar-functions` | Detect similar function names |
| `similar-types` | Detect similar type names |
| `duplicate-strings` | Find repeated string literals |
| `deprecation-check` | Find deprecated code past its removal date |

## Custom Checkers

```ts
import { BaseLinter, registry } from "@hiisi/viola";

class MyChecker extends BaseLinter {
  readonly meta = {
    id: "my-checker",
    name: "My Checker",
    description: "Checks naming conventions",
    defaultSeverity: "warning",
  };

  readonly requirements = { functions: true };

  lint(data, config) {
    const issues = [];
    // Analyze data.functions, return issues
    return issues;
  }
}

registry.register(new MyChecker());
```

## API

### High-Level

- `runViola(options)` — Crawl and check, returns `LintResults`
- `formatResults(results)` — Format for console output

### Runtime

- `crawlCodebase(config)` — Extract codebase data
- `DEFAULT_CONFIG` — Default configuration

### Registry

- `registry.register(checker)` — Register a checker
- `registry.get(id)` — Get checker by ID
- `registry.getAll()` — List all checkers
- `runLinters(data, options)` — Run checkers on data

### Built-in Checker Classes

- `TypeLocationLinter`, `SimilarFunctionsLinter`, `SimilarTypesLinter`
- `DuplicateStringsLinter`, `DeprecationCheckLinter`

### Types

- `ViolaConfig` — Configuration options
- `LintResults` — Check results
- `Violation` — Single convention violation
- `CodebaseData` — Extracted codebase structure
- `BaseLinter` — Base class for custom checkers

## Support

Whether you use this project, have learned something from it, or just like it,
please consider supporting it by buying me a coffee, so I can dedicate more time
on open-source projects like this :)

<a href="https://buymeacoffee.com/orgrinrt" target="_blank"><img src="https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png" alt="Buy Me A Coffee" style="height: auto !important;width: auto !important;" ></a>

## License

> You can check out the full license [here](https://github.com/hiisi-digital/viola/blob/main/LICENSE)

This project is licensed under the terms of the **Mozilla Public License 2.0**.

`SPDX-License-Identifier: MPL-2.0`
