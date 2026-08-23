# Viola Language-Agnostic Architecture

> Design document for making viola truly language-agnostic through a single
> tree-sitter core with pluggable grammar definitions.

## Builder API Design

This section documents the unified builder API for configuring viola. The API is
designed to be:

- **Fluent** - chains naturally, reads like English
- **Consistent** - same patterns used throughout
- **Discoverable** - IDE autocompletion guides usage
- **Composable** - small pieces combine into complex configurations

### Core Pattern: `.add()` and `.rule()`

Everything in viola follows two core patterns:

```ts
// Register things
.add(kind, thing).as(alias)

// Define behavior
.rule(action, condition)
```

### Adding Grammars and Linters

```ts
import { grammar, linter, report, viola, when } from "@hiisi/viola";
import typescript from "@hiisi/viola-grammar-ts";
import javascript from "@hiisi/viola-grammar-js";
import bash from "@hiisi/viola-grammar-bash";
import similarFunctions from "@hiisi/viola-lint-similar-functions";
import duplicateStrings from "@hiisi/viola-lint-duplicate-strings";

viola()
  // Add grammars with aliases for use in rules below
  .add(grammar, typescript).as(ts)
  .add(grammar, javascript).as(js)
  .add(grammar, bash) // no alias - referenced by import name 'bash'
  // Add linters
  .add(linter, similarFunctions)
  .add(linter, duplicateStrings).as(dupes);
```

The `.as(alias)` is optional. Without it, the thing is referenced by its import
identifier.

### Grammar Relationship Rules

Grammars can have relationships that control how they interact when multiple
grammars match the same file.

#### Parallel (Default)

By default, all matching grammars run in parallel and all results are merged:

```ts
viola()
  .add(grammar, typescript).as(ts)
  .add(grammar, javascript).as(js);
// Both run for .tsx files if both match, results merged
```

#### Supplements (Fallback)

One grammar supplements another - both run, but the supplementary grammar only
contributes where the primary didn't capture:

```ts
viola()
  .add(grammar, typescript).as(ts)
  .add(grammar, javascript).as(js)
  // JS fills gaps where TS didn't capture anything
  // Use case: TS grammar might miss some JS-only patterns
  .rule(grammar(ts).supplements(js), when.in("*.ts", "*.tsx"));
```

#### Overrides

One grammar completely replaces another for matching files - only the overriding
grammar runs:

```ts
viola()
  .add(grammar, typescript).as(ts)
  .add(grammar, javascript).as(js)
  .add(grammar, cpp).as(cpp)
  .add(grammar, c).as(c)
  // TS overrides JS for .js files (only TS runs)
  .rule(grammar(ts).overrides(js), when.in("*.js"))
  // C overrides C++ for header files
  .rule(grammar(c).overrides(cpp), when.in("*.h"));
```

### Condition API: `when.*`

The `when` API provides a consistent way to express conditions. Conditions are
namespaced by what they operate on.

#### Path Matching: `when.in()`

```ts
// Match by glob patterns
when.in("*.ts", "*.tsx"); // files with these extensions
when.in("**/test/**"); // files in test directories
when.in("**/test/**/*.spec.ts"); // combined pattern
when.in("src/**", "lib/**"); // multiple patterns (OR)
```

#### Issue Properties: `when.issue.*`

```ts
// Who reported the issue
when.issue.by(similarFunctions);
when.issue.by(duplicateStrings);

// Issue kind/type
when.issue.kind("duplicate");
when.issue.kind("missing-docs");

// Impact and confidence (see Comparison Primitives below)
when.issue.impact(atLeast(Impact.Major));
when.issue.confidence(atLeast(80));
```

#### Environment: `when.env()`

```ts
// Check if env var exists
when.env("CI").exists();

// Check env var value (see Comparison Primitives below)
when.env("NODE_ENV").is(equals("production"));
when.env("LOG_LEVEL").is(oneOf("debug", "trace"));
when.env("TIMEOUT").is(atLeast(30));
```

### Comparison Primitives

A unified set of comparison functions that work with any comparable value -
numbers, strings, or enums with ordering.

