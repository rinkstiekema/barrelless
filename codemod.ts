import * as path from "path";
import * as fs from "fs";
import ts, { CompilerOptions, ParsedCommandLine } from "typescript";
import {
    API,
    Collection,
    ImportDeclaration,
    JSCodeshift,
    type FileInfo,
} from "jscodeshift";
import {
    BarrelImportInfo,
    ImportReplacement,
    ImportSymbol,
    NewImport,
    ProcessedImport,
    ProgramCache,
    SymbolDeclaration,
    TransformOptions,
} from "./model";
import { fileIsIncluded, getTSConfig } from "./utils";

// Directories to scan for files that use barrel imports
const TARGET_DIRECTORIES = ["modules", "pages", "styles", "e2e", "test", "lib"];

// Common barrel file patterns
const BARREL_FILE_PATTERNS = ["index.ts"];

// Parser options for TypeScript files

const DEFAULT_TRANSFORM_OPTIONS: TransformOptions = {
    parser: "tsx",
    "project-root": process.cwd(),
    "quote-style": "single" as const,
};

const programCache: ProgramCache = {
    barrelFilesMap: new Map(),
};

/**
 * Initialize TypeScript program and language service
 *
 * @param {ParsedCommandLine} tsconfig - The parsed tsconfig.json
 * @param {string} projectRoot - The root directory of the project
 * @returns {object} - Object containing the TypeScript program and language service
 */
