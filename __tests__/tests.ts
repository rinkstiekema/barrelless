import { defineTest } from "jscodeshift/src/testUtils";

defineTest(__dirname, "barrelless", null, "absolute-import/default", {
    parser: "ts",
});

defineTest(__dirname, "barrelless", null, "alias-import/default", {
    parser: "ts",
});

defineTest(__dirname, "barrelless", null, "circular-reexport/default", {
    parser: "ts",
});

defineTest(__dirname, "barrelless", null, "deep-import/default", {
    parser: "ts",
});

defineTest(__dirname, "barrelless", null, "default-export/default", {
    parser: "ts",
});

defineTest(__dirname, "barrelless", null, "mixed-import/default", {
    parser: "ts",
});

defineTest(__dirname, "barrelless", null, "namespace-import/default", {
    parser: "ts",
});

defineTest(__dirname, "barrelless", null, "reexport-chain/default", {
    parser: "ts",
});

defineTest(__dirname, "barrelless", null, "relative-import/default", {
    parser: "ts",
});

defineTest(__dirname, "barrelless", null, "renamed-import/default", {
    parser: "ts",
});

defineTest(__dirname, "barrelless", null, "type-only-import/default", {
    parser: "ts",
});
