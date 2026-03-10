import path from "path";

export const isBarrelImport = (
    resolvedPath: string,
    barrelFilesMap: Map<string, boolean>
): boolean => {
    // Barrel files are absolute paths from the root of the file system
    // So we transform the resolved path similarly
    const absolutePath = path.resolve(resolvedPath);

    return barrelFilesMap.get(absolutePath) ?? false;
};
