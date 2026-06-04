/** @type {import('@commitlint/types').UserConfig} */
const SCOPES = [
  "ui",
  "api",
  "wasm",
  "electron",
  "build",
  "ci",
  "deps",
  "config",
  "docker",
  "algo",
  "db",
  "test",
];

const config = {
  parserPreset: {
    parserOpts: {
      // [type] subject | [type][scope] subject | [type](scope) subject
      headerPattern: /^\[(\w+)\](?:\[(\w+)\]|\((\w+)\))?\s(.+)$/,
      headerCorrespondence: ["type", "scope", "scope", "subject"],
    },
  },
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "chore",
        "misc",
        "docs",
        "refactor",
        "test",
        "ci",
        "build",
        "perf",
        "style",
      ],
    ],
    "scope-enum": [2, "always", SCOPES],
    "scope-empty": [0],
    "subject-empty": [2, "never"],
    "header-max-length": [2, "always", 100],
  },
};

export default config;