const initTypescriptServices = (
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
 * Find a matching TypeScript file by trying index files and extensions
 *
 * @param {string} basePath - The base path to check
 * @returns {string} - The found file path or the original path
 */
const findMatchingIndexFile = (basePath: string): string => {
    // Try to find an index file
    for (const ext of [".ts", ".tsx"]) {
        const indexPath = path.join(basePath, `index${ext}`);
        if (fs.existsSync(indexPath)) {
            return indexPath;
        }
    }

    // Try with extensions
    for (const ext of [".ts", ".tsx"]) {
        const pathWithExt = `${basePath}${ext}`;
        if (fs.existsSync(pathWithExt)) {
            return pathWithExt;
        }
    }

    // Return the original path if no matching file is found
    return basePath;
};

/**
 * Find the original declaration of a symbol imported from a barrel file
 *
 * @param {object} options - Options for finding the symbol declaration
 * @param {string} options.symbol - The imported symbol name
 * @param {string} options.sourceFilePath - The file containing the import
 * @param {string} options.importSpecifier - The import specifier (e.g., '@/modules/shared')
 * @param {number} options.importPosition - The position of the import in the source file (used only as fallback)
 * @param {number|undefined} options.exactPosition - The exact character position of the symbol (if known)
 * @returns {string|null} - The file path of the original declaration or null if not found
 */
const findSymbolDeclaration = ({
    symbol,
    sourceFilePath,
    importSpecifier,
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
 * Read and parse tsconfig.json to extract path aliases
 *
 * @param {ParsedCommandLine} tsconfig - The parsed tsconfig.json
 * @returns {Record<string, string>} - Object mapping alias prefixes to their resolved paths
 */
const getPathAliases = (
    tsconfig: ParsedCommandLine
): Record<string, string> => {
    // Return cached aliases if they exist
    if (!!programCache.pathAliases) return programCache.pathAliases;

    try {
        const baseUrl = tsconfig.options.baseUrl || ".";
        const paths = tsconfig.options.paths || {};

        // Convert path mapping patterns to a simpler format for our use
        const pathAliases: Record<string, string> = {};
        Object.entries(paths).forEach(([alias, targets]) => {
            // Remove wildcards from path patterns
            const cleanAlias = alias.replace(/\/\*$/, "");
            const cleanTarget = targets[0].replace(/\/\*$/, "");
            pathAliases[cleanAlias] = path.join(baseUrl, cleanTarget);
        });

        programCache.pathAliases = pathAliases;
        return pathAliases;
    } catch (e) {
        console.warn(
            "Failed to load tsconfig.json, assuming no aliases should be considered"
        );
        return {};
    }
};

/**
 * Resolve the absolute path of an imported module
 *
 * @param {string} importPath - The import path from the import statement
 * @param {string} currentFilePath - The path of the file containing the import
 * @param {string} projectRoot - The root directory of the project
 * @returns {string} - The absolute path of the imported file
 */
const resolveImportPath = (
    importPath: string,
    currentFilePath: string,
    tsconfig: ParsedCommandLine
): string => {
    // Handle alias imports (starting with '@')
    if (importPath.startsWith("@")) {
        // Find the longest matching alias
        const aliases = getPathAliases(tsconfig);
        let matchedAlias: string | null = null;
        let matchedPrefix = "";

        for (const [alias, target] of Object.entries(aliases)) {
            if (
                importPath.startsWith(alias) &&
                alias.length > matchedPrefix.length
            ) {
                matchedAlias = target;
                matchedPrefix = alias;
            }
        }

        if (matchedAlias) {
            // Replace the alias prefix with the target path
            const relativePath = importPath.slice(matchedPrefix.length);
            const resolvedPath = path.join(matchedAlias, relativePath);

            // Handle the case where the import path points directly to a directory
            // and we need to resolve to the index file
            if (!path.extname(resolvedPath)) {
                return findMatchingIndexFile(resolvedPath);
            }

            return resolvedPath;
        }
    }

    // Handle relative imports
    // Add extension if needed
    let resolvedPath = importPath;

    if (!path.extname(importPath)) {
        const tryExtensions = () => {
            // Try TypeScript extensions
            for (const ext of [".ts", ".tsx"]) {
                const pathWithExt = `${importPath}${ext}`;
                const fullPath = path.resolve(
                    path.dirname(currentFilePath),
                    pathWithExt
                );
                if (fs.existsSync(fullPath)) {
                    return pathWithExt;
                }
            }
            return null;
        };

        const tryIndexFiles = () => {
            // Check for TypeScript index files
            for (const ext of [".ts", ".tsx"]) {
                const indexPath = path.join(importPath, `index${ext}`);
                const fullPath = path.resolve(
                    path.dirname(currentFilePath),
                    indexPath
                );
                if (fs.existsSync(fullPath)) {
                    return indexPath;
                }
            }
            return null;
        };

        // Try extensions first, then index files
        resolvedPath = tryExtensions() || tryIndexFiles() || importPath;
    }

    // Resolve to absolute path
    return path.resolve(path.dirname(currentFilePath), resolvedPath);
};

/**
 * Check if a file is a barrel file by analyzing its content
 * A barrel file only contains exports (re-exports) and imports
 * Updates the barrelFilesMap with the result
 *
 * @param {string} filePath - Path to the file to check
 * @param {JSCodeshift} jscodeshift - JSCodeshift instance
 * @returns {boolean} - Whether the file is a barrel file
 */
const isBarrelFile = (filePath: string, jscodeshift: JSCodeshift): boolean => {
    // Check cache first
    const { barrelFilesMap } = programCache;
    if (barrelFilesMap.has(filePath)) {
        return barrelFilesMap.get(filePath)!;
    }
    // Check if file exists
    if (!fs.existsSync(filePath)) {
        barrelFilesMap.set(filePath, false);
        return false;
    }

    try {
        const content = fs.readFileSync(filePath, "utf8");
        const root = jscodeshift(content, {
            parser: DEFAULT_TRANSFORM_OPTIONS,
        });

        // Barrel file detection:
        // A barrel file should only contain imports and exports, with no other code
        const nStatements = root.find(jscodeshift.Statement).length;

        // Skip empty files
        if (nStatements === 0) {
            barrelFilesMap.set(filePath, false);
            return false;
        }

        // Count import and export statements
        const nImportStatements = root.find(
            jscodeshift.ImportDeclaration
        ).length;

        const nExportNamedStatements = root.find(
            jscodeshift.ExportNamedDeclaration
        ).length;

        const nExportDefaultStatements = root.find(
            jscodeshift.ExportDefaultDeclaration
        ).length;

        const nExportAllStatements = root.find(
            jscodeshift.ExportAllDeclaration
        ).length;

        const totalImportsAndExports =
            nImportStatements +
            nExportNamedStatements +
            nExportDefaultStatements +
            nExportAllStatements;

        // Check for any non-import, non-export statements
        const hasOnlyImportsAndExports = totalImportsAndExports === nStatements;

        // A barrel file must have at least one export
        const nExports =
            nExportNamedStatements +
            nExportDefaultStatements +
            nExportAllStatements;
        const hasExports = nExports > 0;

        // Consider a file a barrel if it only has imports and exports, and has at least one export
        const isBarrel = hasOnlyImportsAndExports && hasExports;
        barrelFilesMap.set(filePath, isBarrel);
        return isBarrel;
    } catch (parseError) {
        // Log parsing errors but don't stop the process
        if (parseError instanceof Error) {
            console.error(`Error parsing ${filePath}: ${parseError.message}`);
        }

        barrelFilesMap.set(filePath, false);
        return false;
    }
};

/**
 * Collect all potential barrel files (index.ts) from a directory and its subdirectories
 *
 * @param {string} directory - Directory to scan
 * @returns {string[]} - Paths of all files matching barrel file patterns
 */
const collectPotentialBarrelFiles = (directory: string): string[] => {
    const potentialBarrelFiles: string[] = [];

    function scanDirectory(dir: string) {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });

            // Check for index files in this directory
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);

                if (entry.isDirectory()) {
                    // Recursively scan subdirectories
                    scanDirectory(fullPath);
                } else if (
                    entry.isFile() &&
                    BARREL_FILE_PATTERNS.includes(entry.name)
                ) {
                    // Collect files matching barrel patterns
                    potentialBarrelFiles.push(fullPath);
                }
            }
        } catch (error) {
            console.error(`Error scanning directory ${dir}:`, error);
        }
    }

    scanDirectory(directory);
    return potentialBarrelFiles;
};

