import {
    API,
    ASTPath,
    FileInfo,
    ImportDeclaration,
    ImportDefaultSpecifier,
    ImportNamespaceSpecifier,
    ImportSpecifier,
} from "jscodeshift";

import ts, { CompilerHost, Program } from "typescript";
import path from "path";
import { findSymbolDeclaration, resolveImportPath } from "./ts-service";

type ImportSpecifierType =
    | ImportSpecifier
    | ImportDefaultSpecifier
    | ImportNamespaceSpecifier;

const getModuleSpecifierViaTS = (
    declarationFilePath: string,
    importingSourceFile: ts.SourceFile,
    program: ts.Program,
    compilerHost: ts.CompilerHost
): string | null => {
    const tsInternal = ts as any;
    if (!tsInternal.moduleSpecifiers?.getModuleSpecifiers) return null;

    const checker = program.getTypeChecker();
    const declarationSourceFile = program.getSourceFile(declarationFilePath);
    if (!declarationSourceFile) return null;

    const moduleSymbol = checker.getSymbolAtLocation(declarationSourceFile);
    if (!moduleSymbol) return null;

    const prog = program as any;
    const msHost = {
        fileExists: (f: string) => prog.fileExists(f),
        getCurrentDirectory: () => compilerHost.getCurrentDirectory(),
        readFile: (f: string) => compilerHost.readFile(f),
        useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
        getSymlinkCache: () => prog.getSymlinkCache?.(),
        getModuleSpecifierCache: () => undefined,
        getPackageJsonInfoCache: () =>
            prog.getModuleResolutionCache?.()?.getPackageJsonInfoCache?.(),
        redirectTargetsMap: prog.redirectTargetsMap,
        getRedirectFromSourceFile: (f: string) => prog.getRedirectFromSourceFile?.(f),
        isSourceOfProjectReferenceRedirect: (f: string) =>
            prog.isSourceOfProjectReferenceRedirect?.(f),
        getFileIncludeReasons: () => prog.getFileIncludeReasons?.(),
        getCommonSourceDirectory: () => prog.getCommonSourceDirectory?.(),
        getDefaultResolutionModeForFile: (f: any) =>
            prog.getDefaultResolutionModeForFile?.(f),
        getModeForResolutionAtIndex: (f: any, index: number) =>
            prog.getModeForResolutionAtIndex?.(f, index),
    };

    const userPreferences = {
        importModuleSpecifierPreference: "non-relative" as const,
        importModuleSpecifierEnding: "index" as const,
    };

    try {
        const specifiers: string[] = tsInternal.moduleSpecifiers.getModuleSpecifiers(
            moduleSymbol,
            checker,
            program.getCompilerOptions(),
            importingSourceFile,
            msHost,
            userPreferences
        );
        const specifier = specifiers?.[0];
        if (!specifier) return null;

        // Only accept the result if it actually matches a configured paths alias.
        // Without this check, TS falls back to baseUrl-relative paths (e.g. "lib/Foo")
        // when no alias covers the file, which looks like a bare module specifier.
        const configuredPaths = program.getCompilerOptions().paths ?? {};
        const matchesAlias = Object.keys(configuredPaths).some((pattern) => {
            const isWildcard = pattern.endsWith("/*");
            const prefix = isWildcard ? pattern.slice(0, -2) : pattern;
            return isWildcard ? specifier.startsWith(prefix + "/") : specifier === prefix;
        });
        return matchesAlias ? specifier : null;
    } catch {
        return null;
    }
};

// Transforms a barrel import into a direct import
export const transformImport = ({
    importDeclaration,
    fileInfo,
    j,
    tsProgram,
    tsCompilerHost,
    useAliases,
}: {
    importDeclaration: ASTPath<ImportDeclaration>;
    fileInfo: FileInfo;
    j: API["jscodeshift"];
    tsProgram: Program;
    tsCompilerHost: CompilerHost;
    useAliases: boolean;
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
                tsCompilerHost,
                useAliases
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
    tsCompilerHost: CompilerHost,
    useAliases: boolean
): string | null => {
    // The TS program/service stores files with paths relative to CWD (from getTypescriptService).
    // fileInfo.path from jscodeshift is absolute, so normalize it to be relative to CWD.
    const sourceFilePath = path.relative(process.cwd(), fileInfo.path);

    // Namespace import: resolve barrel file itself (e.g. "./api" → "./api/index")
    if (specifier.type === "ImportNamespaceSpecifier") {
        const importSource = importDeclaration.node.source.value as string;
        const barrelPath = resolveImportPath(importSource, sourceFilePath, program, tsCompilerHost);
        const absBarrelPath = path.resolve(barrelPath);
        if (useAliases) {
            const importingSourceFile = program.getSourceFile(sourceFilePath)!;
            const aliased = getModuleSpecifierViaTS(absBarrelPath, importingSourceFile, program, tsCompilerHost);
            if (aliased) return aliased;
        }
        return toRelativeImportPath(path.resolve(sourceFilePath), absBarrelPath);
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
    const absDeclarationPath = path.resolve(declarationFilePath);
    if (useAliases) {
        const importingSourceFile = program.getSourceFile(sourceFilePath)!;
        const aliased = getModuleSpecifierViaTS(absDeclarationPath, importingSourceFile, program, tsCompilerHost);
        if (aliased) return aliased;
    }
    return toRelativeImportPath(path.resolve(sourceFilePath), absDeclarationPath);
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
