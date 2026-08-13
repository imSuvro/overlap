/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'time',
        'crdt',
        'protocol',
        'room-core',
        'web',
        'edge',
        'dev-server',
        'e2e',
        'ci',
        'docs',
        'repo',
      ],
    ],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [0],
  },
};
