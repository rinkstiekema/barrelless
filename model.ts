import { ImportSpecifier, Parser } from "jscodeshift";
import { Program, LanguageService } from "typescript";

export type TransformOptions = {
    parser: string | Parser;
    "project-root": string;
    "quote-style": "single" | "double";
};

export type ProgramCache = {
    // Cache of identified barrel files (path -> boolean)
    barrelFilesMap: Map<string, boolean>;

    // Stores path aliases from tsconfig.json
    pathAliases?: Record<string, string>;
    tsProgram?: Program;
    tsLanguageService?: LanguageService;
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

export type NewImport = {
    specifiers: ImportSpecifier[];
    source: string;
};

export type ImportReplacement = {
    barrelImportPath: string;
    newImports: NewImport[];
};

export type ProcessedImport = {
    hasBarrelImports: boolean;
    importReplacements: ImportReplacement[];
};