/**
 * Identify all barrel files in the given directory and its subdirectories
 *
 * @param {string} directory - Directory to scan
 * @param {JSCodeshift} jscodeshift - JSCodeshift instance
 * @returns {string[]} - Paths of identified barrel files
 */
const findBarrelFiles = (
    directory: string,
    jscodeshift: JSCodeshift
): string[] => {
    // First collect all potential barrel files
    const potentialBarrelFiles = collectPotentialBarrelFiles(directory);

    // Then analyze each one to determine if it's actually a barrel file
    return potentialBarrelFiles.filter((filePath) =>
        isBarrelFile(filePath, jscodeshift)
    );
};

/**
 * Extract imported symbols from an import declaration
 *
 * @param {ImportDeclaration} importNode - The import declaration node
 * @returns {ImportSymbol[]} - Array of objects containing symbol names, their aliases, and positions
 */
const getImportedSymbols = (importNode: ImportDeclaration): ImportSymbol[] => {
    const symbols: ImportSymbol[] = [];

    // Handle default import: import DefaultExport from 'module'
    if (
        importNode.specifiers?.some((s) => s.type === "ImportDefaultSpecifier")
    ) {
        const defaultSpecifier = importNode.specifiers.find(
            (s) => s.type === "ImportDefaultSpecifier"
        );

        if (defaultSpecifier?.local) {
            symbols.push({
                name: "default",
                localName: defaultSpecifier.local.name,
                type: "default",
                hasAlias: false,
                position: defaultSpecifier.local.loc?.start.column,
                line: defaultSpecifier.local.loc?.start.line,
            });
        }
    }

    // Handle named imports: import { Export1, Export2 as Alias2 } from 'module'
    if (importNode.specifiers) {
        importNode.specifiers
            .filter((s) => s.type === "ImportSpecifier")
            .forEach((specifier) => {
                if (specifier.local) {
                    symbols.push({
                        name: specifier.imported
                            ? specifier.imported.name
                            : specifier.local.name,
                        localName: specifier.local.name,
                        type: "named",
                        hasAlias:
                            specifier.imported &&
                            specifier.imported.name !== specifier.local.name,
                        position:
                            specifier.imported?.loc?.start.column ||
                            specifier.local.loc?.start.column,
                        line:
                            specifier.imported?.loc?.start.line ||
                            specifier.local.loc?.start.line,
                    });
                }
            });
    }

    // Handle namespace import: import * as Module from 'module'
    if (
        importNode.specifiers &&
        importNode.specifiers.some((s) => s.type === "ImportNamespaceSpecifier")
    ) {
        const namespaceSpecifier = importNode.specifiers.find(
            (s) => s.type === "ImportNamespaceSpecifier"
        );

        if (namespaceSpecifier?.local) {
            symbols.push({
                name: "*",
                localName: namespaceSpecifier.local.name,
                type: "namespace",
                hasAlias: false,
                position: namespaceSpecifier.local.loc?.start.column,
                line: namespaceSpecifier.local.loc?.start.line,
            });
        }
    }

    return symbols;
};

