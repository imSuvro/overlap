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
    /*
     * `sentence-case` is dropped from the default set, the rest kept.
     *
     * The check is a heuristic on the whole subject and cannot tell a proper noun from prose
     * capitalisation, so it rejects "React client, design system…" exactly as it would reject
     * "Added the client". Subjects here legitimately begin with React, Cloudflare, Zod or Node.
     * Start-case and upper-case are still refused, which is the part that catches shouting and
     * Title Casing.
     */
    'subject-case': [2, 'never', ['start-case', 'pascal-case', 'upper-case']],
  },
};
