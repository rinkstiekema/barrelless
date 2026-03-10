import { API, type FileInfo } from "jscodeshift";

import { initBarrelFilesMap } from "./utils/barrel-checker";
import { getTypescriptService, resolveImportPath } from "./utils/ts-service";
import { isBarrelImport } from "./utils/import-check";
import { transformImport } from "./utils/import-transform";

/**
 * Main transform function that jscodeshift will execute
 *
 * @param fileInfo - Information about the file being processed
 * @param api - jscodeshift API
 * @param cliOptions - Options passed to the transform
 * @returns The transformed source or undefined if no changes were made
 */
export const transform = (fileInfo: FileInfo, api: API) => {
    const j = api.jscodeshift;
    // TODO: use projectRoot from cliOptions
    const { tsConfig, tsProgram, tsCompilerHost } =
        getTypescriptService("__testfixtures__");
    const barrelFilesMap = initBarrelFilesMap(j, tsConfig);

    const imports = j(fileInfo.source).find(j.ImportDeclaration);

    return imports
        .filter(({ node }) => {
            const importPath = node.source.value;
            if (typeof importPath !== "string") {
                throw new Error("Import path is not a string");
            }

            const resolvedPath = resolveImportPath(
                importPath,
                fileInfo.path,
                tsProgram,
                tsCompilerHost
            );

            return isBarrelImport(resolvedPath, barrelFilesMap);
        })
        .replaceWith((importDeclaration) =>
            transformImport({
                importDeclaration,
                fileInfo,
                j,
                tsProgram,
                tsCompilerHost,
            })
        )
        .toSource();
};

export default transform;
export const parser = "tsx";
