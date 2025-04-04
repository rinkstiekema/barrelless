// For a detailed explanation regarding each configuration property, visit:
// https://jestjs.io/docs/en/configuration.html

module.exports = {
    collectCoverage: true,
    collectCoverageFrom: ["src/**/*", "!src/**/__testfixtures__/**/*", "!src/**/*.input.{ts,js}"],
    coverageDirectory: "reports/coverage",
    coverageReporters: ["text", "html"],

    // An object that configures minimum threshold enforcement for coverage results
    // coverageThreshold: undefined,
    coverageThreshold: {
        global: {
            branches: 80,
            functions: 80,
            lines: 80,
            statements: 80,
        },
    },

    preset: "ts-jest",
    testEnvironment: "node",
    watchPathIgnorePatterns: [".*jest-stare.*\\.js", "reports"],
};