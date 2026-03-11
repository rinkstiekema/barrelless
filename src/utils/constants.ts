import { TransformOptions } from "../model";

// Default transform options
export const DEFAULT_TRANSFORM_OPTIONS: TransformOptions = {
    parser: "tsx",
    "project-root": process.cwd(),
    "quote-style": "double" as const,
    "tsconfig-path": "tsconfig.json",
    "use-aliases": true,
};
