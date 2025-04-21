# 🛢️ Barrelless

A [`jscodeshift`](https://jscodeshift.com/) codemod to eliminate barrel files and refactor imports in TypeScript projects.

## Why eliminate barrel files?

While barrel files (index.ts files that re-export components) help you structure your codebase, they can also cause issues:

-   Slow down build times
-   Create circular dependencies
-   Increase bundle size due to poor tree-shaking, importing from a barrel file immediately imports all its exported paths

Some sources for more in-depth details:

-   https://tkdodo.eu/blog/please-stop-using-barrel-files
-   https://uglow.medium.com/burn-the-barrel-c282578f21b6
-   https://flaming.codes/en/posts/barrel-files-in-javascript/

## How does it work?

Barrelless automatically:

-   Identifies barrel files in your project
-   Traverses your project to identify imports using barrel files
-   Resolves the import to the path of the original source file
-   Rewrites imports to reference original paths directly

## Installation

```bash
npm install -g jscodeshift
npm install
# or
pnpm add -g jscodeshift
pnpm install
# or
yarn global add jscodeshift
yarn install
```

## Usage

Navigate into this repository's directory and run:

```bash
npx jscodeshift /some/path/modules \
  --transform=codemod.ts \
  --project-root=/some/path \
  --quote-style=single
```

### Options

-   `--project-root`: Root directory of your project (default: current directory)
-   `--quote-style`: Quote style to use in the generated imports ('single' or 'double', default: 'single')

### Useful jscodeshift options

You may want to use one of the following arguments when running the codemod:

-   `--parser=<'ts'|'tsx'>`: Allows you to specify the parser to use for parsing the source files
-   `--ignore-pattern=[GLOB]`: Allows you to ignore files that match a provided glob expression

## Example

Before:

```typescript
// Using barrel import
import { Button, Card, Modal } from "./components";

// Using alias import
import { Input as TextInput } from "./components";

// Using alias path
import { useData } from "@shared/hooks";

// Using direct import
import { Typography } from "./components/Typography";

// Targeting node module
import { JSX } from "react";
```

After:

```typescript
// Direct imports to source files
import { Button } from "modules/components/Button";
import { Card } from "modules/components/Card";
import { Modal } from "modules/components/Modal";

// Resolves alias imports
import { Input as TextInput } from "./components/Input";

/**
 *  Handles alias paths
 *  TODO: Keep alias path in resolved path, example:
 *  import { useData } from "@shared/hooks/useData";
 */
import { useData } from "modules/shared/hooks/useData";

// Leaves other imports as is
import { Typography } from "./components/Typography";
import { JSX } from "react";
```

## Todo

-   [x] Resolve relatively if relative path is shorter than absolute path
-   [ ] Keep alias path in resolved path
-   [ ] Handle barrel file clean up
-   [x] Improve performance by sharing barrel file through file
-   [ ] Improve performance by sharing tsconfig file
-   [ ] Improve performance by sharing typescript server
-   [ ] Package into npm package

## License

[MIT](LICENSE)
