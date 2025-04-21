import { ProgramCache } from "./model";

export const programCache: ProgramCache = {
    barrelFilesMap: new Map(),
    tsProgram: undefined,
    tsLanguageService: undefined,
    pathAliases: undefined,
};
