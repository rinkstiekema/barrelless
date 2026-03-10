import { Parser } from "jscodeshift";

export type TransformOptions = {
    parser: string | Parser;
    "project-root": string;
    "quote-style": "single" | "double";
};

export type SymbolDeclaration = {
    symbol: string;
    sourceFilePath: string;
    importPosition: number;
    exactPosition?: number;
};

export type ImportSymbol = {
    name: string;
    localName: string;
    type: string;
    hasAlias: boolean;
    position?: number; // Column position
    line?: number; // Line number
};

export type BarrelImportInfo = {
    barrelFile: string;
    importSource: string;
    symbols: {
        name: string;
        localName: string;
        declarationFile: string | null;
    }[];
};