```ts
import {
  atLeast,
  atMost,
  between,
  equals,
  lessThan,
  moreThan,
  oneOf,
} from "@hiisi/viola";

// Numeric comparisons
when.issue.confidence(atLeast(80));
when.issue.confidence(between(50, 90));
when.issue.confidence(lessThan(100));

// Enum comparisons (enums have natural ordering)
when.issue.impact(atLeast(Impact.Major));
when.issue.impact(lessThan(Impact.Critical));
when.issue.impact(oneOf(Impact.Minor, Impact.Major));

// String equality
when.env("NODE_ENV").is(equals("production"));
when.env("LOG_LEVEL").is(oneOf("debug", "trace", "info"));

// Numeric env vars
when.env("TIMEOUT").is(atLeast(30));
when.env("MAX_RETRIES").is(between(1, 10));
```

#### Composing Comparators

Comparators can be composed with `.or()` and `.and()` for the same field:

```ts
// Same field, multiple conditions
when.env("FOO").is(atLeast(2).or(equals("production")));
when.issue.impact(atLeast(Impact.Minor).and(lessThan(Impact.Critical)));
when.issue.confidence(atLeast(50).and(atMost(90))); // same as between(50, 90)
```

### Composing Conditions

Different conditions compose with `.and()`:

```ts
// Different fields compose at the when level
when.issue.by(similarFunctions).and(when.in("**/test/**"));
when.env("CI").exists().and(when.issue.confidence(atLeast(90)));
when.in("src/**").and(when.issue.impact(atLeast(Impact.Major)));
```

### Report Actions

```ts
import { report } from "@hiisi/viola";

report.error; // fail the build
report.warn; // warning, don't fail
report.off; // suppress entirely
report.info; // informational only
```

### Complete Example

```ts
import { grammar, linter, report, viola, when } from "@hiisi/viola";
import { atLeast, equals, oneOf } from "@hiisi/viola";
import typescript from "@hiisi/viola-grammar-ts";
import javascript from "@hiisi/viola-grammar-js";
import bash from "@hiisi/viola-grammar-bash";
import similarFunctions from "@hiisi/viola-lint-similar-functions";
import duplicateStrings from "@hiisi/viola-lint-duplicate-strings";
import missingDocs from "@hiisi/viola-lint-missing-docs";

export default viola()
  // Register grammars
  .add(grammar, typescript).as(ts)
  .add(grammar, javascript).as(js)
  .add(grammar, bash)
  // Register linters
  .add(linter, similarFunctions)
  .add(linter, duplicateStrings)
  .add(linter, missingDocs)
  // Grammar relationships
  .rule(grammar(ts).supplements(js), when.in("*.ts", "*.tsx"))
  .rule(grammar(ts).overrides(js), when.in("*.js"))
  // Severity rules
  .rule(report.error, when.issue.impact(atLeast(Impact.Major)))
  .rule(report.warn, when.issue.impact(atLeast(Impact.Minor)))
  // Per-linter rules
  .rule(report.off, when.issue.by(missingDocs).and(when.in("**/test/**")))
  .rule(
    report.error,
    when.issue.by(similarFunctions).and(when.issue.confidence(atLeast(90))),
  )
  // Path-based rules
  .rule(report.off, when.in("**/vendor/**", "**/generated/**"))
  .rule(report.warn, when.in("**/deprecated/**"))
  // Environment-based rules
  .rule(
    report.error,
    when.env("CI").exists().and(when.issue.impact(atLeast(Impact.Minor))),
  )
  .rule(report.off, when.env("VIOLA_STRICT").is(equals("false")));
```

### API Summary

