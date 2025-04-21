import * as fs from "fs";
import ts, { CompilerOptions, ParsedCommandLine } from "typescript";
import { programCache } from "./program-cache";
import { ImportSymbol, SymbolDeclaration } from "./model";

/**
 * Initialize TypeScript program and language service
 *
 * @param {ParsedCommandLine} tsconfig - The parsed tsconfig.json
 * @param {string} projectRoot - The root directory of the project
 */
export const initTypescriptServices = (
    projectRoot: string,
    tsconfig: ParsedCommandLine
): void => {
    if (programCache.tsProgram && programCache.tsLanguageService) return;

    // Create program
    programCache.tsProgram = ts.createProgram(
        tsconfig.fileNames,
        tsconfig.options
    );

    // Create language service host
    const serviceHost = {
        getScriptFileNames: () => tsconfig.fileNames,
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
        getCompilationSettings: () => tsconfig.options,
        getDefaultLibFileName: (options: CompilerOptions) =>
            ts.getDefaultLibFilePath(options),
        fileExists: ts.sys.fileExists,
        readFile: ts.sys.readFile,
        readDirectory: ts.sys.readDirectory,
    };

    // Create language service
    programCache.tsLanguageService = ts.createLanguageService(
        serviceHost,
        ts.createDocumentRegistry()
    );

    console.log("TypeScript language service initialized successfully.");
    console.log(`Loaded ${tsconfig.fileNames.length} files in the program.`);
};

/**
 * Find the original declaration of a symbol imported from a barrel file
 *
 * @param {object} options - Options for finding the symbol declaration
 * @param {string} options.symbol - The imported symbol name
 * @param {string} options.sourceFilePath - The file containing the import
 * @param {number} options.importPosition - The position of the import in the source file (used only as fallback)
 * @param {number|undefined} options.exactPosition - The exact character position of the symbol (if known)
 * @returns {string|null} - The file path of the original declaration or null if not found
 */
export const findSymbolDeclaration = ({
    symbol,
    sourceFilePath,
    importPosition,
    exactPosition,
}: SymbolDeclaration): string | null => {
    const { tsLanguageService } = programCache;
    if (!tsLanguageService) {
        console.error("TypeScript language service not initialized");
        return null;
    }

    try {
        let symbolPosition: number;

        // If exact position is provided, use it directly
        if (exactPosition !== undefined) {
            symbolPosition = exactPosition;
        } else {
            // Otherwise, fall back to searching for the symbol using regex
            // Read source file
            const sourceFileText = fs.readFileSync(sourceFilePath, "utf8");

            // Find the position of the symbol in the import declaration
            // For simplicity, we'll search for the symbol name
            const symbolMatch = new RegExp(`\\b${symbol}\\b`);
            const match = symbolMatch.exec(
                sourceFileText.substring(importPosition)
            );

            if (!match) {
                console.warn(
                    `Could not find symbol '${symbol}' at position ${importPosition} in ${sourceFilePath}`
                );
                return null;
            }

            // Calculate actual position
            symbolPosition = importPosition + match.index;
        }

        // Get definition using TS language service
        const definitions = tsLanguageService.getDefinitionAtPosition(
            sourceFilePath,
            symbolPosition
        );

        if (!definitions || definitions.length === 0) {
            console.warn(
                `No definitions found for symbol '${symbol}' in ${sourceFilePath}`
            );
            return null;
        }

        // Return the first definition's file path (most likely the correct one)
        return definitions[0].fileName;
    } catch (error) {
        console.error(
            `Error finding declaration for symbol '${symbol}':`,
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
    tsconfig: ParsedCommandLine
): string => {
    const { tsProgram } = programCache;
    if (!tsProgram) {
        throw new Error("TypeScript program not initialized");
    }

    // Get the source file for the current file
    const sourceFile = tsProgram.getSourceFile(currentFilePath);
    if (!sourceFile) {
        throw new Error(`Source file not found: ${currentFilePath}`);
    }

    // Get the compiler host from the program
    const compilerHost = tsProgram.getCompilerOptions().configFilePath
        ? ts.createCompilerHost(tsProgram.getCompilerOptions(), true)
        : ts.createCompilerHost(tsProgram.getCompilerOptions());

    // Use TypeScript's module resolution
    const moduleResolution = ts.resolveModuleName(
        importPath,
        currentFilePath,
        tsconfig.options,
        compilerHost
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
    symbol: ImportSymbol,
    filePath: string
): number | undefined => {
    if (symbol.position === undefined || symbol.line === undefined) {
        return undefined;
    }

    // Use TypeScript to get the source file and convert line/column to position
    const { tsProgram } = programCache;
    if (!tsProgram) throw new Error("TypeScript program not initialized");

    const sourceFile = tsProgram.getSourceFile(filePath);
    if (!sourceFile) throw new Error(`Source file ${filePath} not found`);

    // Use TypeScript's API to get the position from line/column
    return sourceFile.getPositionOfLineAndCharacter(
        symbol.line - 1, // TS is 0-based, JSCodeshift is 1-based
        symbol.position
    );
};
