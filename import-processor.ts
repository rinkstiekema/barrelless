import * as path from "path";
import {
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
} from "./model";
import {
    findSymbolDeclaration,
    getExactSymbolPosition,
    resolveImportPath,
} from "./ts-service";
import { programCache } from "./program-cache";
import { getShortestImportPath } from "./utils"; // Assuming getShortestImportPath is moved here

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
 * Process imports to identify barrel imports and prepare replacement information
 *
 * @param {object} context - The context for processing imports
 * @param {object} context.jscodeshift - The jscodeshift instance
 * @param {object} context.root - The AST root
 * @param {object} context.fileInfo - Information about the file being processed
 * @param {string} context.projectRoot - The root directory of the project
 * @returns {object} - Information about barrel imports and their replacements
 */
export const processImports = ({
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
    tsconfig: any; // Using any for tsconfig as it's complex, refine later if needed
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