| Pattern                      | Purpose                  | Example                                               |
| ---------------------------- | ------------------------ | ----------------------------------------------------- |
| `.add(kind, thing)`          | Register grammar/linter  | `.add(grammar, typescript)`                           |
| `.as(alias)`                 | Give it a reference name | `.add(grammar, typescript).as(ts)`                    |
| `.rule(action, condition)`   | Define behavior          | `.rule(report.error, when.in("src/**"))`              |
| `grammar(x).overrides(y)`    | x replaces y             | `.rule(grammar(ts).overrides(js), when.in("*.js"))`   |
| `grammar(x).supplements(y)`  | x fills gaps in y        | `.rule(grammar(ts).supplements(js), when.in("*.ts"))` |
| `when.in(...)`               | Path patterns            | `when.in("**/test/**")`                               |
| `when.issue.by(x)`           | Issues from x            | `when.issue.by(similarFunctions)`                     |
| `when.issue.impact(cmp)`     | Impact comparison        | `when.issue.impact(atLeast(Impact.Major))`            |
| `when.issue.confidence(cmp)` | Confidence comparison    | `when.issue.confidence(atLeast(80))`                  |
| `when.env(x).exists()`       | Env var exists           | `when.env("CI").exists()`                             |
| `when.env(x).is(cmp)`        | Env var comparison       | `when.env("NODE_ENV").is(equals("prod"))`             |
| `cond.and(cond)`             | Compose conditions       | `when.in("src/**").and(when.issue.impact(...))`       |
| `cmp.or(cmp)`                | Compose comparators      | `atLeast(5).or(equals("default"))`                    |

---

## Current State

Viola currently has a hardcoded TypeScript/JavaScript crawler in
`src/runtime/crawler.ts` using regex patterns. This limits viola to only linting
TypeScript codebases and duplicates parsing logic that tree-sitter already
handles better.

## Goal

Make viola a **language-agnostic linter runtime** where:

1. **Single tree-sitter engine** in core - one parser, many grammars
2. **Grammars are pluggable** - each grammar provides tree-sitter queries for
   extraction
3. **Single-pass crawl** - parse each file once, dispatch to matching
   grammars/linters
4. **Linters work on abstract data** - `FunctionInfo`, `StringLiteral`, etc. are
   language-neutral

## Architecture

### Runtime Behavior: Grammar Resolution

When processing a file, the runtime:

1. **Find matching grammars** - all grammars whose patterns match the file
2. **Apply relationship rules** - process `overrides` and `supplements` rules
3. **Run grammars** - execute according to relationships:
   - **Parallel (default)**: all run, all results merged
   - **Supplements**: both run, supplementary only contributes where primary
     didn't capture
   - **Overrides**: only the overriding grammar runs (last rule wins)
4. **Merge results** - combine extractions into unified `FileInfo`

#### Example Resolution

```ts
// Config
.add(grammar, typescript).as(ts)
.add(grammar, javascript).as(js)
.rule(grammar(ts).overrides(js), when.in("*.js"))
.rule(grammar(ts).supplements(js), when.in("*.ts"))
```

| File        | Matching Grammars | Rule Applied      | What Runs              |
| ----------- | ----------------- | ----------------- | ---------------------- |
| `foo.ts`    | ts, js            | ts supplements js | Both; js fills ts gaps |
| `bar.js`    | ts, js            | ts overrides js   | Only ts                |
| `baz.tsx`   | ts                | (none)            | ts                     |
| `script.sh` | bash              | (none)            | bash                   |

### Package Structure

```
@hiisi/viola                 # Core runtime with tree-sitter engine
@hiisi/viola-grammar-ts      # TypeScript/JavaScript grammar definition
@hiisi/viola-grammar-bash    # Bash/Shell grammar definition
@hiisi/viola-grammar-python  # Python grammar definition (future)
@hiisi/viola-default-lints   # Language-agnostic linters
```

### Core Engine

Viola core bundles `web-tree-sitter` and provides:

1. **Grammar loading** - lazy-loads grammar WASM files on demand
2. **Query execution** - runs extraction queries against parsed trees
3. **Generic extraction** - transforms query captures into `FileInfo` structures
4. **Single-pass dispatch** - for each file, finds matching grammars and linters

```
┌─────────────────────────────────────────────────────────────────┐
│                        viola core                                │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  web-tree-sitter │  │ Grammar Loader  │  │ Query Executor  │  │
│  │     engine       │  │  (lazy WASM)    │  │ (S-expressions) │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│                              │                      │            │
│                              ▼                      ▼            │
│                    ┌─────────────────────────────────────┐      │
│                    │     Generic Extraction Engine        │      │
│                    │  (captures → FunctionInfo, etc.)     │      │
│                    └─────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
                                    │
            ┌───────────────────────┼───────────────────────┐
            ▼                       ▼                       ▼
   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
   │ viola-grammar-ts │    │viola-grammar-bash│    │viola-grammar-py │
   │ queries + ref    │    │ queries + ref    │    │ queries + ref   │
   └─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Grammar Definition Type

A grammar definition is primarily **data** - queries and metadata, with optional
transform callbacks for complex cases.

```ts
// src/grammars/types.ts

