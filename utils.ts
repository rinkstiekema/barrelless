import path from "path";
import ts, { ParsedCommandLine } from "typescript";
import fs from "fs";

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