/**
 * Initialize the global barrel files list by scanning target directories
 *
 * @param {JSCodeshift} jscodeshift - The jscodeshift instance
 * @param {string} projectRoot - The root directory of the project
 */
const initBarrelFilesMap = (
    jscodeshift: JSCodeshift,
    projectRoot: string,
    tsconfig: ParsedCommandLine
) => {
    // Initialize path aliases
    getPathAliases(tsconfig);

    // Scan target directories for barrel files
    for (const dir of TARGET_DIRECTORIES) {
        const dirPath = path.join(projectRoot, dir);
        if (fs.existsSync(dirPath)) {
            const barrelFiles = findBarrelFiles(dirPath, jscodeshift);
            console.log(
                `Found ${barrelFiles.length} barrel files in ${dirPath}.`
            );
        } else {
            console.warn(`No files found at dirPath ${dirPath}`);
        }
    }
};

/**
 * Generate and return the shortest path between a relative path and a project-root-relative path
 *
 * @param {string} sourceFilePath - Path of the file containing the import
 * @param {string} declarationFilePath - Path of the declaration file
 * @param {string} projectRoot - Root directory of the project
 * @returns {string} - The shortest import path, either an absolute path or a relative path
 */
const getShortestImportPath = (
    sourceFilePath: string,
    declarationFilePath: string,
    projectRoot: string
): string => {
    // Get the relative path from project root to the declaration file
    const relativeToRootPath = path.relative(projectRoot, declarationFilePath);

    // Get the direct relative path from the importing file to the declaration file
    let directRelativePath = path.relative(
        path.dirname(sourceFilePath),
        declarationFilePath
    );

    // Direct path at this point is a relative path with "../", or an absolute path from the source file
    // Prefix with "./" if it doesn't already start with "../"
    if (!directRelativePath.startsWith(".")) {
        directRelativePath = `./${directRelativePath}`;
    }

    return directRelativePath.length < relativeToRootPath.length
        ? directRelativePath
        : relativeToRootPath;
};

/**
 * Get the exact character position of a symbol in a file
 *
 * @param symbol - The imported symbol with position information
 * @param filePath - Path to the file containing the symbol
 * @returns The exact character position or undefined if it cannot be determined
 */
const getExactSymbolPosition = (
    symbol: ImportSymbol,
    filePath: string
): number | undefined => {
    if (symbol.position === undefined || symbol.line === undefined) {
        return undefined;
    }

    // Use TypeScript to get the source file and convert line/column to position
    const { tsProgram } = programCache;
    if (!tsProgram) {
        return undefined;
    }

    const sourceFile = tsProgram.getSourceFile(filePath);
    if (!sourceFile) {
        return undefined;
    }

    // Use TypeScript's API to get the position from line/column
    return sourceFile.getPositionOfLineAndCharacter(
        symbol.line - 1, // TS is 0-based, JSCodeshift is 1-based
        symbol.position
    );
};