/**
 * Metadata about a grammar.
 */
export interface GrammarMeta {
  /** Unique identifier (e.g., "ts", "bash", "python") */
  id: string;
  /** Human-readable name */
  name: string;
  /** File extensions this grammar handles */
  extensions: readonly string[];
  /** Glob patterns for additional matching (e.g., "Makefile", ".bashrc") */
  globs?: readonly string[];
  /** Optional description */
  description?: string;
}

/**
 * Reference to a tree-sitter grammar WASM file.
 */
export interface GrammarSource {
  /** How to load the grammar */
  source: "npm" | "url" | "bundled";
  /** npm package name (if source is "npm") */
  package?: string;
  /** Path to .wasm within the package */
  wasm?: string;
  /** Direct URL to .wasm (if source is "url") */
  url?: string;
}

/**
 * Standard capture names used in extraction queries.
 *
 * Queries MUST use these capture names for the core to extract data correctly.
 */
export type StandardCaptures = {
  // Function captures
  "function.name": string;
  "function.params": string;
  "function.body": string;
  "function.return"?: string;
  "function.async"?: boolean; // via predicate
  "function.generator"?: boolean; // via predicate
  "function.export"?: boolean; // via predicate

  // String captures
  "string.value": string;
  "string.raw"?: boolean;
  "string.template"?: boolean;

  // Import captures
  "import.name": string;
  "import.from": string;
  "import.type_only"?: boolean;
  "import.namespace"?: boolean;

  // Export captures
  "export.name": string;
  "export.kind"?: string;
  "export.from"?: string;
  "export.type_only"?: boolean;

  // Type captures
  "type.name": string;
  "type.body": string;
  "type.kind"?: string; // "interface" | "type" | "class"
  "type.extends"?: string;

  // Doc comment captures
  "doc.content": string;
  "doc.target"?: string; // What the doc is attached to
};

/**
 * Tree-sitter queries for extracting code elements.
 *
 * Each query is an S-expression string that produces captures
 * following the StandardCaptures naming convention.
 */
export interface ExtractionQueries {
  /** Query for function/method definitions */
  functions: string;
  /** Query for string literals */
  strings?: string;
  /** Query for import statements */
  imports?: string;
  /** Query for export statements */
  exports?: string;
  /** Query for type/interface definitions */
  types?: string;
  /** Query for documentation comments */
  docComments?: string;
}

/**
 * Optional transform callbacks for language-specific extraction logic.
 *
 * These are only needed when queries alone can't capture the semantics.
 * Most languages won't need most of these.
 */
export interface GrammarTransforms {
  /**
   * Parse function parameters from the captured params node.
   * Needed for languages with complex parameter syntax.
   */
  parseParams?: (paramsNode: SyntaxNode, source: string) => FunctionParam[];

  /**
   * Extract the return type from captures or node analysis.
   * Needed when return type syntax varies significantly.
   */
  extractReturnType?: (
    node: SyntaxNode,
    captures: QueryCaptures,
  ) => string | undefined;

  /**
   * Normalize function body for similarity comparison.
   * Default: strip whitespace and comments.
   */
  normalizeBody?: (body: string, language: string) => string;

  /**
   * Determine if a function is async from context.
   * Needed when async-ness can't be captured via query predicates.
   */
  isAsync?: (node: SyntaxNode, captures: QueryCaptures) => boolean;

  /**
   * Determine if something is exported.
   * Needed for languages with complex export semantics.
   */
  isExported?: (node: SyntaxNode, captures: QueryCaptures) => boolean;

  /**
   * Parse import details from captured nodes.
   * Needed for languages with complex import syntax.
   */
  parseImport?: (
    node: SyntaxNode,
    captures: QueryCaptures,
    source: string,
  ) => ImportInfo | ImportInfo[];

  /**
   * Parse export details from captured nodes.
   */
  parseExport?: (
    node: SyntaxNode,
    captures: QueryCaptures,
    source: string,
  ) => ExportInfo | ExportInfo[];

