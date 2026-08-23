# Examples

Each directory here is a small project with its own `viola.config.ts`, written
to show one thing viola does. They are runnable, and `examples_test.ts` runs
every one of them and checks what came out, so they are the end-to-end tests as
well as the documentation.

That pairing is deliberate. viola shipped a documented feature,
`grammar("ts").overrides("js")`, that did nothing for its whole life. There were
five hundred lines of passing unit tests over the resolver behind it, and every
one of them was true: they built a resolver and asked it to resolve. Not one
asked whether a config's rule ever reached a resolver, because every test lived
on one side of the gap and the defect was the gap. An example that runs the real
thing and looks at the answer cannot miss that.

Run one the way a reader would:

```bash
cd examples/01-getting-started
deno run -A ../../../viola-cli/mod.ts --project . --include src
```

Run all of them as tests:

```bash
deno test -A examples/examples_test.ts
```

An example that stops being true fails the suite, so they cannot rot the way a
readme snippet does.
