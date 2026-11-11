// Jest as Stryker runs it: the same suite under Stryker's instrumented environment, which is what
// lets `coverageAnalysis: "perTest"` map each mutant to the tests that cover it.
const base = require('./jest.config.js');

module.exports = {
  ...base,
  testEnvironment: '@stryker-mutator/jest-runner/jest-env/node',
};
