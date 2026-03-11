import { API, type FileInfo } from "jscodeshift";

import { initBarrelFilesMap } from "./utils/barrel-checker";
import { getTypescriptService, resolveImportPath } from "./utils/ts-service";
import { isBarrelImport } from "./utils/import-check";
import { transformImport } from "./utils/import-transform";
import { TransformOptions } from "./model";
import { DEFAULT_TRANSFORM_OPTIONS } from "./utils/constants";

/**
 * Main transform function that jscodeshift will execute
 *
 * @param fileInfo - Information about the file being processed
 * @param api - jscodeshift API
 * @param cliOptions - Options passed to the transform
 * @returns The transformed source or undefined if no changes were made
 */
export const transform = (fileInfo: FileInfo, api: API, cliOptions?: Partial<TransformOptions>) => {
    const options: TransformOptions = { ...DEFAULT_TRANSFORM_OPTIONS, ...cliOptions };
    const projectRoot = options["project-root"];
    const quoteStyle = options["quote-style"];
    const tsconfigPath = options["tsconfig-path"];
    const useAliases = options["use-aliases"] ?? true;

    const j = api.jscodeshift;
    const { tsConfig, tsProgram, tsCompilerHost } =
        getTypescriptService(projectRoot, tsconfigPath);
    const barrelFilesMap = initBarrelFilesMap(j, tsConfig, projectRoot);

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
                useAliases,
            })
        )
        .toSource({ quote: quoteStyle });
};

export default transform;
export const parser = "tsx";
