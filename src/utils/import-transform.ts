import {
    API,
    ASTPath,
    FileInfo,
    ImportDeclaration,
    ImportDefaultSpecifier,
    ImportNamespaceSpecifier,
    ImportSpecifier,
} from "jscodeshift";

import { CompilerHost, Program } from "typescript";
import path from "path";
import { findSymbolDeclaration, resolveImportPath } from "./ts-service";

type ImportSpecifierType =
    | ImportSpecifier
    | ImportDefaultSpecifier
    | ImportNamespaceSpecifier;

// Transforms a barrel import into a direct import
export const transformImport = ({
    importDeclaration,
    fileInfo,
    j,
    tsProgram,
    tsCompilerHost,
}: {
    importDeclaration: ASTPath<ImportDeclaration>;
    fileInfo: FileInfo;
    j: API["jscodeshift"];
    tsProgram: Program;
    tsCompilerHost: CompilerHost;
}): ImportDeclaration[] => {
    // If the import declaration has no specifiers, it can be removed as barrel files should have no side effects
    if (!importDeclaration.node.specifiers) return [];

    // Create a new import declaration for each specifier
    const directImportsDeclarations = importDeclaration.node.specifiers
        .map((specifier) => {
            const directImport = getDirectImport(
                importDeclaration,
                specifier,
                fileInfo,
                tsProgram,
                tsCompilerHost
            );
            if (!directImport) return;

            return buildImportDeclaration(importDeclaration, specifier, directImport, j);
        })
        .filter((declaration): declaration is ImportDeclaration => {
            return declaration !== undefined;
        });

    return directImportsDeclarations;
};

const toRelativeImportPath = (fromFile: string, toAbsFile: string): string => {
    const fromDir = path.dirname(fromFile);
    let rel = path.relative(fromDir, toAbsFile);
    rel = rel.replace(/\.(d\.ts|tsx?)$/, ""); // strip extension
    return rel.startsWith(".") ? rel : "./" + rel; // ensure ./ prefix
};

const getDirectImport = (
    importDeclaration: ASTPath<ImportDeclaration>,
    specifier: ImportSpecifierType,
    fileInfo: FileInfo,
    program: Program,
    tsCompilerHost: CompilerHost
): string | null => {
    // The TS program/service stores files with paths relative to CWD (from getTypescriptService).
    // fileInfo.path from jscodeshift is absolute, so normalize it to be relative to CWD.
    const sourceFilePath = path.relative(process.cwd(), fileInfo.path);

    // Namespace import: resolve barrel file itself (e.g. "./api" → "./api/index")
    if (specifier.type === "ImportNamespaceSpecifier") {
        const importSource = importDeclaration.node.source.value as string;
        const barrelPath = resolveImportPath(importSource, sourceFilePath, program, tsCompilerHost);
        return toRelativeImportPath(path.resolve(sourceFilePath), path.resolve(barrelPath));
    }

    // Named or default: find the actual declaration file via TS language service.
    // Start from the barrel file's re-export, not the source file's import specifier.
    // TypeScript considers an import specifier as the "definition" of its local binding,
    // so getDefinitionAtPosition on the source specifier stays in the source file.
    // Starting from the barrel file's export statement correctly follows the re-export chain.
    const symbolName = specifier.type === "ImportDefaultSpecifier"
        ? "default"
        : (specifier as ImportSpecifier).imported.name;

    const importSource = importDeclaration.node.source.value as string;
    const barrelFilePath = resolveImportPath(importSource, sourceFilePath, program, tsCompilerHost);
    const declarationFilePath = findSymbolDeclaration(barrelFilePath, symbolName, program);

    if (!declarationFilePath) return null;
    return toRelativeImportPath(path.resolve(sourceFilePath), path.resolve(declarationFilePath));
};

const buildImportDeclaration = (
    importDeclaration: ASTPath<ImportDeclaration>,
    specifier: ImportSpecifierType,
    resolvedPath: string,
    j: API["jscodeshift"]
): ImportDeclaration => {
    let specNode;

    if (specifier.type === "ImportNamespaceSpecifier") {
        specNode = j.importNamespaceSpecifier(j.identifier(specifier.local!.name));
    } else if (specifier.type === "ImportDefaultSpecifier") {
        // import X from "..." → { default as X }
        specNode = j.importSpecifier(j.identifier("default"), j.identifier(specifier.local!.name));
    } else {
        // ImportSpecifier: { User } or { User as AppUser }
        const imp = (specifier as ImportSpecifier).imported.name;
        const loc = specifier.local!.name;
        specNode = imp === loc
            ? j.importSpecifier(j.identifier(imp))
            : j.importSpecifier(j.identifier(imp), j.identifier(loc));
    }

    const newDecl = j.importDeclaration([specNode], j.literal(resolvedPath));
    newDecl.importKind = importDeclaration.node.importKind; // preserve "type" for type-only imports
    return newDecl;
};
