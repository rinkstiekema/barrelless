import * as path from "path";
import * as fs from "fs";
import { JSCodeshift } from "jscodeshift";
import { ParsedCommandLine } from "typescript";
import { programCache } from "./program-cache";
import { DEFAULT_TRANSFORM_OPTIONS, BARREL_FILE_PATTERNS } from "./constants";
import { getPathAliases } from "./utils"; // Assuming getPathAliases will be moved here

/**
 * Check if a file is a barrel file by analyzing its content
 * A barrel file only contains exports (re-exports) and imports
 * Updates the barrelFilesMap with the result
 *
 * @param {string} filePath - Path to the file to check
 * @param {JSCodeshift} jscodeshift - JSCodeshift instance
 * @returns {boolean} - Whether the file is a barrel file
 */
export const isBarrelFile = (
    filePath: string,
    jscodeshift: JSCodeshift
): boolean => {
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
            parser: DEFAULT_TRANSFORM_OPTIONS.parser,
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

const dumpBarrelFilesMap = () => {
    const barrelFilesMap = programCache.barrelFilesMap;

    // Convert Map to a serializable object
    const barrelFilesObject: Record<string, boolean> = {};
    barrelFilesMap.forEach((isBarrel, filePath) => {
        barrelFilesObject[filePath] = isBarrel;
    });

    // Write to barrel-files.json
    try {
        fs.writeFileSync(
            "barrel-files.json",
            JSON.stringify(barrelFilesObject, null, 2),
            "utf8"
        );
        console.log(
            `Barrel files information written to barrel-files.json. Found ${
                Object.values(barrelFilesObject).filter(Boolean).length
            } barrel files out of ${
                Object.keys(barrelFilesObject).length
            } total files`
        );
    } catch (error) {
        console.error("Error writing barrel-files.json:", error);
    }
};

const loadBarrelFilesMap = (): Map<string, boolean> | undefined => {
    if (!fs.existsSync("barrel-files.json")) return;
    const fileContent = JSON.parse(
        fs.readFileSync("barrel-files.json", "utf8")
    );
    return new Map<string, boolean>(Object.entries(fileContent));
};

/**
 * Initialize the global barrel files list by scanning target directories
 *
 * @param {JSCodeshift} jscodeshift - The jscodeshift instance
 * @param {string} projectRoot - The root directory of the project
 */
export const initBarrelFilesMap = (
    jscodeshift: JSCodeshift,
    tsconfig: ParsedCommandLine
) => {
    const barrelFilesMap = loadBarrelFilesMap();
    if (barrelFilesMap) {
        programCache.barrelFilesMap = barrelFilesMap;
        return;
    }

    // Initialize path aliases
    getPathAliases(tsconfig);
    // Use files from tsconfig instead of scanning directories
    for (const filePath of tsconfig.fileNames) {
        const absoluteFilePath = path.resolve(filePath);

        // Skip files that don't exist
        if (!fs.existsSync(absoluteFilePath)) {
            continue;
        }

        // Check if this file is a barrel file
        isBarrelFile(absoluteFilePath, jscodeshift);
    }

    dumpBarrelFilesMap();
};
