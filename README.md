# `viola`

<div align="center" style="text-align: center;">

[![JSR](https://jsr.io/badges/@hiisi/viola)](https://jsr.io/@hiisi/viola)
[![GitHub Issues](https://img.shields.io/github/issues/hiisi-digital/viola.svg)](https://github.com/hiisi-digital/viola/issues)
![License](https://img.shields.io/github/license/hiisi-digital/viola?color=%23009689)

> A convention linter with flexibility and plugins, for any language you can
> write a tree-sitter grammar for.

</div>

`viola` parses your source once, pulls out the shapes worth asking questions
about (functions, types, imports, exports, strings), and hands that to whatever
linters you've configured. It ships no lints and no opinions of its own, which
is deliberate: the rules you want enforced are yours, and they tend not to
survive being guessed at by a tool.

For regular old source linting, this is probably not the right tool. Not that it
can't serve that role, but there are more proven and established staples in your
language of choice for that specifically. What this is for is the conventions
that sit above the source and aren't easily expressible in a traditional linter:
where a type is allowed to live, what a name has to look like in one directory
and not another, which strings are allowed to repeat.

This is under active development, so the api hasn't settled and breaking changes
should be expected. I'd caution against leaning on it for anything serious just
yet.

## Installation

```bash
deno add jsr:@hiisi/viola
```

You'll want a grammar and some lints too, since `viola` on its own finds
nothing:

```bash
deno add jsr:@hiisi/viola-grammar-ts jsr:@hiisi/viola-default-lints
```

## Usage

Configuration is a `viola.config.ts` in your project root. Here's a realistic
one, with comments on the parts that matter:

```ts
import { Impact, report, viola, when } from "@hiisi/viola";
import defaultLints from "@hiisi/viola-default-lints";
import typescript from "@hiisi/viola-grammar-ts";

export default viola()
  // a grammar is what turns a file into something a lint can ask questions of.
  // without one, viola loads, finds nothing, and reports nothing, which reads
  // exactly like a clean project.
  .add(typescript).as("ts")
  // a plugin brings its own lints and its own default rules
  .use(defaultLints)
  // rules are read last to first and the first match decides, like css. so put
  // the broad one first and the exceptions after it.
  .rule(report.warn, when.impact.atLeast(Impact.Minor))
  .rule(report.error, when.in("src/**"))
  // fixtures are supposed to be wrong. that's their whole job.
  .rule(report.off, when.in("**/fixtures/**"))
  // per-lint settings, flat key or an object, whichever reads better
  .set("duplicate-strings.threshold", 4);
```

Then run it. There's a cli, and there's the library, and they run the same
checks:

```bash
deno run -A jsr:@hiisi/viola-cli
```

Running it from the library is worth knowing about, because a package that the
cli depends on can't wait for the cli to publish before it can check itself:

```ts
// gate.ts
import config from "./viola.config.ts";
import { runProject } from "@hiisi/viola";

if (import.meta.main) {
  Deno.exit(await runProject({
    projectRoot: new URL(".", import.meta.url).pathname,
    include: ["."],
    preloadedConfig: config,
    env: Deno.env.toObject(),
  }));
}
```

`runProject` returns the exit code and prints the report, so `deno run -A
gate.ts` is a complete gate. It refuses a run that scanned no files or had no
lints configured, rather than reporting a clean project, because those two look
identical in the output and only one of them is good news.

## Rules and conditions

A rule is an action and a condition. The actions:

| Action         | What it does                          |
| -------------- | ------------------------------------- |
| `report.error` | fails the run, exits non-zero         |
| `report.warn`  | yellow, doesn't fail                  |
| `report.info`  | blue, informational                   |
| `report.hint`  | dim, a suggestion                     |
| `report.off`   | suppress it                           |
| `report.skip`  | don't run lints on the file at all    |

Conditions come off `when`, and they compose:

```ts
when.in("src/**", "packages/**"); // by path glob
when.linter("similar-*"); // by which lint reported it
when.impact.atLeast(Impact.Major); // by how much it matters
when.confidence.between(50, 90); // by how sure the lint is
when.category.is(Category.Consistency); // by what kind of thing it is
when.env("CI").exists(); // by the environment

when.in("src/**").and(when.impact.atLeast(Impact.Major));
when.any(when.in("**/*_test.ts"), when.in("**/*.spec.ts"));
when.category.is(Category.Style).not();
```

The ordered ones take a comparison if you want something other than the
shorthand, so `when.impact.atLeast(x)` and `when.impact(atLeast(x))` are the
same thing. `equals`, `atLeast`, `atMost`, `lessThan`, `moreThan`, `between`,
`oneOf`, `noneOf`, `contains`, `startsWith`, `endsWith`, `matches`, `glob`,
`always` and `never` are all exported.

## Grammar relationships

When more than one grammar matches a file, they all run and their results merge.
That's usually what you want. When it isn't:

```ts
// ts replaces js entirely for .ts files
.rule(grammar("ts").overrides("js"), when.in("*.ts", "*.tsx"))
// ts fills in what js didn't capture on .js files
.rule(grammar("ts").supplements("js"), when.in("*.js", "*.jsx"))
```

A relationship only applies where both grammars already match the file, from
their registered extensions and globs. Naming a grammar outside that set is
skipped rather than an error, which is a little forgiving, and you can see what
actually resolved with `--verbose`.

## Writing a grammar

A grammar package is tree-sitter queries plus the captures you want out of them:

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
  },
};
```

Worth knowing: query patterns overlap, so one statement can match several and
come back as several records. The extractor folds those by position, so write
the queries you want and don't worry about being clever with the overlaps.

## Writing a lint

A lint gets the extracted data and hands back issues:

```ts
import {
  BaseLinter,
  type CodebaseData,
  type Issue,
  type IssueCatalog,
} from "@hiisi/viola";

class NoUnderscoreFunctions extends BaseLinter {
  readonly meta = {
    id: "no-underscore-functions",
    name: "No Underscore Functions",
    description: "Disallow function names starting with underscore",
  };

  // the annotation matters: without it the strings widen to `string` and the
  // catalog stops type-checking against the shipped shape.
  readonly catalog: IssueCatalog = {
    "no-underscore-functions/underscore-prefix": {
      category: "consistency",
      impact: "minor",
      description: "Function name starts with underscore",
    },
  };

  // declare what you need and the crawler will have it ready
  readonly requirements = { functions: true };

  lint(data: CodebaseData): Issue[] {
    return data.allFunctions
      .filter((fn) => fn.name.startsWith("_"))
      .map((fn) =>
        this.issue(
          "underscore-prefix",
          fn.location,
          `Function "${fn.name}" starts with underscore`,
        )
      );
  }
}

export const noUnderscoreFunctions = new NoUnderscoreFunctions();
```

The `catalog` is where impact and category live, rather than on each issue, so a
rule written against `when.impact` has something to read.

## Writing a plugin

A plugin is a function that gets the builder, so it can bring grammars, lints
and its own default rules:

```ts
import { Impact, plugin, report, when } from "@hiisi/viola";
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

## Driving it yourself

If you want the results rather than a report, `runViola` gives you them. It
takes a grammar registry rather than a config, so you're wiring it by hand:

```ts
import { createGrammarRegistry, formatResults, runViola } from "@hiisi/viola";
import typescript from "@hiisi/viola-grammar-ts";

const grammarRegistry = createGrammarRegistry();
grammarRegistry.add(typescript);

const results = await runViola({ projectRoot: ".", grammarRegistry });
console.log(formatResults(results));
if (results.hasErrors) Deno.exit(1);
```

## Examples

`examples/` has runnable projects, each with its own config, covering a clean
run, findings being reported, rule precedence and grammar resolution. They double
as the end-to-end tests, so if they drift from the shipped api the suite says so
rather than the readme quietly lying to you.

## How it works

One tree-sitter engine (wasm) at the core. Grammar packages supply the queries.
The crawler walks the project, parses each matched file once, runs every
resolved grammar's queries over it, and merges the captures into one
`CodebaseData`. Lints then run against that shared structure, so adding a lint
never adds a parse pass.

## Limitations

Ships nothing but the runtime, so a bare install genuinely does nothing until
you add a grammar and some lints. That's the intent, but it does surprise
people.

Grammars exist for typescript and bash right now. Anything else means writing
the tree-sitter query set yourself, which isn't hard but isn't nothing either.

We keep the deps minimal and ship a small hand-written glob matcher over a full
glob crate and its transient deps. There are likely valid edge cases it doesn't
cover yet; if you hit one, an issue with the pattern is genuinely useful.

Speed is fine in practice, the usual workspaces lint well under a second, but
we'll attach real benchmark results later so it isn't on faith alone.

## Contributing

Feel free to contribute. If you're unsure about wasting work, throw in an issue
describing what you'd do before committing to a big PR, because chances are it
might not be something that belongs here. Forks are always a valid choice too
and we'd encourage anyone to have their own take on this. Do mind the licence
when you do.

## A note on the name

Viola is a string instrument, a little lower in tone than a violin. It's also
the front of "violation", which is what a linter spends its time looking for.
Word play, though perhaps not the most clever one.

## Support

Whether you use this project, have learned something from it, or just like it,
please consider supporting it by buying me a coffee, so I can dedicate more time
on open-source projects like this :)

<a href="https://buymeacoffee.com/orgrinrt" target="_blank"><img src="https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png" alt="Buy Me A Coffee" style="height: auto !important;width: auto !important;" ></a>

## License

> You can check out the full license
> [here](https://github.com/hiisi-digital/viola/blob/main/LICENSE)

This project is licensed under the terms of the **Mozilla Public License 2.0**.

`SPDX-License-Identifier: MPL-2.0`
