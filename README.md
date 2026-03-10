# 🛢️ Barrelless

A [jscodeshift](https://github.com/facebook/jscodeshift) codemod that eliminates barrel file imports and replaces them with direct imports to the actual source files — automatically, using the TypeScript compiler to trace every symbol back to where it's really defined.

**Before:**

```ts
import { Button, Card, Modal } from "./components";
import { Input as TextInput } from "./components";
```

**After:**

```ts
import { Button } from "./components/Button";
import { Card } from "./components/Card";
import { Modal } from "./components/Modal";
import { Input as TextInput } from "./components/Input";
```

## Why remove barrel files?

Barrel files (`index.ts` files that re-export modules) seem convenient but cause real problems as your project grows:

-   **Slow builds** — importing one symbol forces the bundler to process everything the barrel re-exports
-   **Poor tree-shaking** — bundlers can't reliably eliminate dead code through re-exports
-   **Circular dependencies** — barrel files are a common source of hard-to-debug import cycles

This codemod automates the migration so you don't have to update hundreds of imports by hand.

Further reading:

-   [Please stop using barrel files – TkDodo](https://tkdodo.eu/blog/please-stop-using-barrel-files)
-   [Burn the barrel – Medium](https://uglow.medium.com/burn-the-barrel-c282578f21b6)

## How it works

1. **TypeScript service** — loads your `tsconfig.json` and initializes the TypeScript compiler API to resolve module paths and look up symbol declarations
2. **Barrel detection** — scans all project files and marks any file containing only import/export statements as a barrel file, caching the result in `barrel-files.json` for subsequent runs
3. **Import filtering** — for each `import` statement in the file being transformed, resolves the path and checks whether it points to a barrel file
4. **Rewriting** — replaces each matching barrel import with one direct `import` per specifier, pointing straight at the source file where the symbol is defined

## Getting started

**Install dependencies:**

```bash
npm install
```

**Run the codemod on your project:**

```bash
npx jscodeshift -t src/barrelless.ts <path-to-your-files> \
  --project-root=<your-project-root> \
  --quote-style=single
```

Pass `--dry` to preview changes without writing anything to disk.

### Options

| Option             | Description                                                   | Default            |
| ------------------ | ------------------------------------------------------------- | ------------------ |
| `--project-root`   | Root of your TypeScript project (where `tsconfig.json` lives) | current directory  |
| `--tsconfig-path`  | Path to the tsconfig file relative to `--project-root`        | `tsconfig.json`    |
| `--quote-style`    | Quote style for generated imports (`single` or `double`)      | `double`           |
| `--parser`         | jscodeshift parser to use (`ts` or `tsx`)                     | `tsx`              |
| `--ignore-pattern` | Glob pattern of files to skip                                 | —                  |

## Development

**Run all tests:**

```bash
npm test
```

**Run a specific test fixture:**

```bash
npx jest --testPathPattern="tests"
```

Tests use `ts-jest` and jscodeshift's `defineTest` helper. Each fixture provides an input file, an expected output file, and a small TypeScript project for the codemod to analyse.

## Project structure

```
src/
  barrelless.ts             # Entry point — exports the jscodeshift transform
  model.ts                  # Shared types (TransformOptions, ImportSymbol, etc.)
  utils/
    ts-service.ts           # TypeScript program & language service initialisation
    barrel-checker.ts       # Identifies barrel files, caches in barrel-files.json
    import-check.ts         # Checks whether a resolved path is a barrel file
    import-transform.ts     # Core rewrite logic — barrel import → direct imports

__testfixtures__/           # One directory per test scenario
  <scenario>/
    default.input.ts        # Source file before the transform
    default.output.ts       # Expected source file after the transform
    lib/index.ts            # Barrel file used in the scenario
    lib/<Module>.ts         # Actual source modules the barrel re-exports

__tests__/
  tests.ts                  # Test suite wired up with jscodeshift's defineTest
```

## Roadmap

[x] Resolve to relative path when it's shorter than the absolute path
[x] Share barrel file map across files for performance
[x] Share TypeScript program instance across files
[ ] Preserve path aliases in resolved imports (e.g. `@shared/hooks/useData`)
[ ] Clean up barrel files after rewriting all imports
[ ] Publish as an npm package

## License

[MIT](LICENSE)