  /**
   * Parse type/interface fields from body.
   * Needed for extracting field information from type bodies.
   */
  parseTypeFields?: (bodyNode: SyntaxNode, source: string) => TypeField[];

  /**
   * Extract doc comment content and clean it up.
   */
  parseDocComment?: (node: SyntaxNode, source: string) => string;

  /**
   * Determine string quote style from node.
   */
  getQuoteStyle?: (
    node: SyntaxNode,
  ) => "single" | "double" | "backtick" | "raw";
}

/**
 * A grammar definition provides everything needed to extract
 * structured data from files of a particular language.
 */
export interface GrammarDefinition {
  /** Grammar metadata */
  readonly meta: GrammarMeta;

  /** Reference to the tree-sitter grammar WASM */
  readonly grammar: GrammarSource;

  /** Extraction queries using standard capture names */
  readonly queries: ExtractionQueries;

  /** Optional transforms for complex extraction logic */
  readonly transforms?: GrammarTransforms;
}
```

### Standard Capture Names

All grammars use the same capture names so the core extraction engine can work
uniformly:

| Capture            | Description            | Used In                               |
| ------------------ | ---------------------- | ------------------------------------- |
| `@function.name`   | Function/method name   | `FunctionInfo.name`                   |
| `@function.params` | Parameter list node    | `FunctionInfo.params` (via transform) |
| `@function.body`   | Function body          | `FunctionInfo.body`                   |
| `@function.return` | Return type annotation | `FunctionInfo.returnType`             |
| `@string.value`    | String literal content | `StringLiteral.value`                 |
| `@import.name`     | Imported identifier    | `ImportInfo.name`                     |
| `@import.from`     | Module specifier       | `ImportInfo.from`                     |
| `@export.name`     | Exported identifier    | `ExportInfo.name`                     |
| `@type.name`       | Type/interface name    | `TypeInfo.name`                       |
| `@type.body`       | Type definition body   | `TypeInfo.body`                       |
| `@doc.content`     | Documentation comment  | `*.jsDoc`                             |

### Single-Pass Crawl Architecture

The runtime crawls the codebase **once**, dispatching to matching grammars and
linters as it goes:

```ts
async function crawl(config: CrawlConfig): Promise<CodebaseData> {
  const files: FileInfo[] = [];

  for await (const entry of walkDirectory(config.projectRoot)) {
    // Skip excluded paths
    if (matchesExclude(entry.path, config.exclude)) continue;

    // Find matching grammars for this file
    const matchingGrammars = config.grammars.filter((g) =>
      matchesGrammar(entry.path, g.meta)
    );

    if (matchingGrammars.length === 0) continue;

    // Read file once
    const content = await readFile(entry.path);

    // Parse with each matching grammar and merge results
    // (Usually only one grammar matches, but could have overlapping extensions)
    const fileInfo = await extractFileInfo(
      entry.path,
      content,
      matchingGrammars,
    );

    files.push(fileInfo);
  }

  return buildCodebaseData(config.projectRoot, files);
}

async function extractFileInfo(
  path: string,
  content: string,
  grammars: GrammarDefinition[],
): Promise<FileInfo> {
  // Use first matching grammar (grammars are registered in priority order)
  const grammar = grammars[0];

  // Load grammar WASM if not already loaded
  const language = await loadGrammar(grammar);

  // Parse the file
  const tree = parser.parse(content, { language });

  // Run extraction queries
  const functions = runQuery(
    tree,
    grammar.queries.functions,
    grammar.transforms,
    content,
  );
  const strings = grammar.queries.strings
    ? runQuery(tree, grammar.queries.strings, grammar.transforms, content)
    : [];
  // ... etc

  return {
    path,
    extension: extname(path),
    lineCount: content.split("\n").length,
    functions,
    types,
    strings,
    exports,
    imports,
  };
}
```

### Builder API

```ts
import { report, viola, when } from "@hiisi/viola";
import typescript from "@hiisi/viola-grammar-ts";
import bash from "@hiisi/viola-grammar-bash";
import defaultLints from "@hiisi/viola-default-lints";

