import { TransformOptions } from "./model";

// Common barrel file patterns
export const BARREL_FILE_PATTERNS = ["index.ts"];

// Default transform options
export const DEFAULT_TRANSFORM_OPTIONS: TransformOptions = {
    parser: "tsx",
    "project-root": process.cwd(),
    "quote-style": "double" as const,
};
