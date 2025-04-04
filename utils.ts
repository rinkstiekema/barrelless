import path from "path";
import ts, { ParsedCommandLine } from "typescript";
import fs from "fs";
import { programCache } from "./program-cache";

/**
 * Find a matching TypeScript file by trying index files and extensions
 *
 * @param {string} basePath - The base path to check
 * @returns {string} - The found file path or the original path
 */
export const findMatchingIndexFile = (basePath: string): string => {
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
 * Read and parse tsconfig.json to extract path aliases
 *
 * @param {ParsedCommandLine} tsconfig - The parsed tsconfig.json
 * @returns {Record<string, string>} - Object mapping alias prefixes to their resolved paths
 */
export const getPathAliases = (
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
 * Generate and return the shortest path between a relative path and a project-root-relative path
 *
 * @param {string} sourceFilePath - Path of the file containing the import
 * @param {string} declarationFilePath - Path of the declaration file
 * @param {string} projectRoot - Root directory of the project
 * @returns {string} - The shortest import path, either an absolute path or a relative path
 */
export const getShortestImportPath = (
    sourceFilePath: string,
    declarationFilePath: string,
    projectRoot: string
): string => {
    // Get the relative path from project root to the declaration file
    // Remove extension for cleaner import path
    const relativeToRootPath = path
        .relative(projectRoot, declarationFilePath)
        .replace(/\.(tsx?|jsx?)$/, "");

    // Get the direct relative path from the importing file to the declaration file
    // Remove extension for cleaner import path
    let directRelativePath = path
        .relative(path.dirname(sourceFilePath), declarationFilePath)
        .replace(/\.(tsx?|jsx?)$/, "");

    // Direct path at this point is a relative path with "../", or an absolute path from the source file
    // Prefix with "./" if it doesn't already start with "../"
    if (!directRelativePath.startsWith(".")) {
        directRelativePath = `./${directRelativePath}`;
    }

    // Compare lengths to determine the shortest path
    // Consider path aliases if available
    const pathAliases = programCache.pathAliases || {};
    let aliasPath: string | null = null;

    // Check if any alias matches the start of the relativeToRootPath
    for (const alias in pathAliases) {
        if (
            relativeToRootPath.startsWith(
                pathAliases[alias].replace(projectRoot + "/", "")
            )
        ) {
            // Construct the aliased path (e.g., @/components/...) - This needs refinement based on actual alias structure
            const potentialAlias =
                alias +
                relativeToRootPath.substring(
                    pathAliases[alias].replace(projectRoot + "/", "").length
                );
            if (
                aliasPath === null ||
                potentialAlias.length < aliasPath.length
            ) {
                aliasPath = potentialAlias;
            }
        }
    }

    // Compare direct relative path, project root relative path, and alias path (if found)
    let shortestPath = directRelativePath;
    if (relativeToRootPath.length < shortestPath.length) {
        shortestPath = relativeToRootPath;
    }
    if (aliasPath !== null && aliasPath.length < shortestPath.length) {
        shortestPath = aliasPath;
    }

    return shortestPath;
};

export const getTSConfig = (projectRoot: string): ParsedCommandLine => {
    const tsconfigPath = path.join(projectRoot, "tsconfig.json");
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

export const fileIsIncluded = (
    tsconfig: ParsedCommandLine,
    filePath: string
): boolean => {
    const includedFiles = new Set(
        tsconfig.fileNames.map((f) => path.resolve(f))
    );
    return includedFiles.has(path.resolve(filePath));
};