export default viola()
  .grammar(typescript) // Register TypeScript grammar
  .grammar(bash) // Register Bash grammar
  .use(defaultLints) // Add default linters
  .add(customLinter) // Add custom linter
  .rule(report.error, when.impact.atLeast(Impact.Major))
  .rule(report.off, when.in("**/test/**"));
```

## Grammar Examples

### TypeScript Grammar

```ts
// @hiisi/viola-grammar-ts/mod.ts

import type { GrammarDefinition } from "@hiisi/viola";

export const typescript: GrammarDefinition = {
  meta: {
    id: "ts",
    name: "TypeScript",
    extensions: [".ts", ".tsx", ".mts", ".cts"],
    description: "TypeScript and TSX files",
  },

  grammar: {
    source: "npm",
    package: "tree-sitter-typescript",
    wasm: "tree-sitter-typescript.wasm",
  },

  queries: {
    functions: `
      ; Regular function declarations
      (function_declaration
        name: (identifier) @function.name
        parameters: (formal_parameters) @function.params
        return_type: (type_annotation type: (_) @function.return)?
        body: (statement_block) @function.body) @function
      
      ; Arrow functions assigned to variables
      (lexical_declaration
        (variable_declarator
          name: (identifier) @function.name
          value: (arrow_function
            parameters: (formal_parameters) @function.params
            return_type: (type_annotation type: (_) @function.return)?
            body: (_) @function.body))) @function
      
      ; Method definitions
      (method_definition
        name: (property_identifier) @function.name
        parameters: (formal_parameters) @function.params
        return_type: (type_annotation type: (_) @function.return)?
        body: (statement_block) @function.body) @function
    `,

    strings: `
      (string) @string.value
      (template_string) @string.value @string.template
    `,

    imports: `
      (import_statement
        (import_clause
          (identifier) @import.name)?
        (import_clause
          (named_imports
            (import_specifier
              name: (identifier) @import.name)))?
        source: (string) @import.from)
    `,

    exports: `
      (export_statement
        (identifier) @export.name)
      (export_statement
        declaration: (lexical_declaration
          (variable_declarator
            name: (identifier) @export.name)))
    `,

    types: `
      (interface_declaration
        name: (type_identifier) @type.name
        body: (object_type) @type.body) @type
      
      (type_alias_declaration
        name: (type_identifier) @type.name
        value: (_) @type.body) @type
    `,

    docComments: `
      (comment) @doc.content
      (#match? @doc.content "^/\\\\*\\\\*")
    `,
  },

  transforms: {
    parseParams: parseTypeScriptParams,
    parseTypeFields: parseTypeScriptFields,
    isAsync: (node) => node.childForFieldName("async") !== null,
    isExported: (node, captures) => {
      // Check if parent is export_statement
      return node.parent?.type === "export_statement";
    },
  },
};

export default typescript;
```

### Bash Grammar

```ts
// @hiisi/viola-grammar-bash/mod.ts

import type { GrammarDefinition } from "@hiisi/viola";

export const bash: GrammarDefinition = {
  meta: {
    id: "bash",
    name: "Bash/Shell",
    extensions: [".sh", ".bash"],
    globs: [".bashrc", ".bash_profile", ".profile", "Makefile"],
    description: "Bash and shell scripts",
  },

  grammar: {
    source: "npm",
    package: "tree-sitter-bash",
    wasm: "tree-sitter-bash.wasm",
  },

  queries: {
    functions: `
      ; function name() { body }
      (function_definition
        name: (word) @function.name
        body: (compound_statement) @function.body) @function
    `,

    strings: `
      (string) @string.value
      (raw_string) @string.value @string.raw
      (ansii_c_string) @string.value
    `,

    imports: `
      ; source "file.sh" or . "file.sh"
      (command
        name: (command_name) @_cmd
        argument: [(string) (word)] @import.from
        (#any-of? @_cmd "source" "."))
    `,

    exports: `
      ; export VAR=value
      (declaration_command
        (variable_assignment
          name: (variable_name) @export.name))
      
      ; export -f function_name
      (command
        name: (command_name) @_cmd
        argument: (word) @export.name
        (#eq? @_cmd "export"))
    `,

    // Bash doesn't have types
    types: undefined,

    docComments: `
      ; Comments immediately before function definitions
      (comment) @doc.content
    `,
  },

  transforms: {
    parseParams: extractBashPositionalParams,
    normalizeBody: normalizeBashBody,
  },
};

