module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.ts", "**/src/**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  testTimeout: 30000,
};
