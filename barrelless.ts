import { API, JSCodeshift, type FileInfo } from "jscodeshift";
import { ParsedCommandLine } from "typescript";
import { TransformOptions } from "./model";
import { fileIsIncluded, getTSConfig } from "./utils";
import { DEFAULT_TRANSFORM_OPTIONS } from "./constants";
import { initTypescriptServices } from "./ts-service";
import { initBarrelFilesMap } from "./barrel-checker";
import { processImports } from "./import-processor";

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
        console.log("File is not included in tsconfig", fileInfo.path);
        return undefined;
    }

    initTypescriptServices(options["project-root"], tsconfig);

    const jscodeshift = api.jscodeshift.withParser(options.parser);
    initBarrelFilesMap(jscodeshift, tsconfig);

    return processFile({ jscodeshift, fileInfo, options, tsconfig });
};
