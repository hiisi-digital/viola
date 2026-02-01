# TODO

## Completed

### Phase 1: Condition & Comparison API ✅

- [x] Comparison primitives (`src/conditions/comparisons.ts`)
  - equals, atLeast, atMost, lessThan, moreThan, between
  - oneOf, noneOf, contains, startsWith, endsWith, matches
  - always, never
  - Composition: .and(), .or(), .not()

- [x] When condition builder (`src/conditions/when.ts`)
  - when.in(...patterns) - file path matching
  - when.issue.by() - match by linter/source
  - when.issue.impact() - match by impact level
  - when.issue.confidence() - match by confidence
  - when.issue.category() - match by category
  - when.issue.kind() - match by issue kind
  - when.env(name).exists() - environment variable exists
  - when.env(name).is() - environment variable value
  - Composition: .and(), .or(), .not()

- [x] Tests: 55 passing tests for conditions

### Phase 2: Grammar Infrastructure ✅

- [x] Grammar types (`src/grammars/types.ts`)
  - GrammarDefinition, GrammarMeta, GrammarSource
  - ExtractionQueries (functions, strings, imports, exports, types, docComments)
  - GrammarTransforms (parseParams, normalizeBody, etc.)
  - QueryCaptures, SyntaxNode

- [x] Tree-sitter loader (`src/grammars/loader.ts`)
  - WASM loading from npm, URL, or bundled
  - Language and parser caching
  - createParser, getParser, loadGrammar

- [x] Query execution (`src/grammars/query.ts`)
  - runQuery generator
  - queryAll, queryFirst, queryCount, queryHasMatch

- [x] Generic extraction engine (`src/grammars/extractor.ts`)
  - extractFileData, extractCompleteFileInfo
  - Functions, strings, imports, exports, types extraction

- [x] Grammar registry (`src/grammars/registry.ts`)
  - add(grammar).as(alias)
  - findMatchingGrammars by extension/glob

- [x] Grammar resolver (`src/grammars/resolver.ts`)
  - Override relationship (primary replaces secondary)
  - Supplement relationship (primary fills gaps)
  - mergeExtractionResults for supplement semantics

- [x] Grammar reference helper (`src/config/grammar-ref.ts`)
  - grammar(alias).overrides(other)
  - grammar(alias).supplements(other)

- [x] Builder grammar support (`src/config/builder.ts`)
  - .add(grammar).as(alias)
  - .rule(grammar(...), when.in(...))
  - grammarRegistry and grammarRules in config

- [x] Tests: 64 new tests (216 total passing)

### Plugin System ✅

- [x] Plugin discovery and loading
- [x] Preset inheritance
- [x] Config validation against JSON schemas
- [x] Linter settings merging

---

## In Progress

### Phase 3: Grammar Packages

- [ ] `@hiisi/viola-grammar-ts` - TypeScript grammar package
  - Tree-sitter queries for TS/TSX
  - Transform functions for complex extraction
  - JSDoc parsing
  - See: https://github.com/hiisi-digital/viola-grammar-ts

- [ ] `@hiisi/viola-grammar-bash` - Bash grammar package
  - Tree-sitter queries for shell scripts
  - Positional parameter extraction ($1, $2, $@)
  - Here-doc normalization
  - See: https://github.com/hiisi-digital/viola-grammar-bash

### Phase 4: Crawler Integration

- [ ] Wire grammar resolver into crawler
- [ ] Load matching grammars for each file
- [ ] Parse with tree-sitter
- [ ] Apply supplement merging
- [ ] Replace regex-based extraction with tree-sitter

---

## Future

### WASM Strategy

- [ ] Decide on WASM bundling for `deno compile`
- [ ] Support runtime WASM loading from CDN
- [ ] Grammar package WASM distribution

### CLI Improvements

- [ ] `viola init` - Generate starter config
- [ ] `viola check --fix` - Auto-fix where possible
- [ ] Better error formatting
- [ ] Watch mode

### Performance

- [ ] Incremental parsing
- [ ] Parallel file processing
- [ ] Grammar/parser pooling
- [ ] Query caching

### Developer Experience

- [ ] TypeScript inference for .as(alias) in rules
- [ ] IDE support for viola.config.ts
- [ ] Grammar debugging tools

---

## Open Questions

1. Should grammar WASM files be bundled or loaded at runtime?
2. How to handle incremental parsing for watch mode?
3. Should we support grammar hot-reloading for development?
4. How to handle grammar version conflicts between packages?
