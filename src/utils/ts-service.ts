import * as fs from "fs";
import ts, {
    CompilerHost,
    CompilerOptions,
    LanguageService,
    ParsedCommandLine,
    Program,
} from "typescript";
import { ImportSymbol } from "../model";
import path from "path";

type TSServiceResult = {
    tsConfig: ParsedCommandLine;
    tsProgram: Program;
    tsLanguageService: LanguageService;
    tsCompilerHost: CompilerHost;
};

const tsServiceCache = new Map<string, TSServiceResult>();

/**
 * Initialize TypeScript program and language service (cached per tsconfig path)
 * @param {string} projectRoot - The root directory of the project
 * @param {string} tsconfigFileName - The tsconfig filename (default: "tsconfig.json")
 */
export const getTypescriptService = (
    projectRoot: string,
    tsconfigFileName = "tsconfig.json"
): TSServiceResult => {
    const cacheKey = path.join(projectRoot, tsconfigFileName);
    if (tsServiceCache.has(cacheKey)) return tsServiceCache.get(cacheKey)!;

    const tsConfig = getTSConfig(projectRoot, tsconfigFileName);

    const tsProgram = ts.createProgram(tsConfig.fileNames, tsConfig.options);

    const serviceHost = {
        getScriptFileNames: () => tsConfig.fileNames,
        getScriptVersion: () => "1", // Version doesn't matter for our use case
        getScriptSnapshot: (fileName: string) => {
            if (!fs.existsSync(fileName)) {
                return undefined;
            }
            return ts.ScriptSnapshot.fromString(
                fs.readFileSync(fileName).toString()
            );
        },
        getCurrentDirectory: () => projectRoot,
        getCompilationSettings: () => tsConfig.options,
        getDefaultLibFileName: (options: CompilerOptions) =>
            ts.getDefaultLibFilePath(options),
        fileExists: ts.sys.fileExists,
        readFile: ts.sys.readFile,
        readDirectory: ts.sys.readDirectory,
    };

    const tsLanguageService = ts.createLanguageService(
        serviceHost,
        ts.createDocumentRegistry()
    );

    const tsCompilerHost = tsProgram.getCompilerOptions().configFilePath
        ? ts.createCompilerHost(tsProgram.getCompilerOptions(), true)
        : ts.createCompilerHost(tsProgram.getCompilerOptions());

    const result = { tsConfig, tsProgram, tsLanguageService, tsCompilerHost };
    tsServiceCache.set(cacheKey, result);
    return result;
};

export const getTSConfig = (projectRoot: string, tsconfigFileName = "tsconfig.json"): ParsedCommandLine => {
    const tsconfigPath = path.join(projectRoot, tsconfigFileName);
    if (!fs.existsSync(tsconfigPath)) {
        throw new Error("tsconfig.json not found");
    }

    const tsconfigFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    if (tsconfigFile.error) {
        console.error(
            "Invalid tsconfig.json",
            ts.formatDiagnostics(
                [tsconfigFile.error],
                ts.createCompilerHost({})
            )
        );
        throw new Error("Invalid tsconfig.json");
    }

    const tsconfig = ts.parseJsonConfigFileContent(
        tsconfigFile.config,
        ts.sys,
        path.dirname(tsconfigPath)
    );

    return tsconfig;
};

/**
 * Find the original declaration file of a symbol exported from a barrel file.
 * Uses TypeScript's type checker to follow alias chains (re-exports) all the way
 * to the actual declaration, handling `export { X } from './X'` and `export * from './X'`.
 *
 * @param barrelFilePath - Absolute path to the barrel file
 * @param symbolName - The exported symbol name (use "default" for default exports)
 * @param tsProgram - The TypeScript program
 * @returns Absolute path of the file where the symbol is originally declared, or null
 */
export const findSymbolDeclaration = (
    barrelFilePath: string,
    symbolName: string,
    tsProgram: Program
): string | null => {
    try {
        const typeChecker = tsProgram.getTypeChecker();

        const sourceFile = tsProgram.getSourceFile(barrelFilePath);
        if (!sourceFile) {
            console.warn(`Source file not found in program: ${barrelFilePath}`);
            return null;
        }

        const moduleSymbol = typeChecker.getSymbolAtLocation(sourceFile);
        if (!moduleSymbol) {
            console.warn(`No module symbol for: ${barrelFilePath}`);
            return null;
        }

        // getExportsOfModule resolves wildcard re-exports as well
        const exports = typeChecker.getExportsOfModule(moduleSymbol);
        const exportedSymbol = exports.find((s) => s.getName() === symbolName);
        if (!exportedSymbol) {
            console.warn(
                `Symbol '${symbolName}' not found in exports of ${barrelFilePath}`
            );
            return null;
        }

        // Follow alias chain to reach the actual declaration
        let symbol = exportedSymbol;
        while (symbol.flags & ts.SymbolFlags.Alias) {
            symbol = typeChecker.getAliasedSymbol(symbol);
        }

        const declarations = symbol.getDeclarations();
        if (!declarations || declarations.length === 0) {
            console.warn(`No declarations found for symbol '${symbolName}'`);
            return null;
        }

        return declarations[0].getSourceFile().fileName;
    } catch (error) {
        console.error(
            `Error finding declaration for symbol '${symbolName}':`,
            error
        );
        return null;
    }
};

/**
 * Resolve the absolute path of an imported module using TypeScript's resolution
 *
 * @param {string} importPath - The import path from the import statement
 * @param {string} currentFilePath - The path of the file containing the import
 * @param {ParsedCommandLine} tsconfig - The parsed tsconfig configuration
 * @returns {string} - The absolute path of the imported file
 */
export const resolveImportPath = (
    importPath: string,
    currentFilePath: string,
    tsProgram: Program,
    tsCompilerHost: CompilerHost
): string => {
    // Get the source file for the current file
    const sourceFile = tsProgram.getSourceFile(currentFilePath);
    if (!sourceFile) {
        throw new Error(`Source file not found: ${currentFilePath}`);
    }

    // Use TypeScript's module resolution
    const moduleResolution = ts.resolveModuleName(
        importPath,
        currentFilePath,
        tsProgram.getCompilerOptions(),
        tsCompilerHost
    );

    if (moduleResolution.resolvedModule) {
        return moduleResolution.resolvedModule.resolvedFileName;
    }

    throw new Error(
        `TypeScript could not resolve module: ${importPath} in ${currentFilePath}`
    );
};

/**
 * Get the exact character position of a symbol in a file
 *
 * @param symbol - The imported symbol with position information
 * @param filePath - Path to the file containing the symbol
 * @returns The exact character position or undefined if it cannot be determined
 */
export const getExactSymbolPosition = (
    tsProgram: Program,
    symbol: ImportSymbol,
    filePath: string
): number | undefined => {
    if (symbol.position === undefined || symbol.line === undefined) {
        return undefined;
    }

    if (!tsProgram) throw new Error("TypeScript program not initialized");

    const sourceFile = tsProgram.getSourceFile(filePath);
    if (!sourceFile) throw new Error(`Source file ${filePath} not found`);

    // Use TypeScript's API to get the position from line/column
    return sourceFile.getPositionOfLineAndCharacter(
        symbol.line - 1, // TS is 0-based, JSCodeshift is 1-based
        symbol.position
    );
};