export default bash;
```

## Required Transforms by Language

Some extraction logic can't be expressed purely in tree-sitter queries. Here's
what each language needs:

### TypeScript/JavaScript

| Transform           | Why Needed                                                                             |
| ------------------- | -------------------------------------------------------------------------------------- |
| `parseParams`       | Complex destructuring (`{a, b}: Props`), default values, rest params, type annotations |
| `parseTypeFields`   | Extract field names, types, optionality from interface/type bodies                     |
| `isAsync`           | Can use query predicate, but transform is cleaner for edge cases                       |
| `isExported`        | Need to check parent node for `export` keyword                                         |
| `parseImport`       | Named imports, default imports, namespace imports, re-exports                          |
| `parseExport`       | Re-exports, export lists, default exports                                              |
| `extractReturnType` | Type annotations can be complex (unions, generics)                                     |
| `parseDocComment`   | Strip `/**` `*/` markers, parse `@param`, `@returns` tags                              |

### Bash

| Transform         | Why Needed                                                      |
| ----------------- | --------------------------------------------------------------- |
| `parseParams`     | Extract `$1`, `$2`, `${1}`, `$@`, `$*` usage from function body |
| `normalizeBody`   | Normalize here-docs, handle different quoting styles            |
| `parseDocComment` | Extract comment blocks before functions                         |
| `isExported`      | Check for `export -f` or if function is in global scope         |

### Python (Future)

| Transform         | Why Needed                                           |
| ----------------- | ---------------------------------------------------- |
| `parseParams`     | Default values, `*args`, `**kwargs`, type hints      |
| `parseTypeFields` | Dataclass fields, TypedDict fields                   |
| `isAsync`         | `async def` vs `def`                                 |
| `parseImport`     | `from x import y`, `import x as y`, relative imports |
| `parseDocComment` | Docstrings (triple-quoted strings after definition)  |

### Languages That Need Minimal Transforms

Some languages have simpler syntax and need fewer transforms:

- **Go**: Parameters are explicit, types are explicit, minimal transform needs
- **Rust**: Parameters explicit, but need transforms for lifetimes, generics
- **C**: Simple parameter syntax, but need transforms for pointer types

## Extraction Without Transforms

For captures that don't need transforms, the core extraction engine handles them
directly:

```ts
function extractFunctionFromCaptures(
  captures: QueryCaptures,
  source: string,
  transforms?: GrammarTransforms,
): FunctionInfo {
  const nameCapture = captures.get("function.name");
  const bodyCapture = captures.get("function.body");
  const paramsCapture = captures.get("function.params");
  const returnCapture = captures.get("function.return");

  // Direct extraction (no transform needed)
  const name = nameCapture ? getNodeText(nameCapture.node, source) : "";
  const body = bodyCapture ? getNodeText(bodyCapture.node, source) : "";
  const returnType = returnCapture
    ? getNodeText(returnCapture.node, source)
    : undefined;

  // Transform-based extraction (language-specific)
  const params = transforms?.parseParams
    ? transforms.parseParams(paramsCapture?.node, source)
    : extractSimpleParams(paramsCapture?.node, source);

  const normalizedBody = transforms?.normalizeBody
    ? transforms.normalizeBody(body, grammar.meta.id)
    : defaultNormalizeBody(body);

  return {
    name,
    location: nodeToLocation(nameCapture?.node ?? bodyCapture?.node),
    params,
    returnType,
    body,
    normalizedBody,
    bodyHash: hashCode(normalizedBody),
    isAsync: transforms?.isAsync?.(captures) ?? false,
    isGenerator: false, // From query predicate or transform
    isExported: transforms?.isExported?.(captures) ?? false,
    isDefaultExport: false,
    kind: "function",
  };
}
```

## File Matching

Grammars match files by extension and/or glob patterns:

```ts
function matchesGrammar(filePath: string, meta: GrammarMeta): boolean {
  const ext = extname(filePath);
  const basename = basename(filePath);

  // Check extension match
  if (meta.extensions.includes(ext)) return true;

  // Check glob patterns (for files like Makefile, .bashrc)
  if (meta.globs) {
    for (const glob of meta.globs) {
      if (minimatch(basename, glob) || minimatch(filePath, glob)) {
        return true;
      }
    }
  }

  return false;
}
```

## Grammar Priority

When multiple grammars could match a file, the first registered grammar wins:

```ts
viola()
  .grammar(typescript) // Priority 1
  .grammar(javascript) // Priority 2 (won't match .ts files)
  .grammar(bash); // Priority 3