/**
 * Process imports to identify barrel imports and prepare replacement information
 *
 * @param {object} context - The context for processing imports
 * @param {object} context.jscodeshift - The jscodeshift instance
 * @param {object} context.root - The AST root
 * @param {object} context.fileInfo - Information about the file being processed
 * @param {string} context.projectRoot - The root directory of the project
 * @returns {object} - Information about barrel imports and their replacements
 */
const processImports = ({
    jscodeshift,
    root,
    fileInfo,
    projectRoot,
    tsconfig,
}: {
    jscodeshift: JSCodeshift;
    root: Collection;
    fileInfo: FileInfo;
    projectRoot: string;
    tsconfig: ParsedCommandLine;
}): ProcessedImport => {
    // Find all import declarations
    const importDeclarations = root.find(jscodeshift.ImportDeclaration);

    // Track if we found any barrel imports
    let hasBarrelImports = false;

    // Track import replacements
    const importReplacements: ImportReplacement[] = [];

    // Process each import declaration
    importDeclarations.forEach((importPath) => {
        const importSource = importPath.node.source.value;
        if (!importSource) return;
        if (typeof importSource !== "string") {
            throw new Error("Import source is not a string");
        }

        // Handle both relative imports and alias imports
        try {
            // Resolve the absolute path of the imported file
            const importedFilePath = resolveImportPath(
                importSource,
                fileInfo.path,
                tsconfig
            );

            // Check if this imports from a barrel file
            if (programCache.barrelFilesMap.get(importedFilePath)) {
                hasBarrelImports = true;

                const barrelImportInfo: BarrelImportInfo = {
                    barrelFile: importedFilePath,
                    importSource,
                    symbols: [],
                };

                // Group imports by declaration file to combine symbols from the same file
                const importsByDeclarationFile = new Map<
                    string,
                    ImportSymbol[]
                >();

                // Extract imported symbols
                const symbols = getImportedSymbols(importPath.node);

                // Use TS Language Service to find the original declaration for each symbol
                symbols.forEach((symbol) => {
                    // Get the exact position of the symbol
                    const exactPosition = getExactSymbolPosition(
                        symbol,
                        fileInfo.path
                    );

                    const declarationFile = findSymbolDeclaration({
                        symbol: symbol.name,
                        sourceFilePath: fileInfo.path,
                        importSpecifier: importSource,
                        importPosition: importPath.node.loc?.start.line || 0, // Fallback if exactPosition is undefined
                        exactPosition,
                    });

                    barrelImportInfo.symbols.push({
                        name: symbol.name,
                        localName: symbol.localName,
                        declarationFile,
                    });

                    // Skip symbols without a declaration file
                    if (declarationFile) {
                        // Get the relative path from project root to the declaration file
                        const relativeDeclarationPath = path.relative(
                            projectRoot,
                            declarationFile
                        );

                        // Create an import path without the file extension
                        const importPath = relativeDeclarationPath.replace(
                            /\.(tsx?|jsx?)$/,
                            ""
                        );

                        // Group by import path
                        if (!importsByDeclarationFile.has(importPath)) {
                            importsByDeclarationFile.set(importPath, []);
                        }

                        // Add symbol to array
                        importsByDeclarationFile.set(importPath, [
                            ...importsByDeclarationFile.get(importPath)!,
                            {
                                name: symbol.name,
                                localName: symbol.localName,
                                type: symbol.type,
                                hasAlias: symbol.hasAlias,
                            },
                        ]);
                    }
                });

                // Prepare new direct imports to replace the barrel import
                const newImports: NewImport[] = [];

                importsByDeclarationFile.forEach((symbols, declarationPath) => {
                    const specifiers = symbols.map((symbol) => {
                        if (symbol.name === symbol.localName) {
                            return jscodeshift.importSpecifier(
                                jscodeshift.identifier(symbol.name)
                            );
                        }
                        return jscodeshift.importSpecifier(
                            jscodeshift.identifier(symbol.name),
                            jscodeshift.identifier(symbol.localName)
                        );
                    });

                    // Find the actual declaration file path by combining project root with the relative path
                    const fullDeclarationPath = path.join(
                        projectRoot,
                        declarationPath
                    );

                    // A relative path from the current file could be shorter than a relative path from the project root
                    const shortestPath = getShortestImportPath(
                        fileInfo.path,
                        fullDeclarationPath,
                        projectRoot
                    );

                    newImports.push({
                        specifiers,
                        source: shortestPath,
                    });
                });

                importReplacements.push({
                    barrelImportPath: importSource,
                    newImports,
                });
            }
        } catch (error) {
            if (error instanceof Error) {
                console.error(
                    `Error resolving import '${importSource}' in ${fileInfo.path}: ${error.message}`
                );
            }
        }
    });

    return { hasBarrelImports, importReplacements };
};

