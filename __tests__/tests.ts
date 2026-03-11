import path from "path";
import { defineTest } from "jscodeshift/src/testUtils";

const cliOptions = {
    "project-root": path.join(__dirname, "../__testfixtures__"),
};

defineTest(__dirname, "src/barrelless", cliOptions, "absolute-import/default", {
    parser: "ts",
});

defineTest(__dirname, "src/barrelless", cliOptions, "alias-import/default", {
    parser: "ts",
});

defineTest(__dirname, "src/barrelless", cliOptions, "circular-reexport/default", {
    parser: "ts",
});

defineTest(__dirname, "src/barrelless", cliOptions, "deep-import/default", {
    parser: "ts",
});

defineTest(__dirname, "src/barrelless", cliOptions, "default-export/default", {
    parser: "ts",
});

defineTest(__dirname, "src/barrelless", cliOptions, "mixed-import/default", {
    parser: "ts",
});

defineTest(__dirname, "src/barrelless", cliOptions, "namespace-import/default", {
    parser: "ts",
});

defineTest(__dirname, "src/barrelless", cliOptions, "reexport-chain/default", {
    parser: "ts",
});

defineTest(__dirname, "src/barrelless", cliOptions, "relative-import/default", {
    parser: "ts",
});

defineTest(__dirname, "src/barrelless", cliOptions, "renamed-import/default", {
    parser: "ts",
});

defineTest(__dirname, "src/barrelless", cliOptions, "type-only-import/default", {
    parser: "ts",
});

defineTest(__dirname, "src/barrelless", cliOptions, "no-transform/default", {
    parser: "ts",
});

defineTest(__dirname, "src/barrelless", cliOptions, "multiple-barrels/default", {
    parser: "ts",
});

defineTest(__dirname, "src/barrelless", cliOptions, "alias-output/default", {
    parser: "ts",
});

defineTest(__dirname, "src/barrelless", cliOptions, "alias-multiple-specifiers/default", {
    parser: "ts",
});

defineTest(
    __dirname,
    "src/barrelless",
    { ...cliOptions, "use-aliases": false },
    "alias-disabled/default",
    { parser: "ts" }
);

defineTest(__dirname, "src/barrelless", cliOptions, "alias-namespace-output/default", {
    parser: "ts",
});

defineTest(__dirname, "src/barrelless", cliOptions, "alias-type-only-output/default", {
    parser: "ts",
});