```

This allows users to override default behavior by registering their grammar
first.

## Migration Path

### Phase 1: Add Tree-Sitter Core

1. Add `web-tree-sitter` dependency to viola
2. Create `GrammarDefinition` type and related types
3. Create grammar loader (lazy WASM loading)
4. Create generic extraction engine with standard captures

### Phase 2: Create TypeScript Grammar Package

1. Create `@hiisi/viola-grammar-ts` package
2. Write extraction queries for TS/JS
3. Implement required transforms (parseParams, parseTypeFields, etc.)
4. Test against existing viola test fixtures

### Phase 3: Create Bash Grammar Package

1. Create `@hiisi/viola-grammar-bash` package
2. Write extraction queries for bash
3. Implement required transforms (parseParams for positional args)
4. Add bash-specific test fixtures

### Phase 4: Update Builder and Runtime

1. Add `.grammar()` method to builder
2. Update `runViola` to use grammar-based extraction
3. Deprecate old hardcoded crawler
4. Update documentation

### Phase 5: Nutshell Integration

1. Create `viola.config.ts` for nutshell
2. Bundle viola with bash grammar
3. Replace `check` script with viola invocation

## Benefits Over Separate Crawlers

| Aspect           | Separate Crawlers                 | Single Tree-Sitter Core              |
| ---------------- | --------------------------------- | ------------------------------------ |
| Code duplication | Each crawler has its own parsing  | One parsing engine                   |
| Adding languages | Write TypeScript code             | Write queries (data)                 |
| Bundle size      | Multiple parsers                  | One engine + grammar WASMs           |
| Consistency      | Each crawler extracts differently | Standard captures ensure consistency |
| Testing          | Test each crawler separately      | Test queries in isolation            |
| Maintenance      | Update multiple packages          | Update queries only                  |

## Open Questions

1. **Grammar WASM bundling** - Should grammars bundle their WASM, or should
   viola core bundle common ones?

2. **Query inheritance** - Should grammars be able to extend other grammars'
   queries? (e.g., TSX extends TS)

3. **Multiple grammars per file** - Should we support multiple grammars
   analyzing the same file? (e.g., embedded languages)

4. **Query validation** - Should viola validate that queries use standard
   capture names at registration time?

## Implementation Checklist

### Phase 1: Core Infrastructure

- [ ] Add `web-tree-sitter` to viola dependencies
- [ ] Create `src/grammars/types.ts` with all type definitions
- [ ] Create `src/grammars/loader.ts` for lazy grammar loading
- [ ] Create `src/grammars/extractor.ts` for query-based extraction
- [ ] Create `src/grammars/mod.ts` to export public API

### Phase 2: Builder API

- [ ] Create comparison primitives (`atLeast`, `equals`, `oneOf`, etc.)
- [ ] Create `when` condition API with namespaces (`when.issue.*`, `when.env()`,
      `when.in()`)
- [ ] Implement `.add(kind, thing).as(alias)` pattern
- [ ] Implement `.rule(action, condition)` for report actions
- [ ] Implement `grammar(x).overrides(y)` and `grammar(x).supplements(y)`
      actions
- [ ] Implement condition composition (`.and()`)
- [ ] Implement comparator composition (`.or()`, `.and()`)

### Phase 3: Runtime

- [ ] Implement grammar resolution (parallel, supplements, overrides)
- [ ] Update `runViola` to use new builder config
- [ ] Implement condition evaluation at runtime

### Phase 4: Grammar Packages

- [ ] Create `@hiisi/viola-grammar-ts` package
- [ ] Create `@hiisi/viola-grammar-bash` package
- [ ] Update default-lints to work with new extraction

### Phase 5: Testing & Docs

- [ ] Add integration tests for builder API
- [ ] Add integration tests for grammar resolution
- [ ] Update documentation