/**
 * Process a file to identify and log barrel imports
 *
 * @param {object} context - The context for processing a file
 * @param {object} context.j - The jscodeshift instance
 * @param {object} context.fileInfo - Information about the file being processed
 * @param {TransformOptions} context.options - The options for the transform
 * @param {ParsedCommandLine} context.tsconfig - The parsed tsconfig.json
 * @returns {string|undefined} - The transformed source code if changes were made, otherwise undefined
 */
const processFile = ({
    jscodeshift,
    fileInfo,
    options,
    tsconfig,
}: {
    jscodeshift: JSCodeshift;
    fileInfo: FileInfo;
    options: TransformOptions;
    tsconfig: ParsedCommandLine;
}): string | undefined => {
    try {
        // Parse the current file with TSX parser
        const root = jscodeshift(fileInfo.source);

        // Process imports, identify barrel imports, and return replacement information
        const { hasBarrelImports, importReplacements } = processImports({
            jscodeshift: jscodeshift,
            root,
            fileInfo,
            projectRoot: options["project-root"],
            tsconfig: tsconfig,
        });

        // Log information about barrel imports in a clear, per-file format
        if (hasBarrelImports) {
            // Apply replacements to transform barrel imports into direct imports
            importReplacements.forEach((replacement) => {
                const { barrelImportPath, newImports } = replacement;

                // Find the barrel import node to replace
                const barrelImport = root.find(jscodeshift.ImportDeclaration, {
                    source: { value: barrelImportPath },
                });

                // Insert new direct imports after the barrel import
                newImports.forEach((newImportCode) => {
                    // Create new import declaration node
                    const newImportNode = jscodeshift.importDeclaration(
                        newImportCode.specifiers,
                        jscodeshift.stringLiteral(newImportCode.source)
                    );

                    barrelImport.insertAfter(newImportNode);
                });

                // Remove the original barrel import
                barrelImport.remove();
            });

            // Return the transformed source with the configured quote style
            return root.toSource({ quote: options["quote-style"] });
        }

        // Return undefined to indicate no changes were made
        return undefined;
    } catch (error) {
        if (error instanceof Error) {
            console.error(
                `Error processing file ${fileInfo.path}: ${error.message}`
            );
        } else {
            console.error(`Error processing file ${fileInfo.path}: ${error}`);
        }
        return undefined;
    }
};

/**
 * Main transform function that jscodeshift will execute
 *
 * @param {FileInfo} fileInfo - Information about the file being processed
 * @param {API} api - jscodeshift API
 * @param {TransformOptions} cliOptions - Options passed to the transform
 * @returns {string|undefined} - The transformed source or undefined if no changes were made
 */
module.exports = function transform(
    fileInfo: FileInfo,
    api: API,
    cliOptions: Partial<TransformOptions> & {
        "project-root": string;
        "quote-style": "single" | "double";
    }
): string | undefined {
    const options: TransformOptions = {
        ...DEFAULT_TRANSFORM_OPTIONS,
        ...cliOptions,
    };

    const tsconfig = getTSConfig(options["project-root"]);
    if (!fileIsIncluded(tsconfig, fileInfo.path)) {
        return undefined;
    }

    initTypescriptServices(options["project-root"], tsconfig);

    const jscodeshift = api.jscodeshift.withParser(options.parser);
    initBarrelFilesMap(jscodeshift, options["project-root"], tsconfig);

    return processFile({ jscodeshift, fileInfo, options, tsconfig });
};
