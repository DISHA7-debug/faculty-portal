import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

/**
 * Flat config, consumed directly.
 *
 * The create-next-app scaffold wrapped these in `FlatCompat` from @eslint/eslintrc to
 * bridge the old .eslintrc format. eslint-config-next 16 publishes real flat configs,
 * and that compat bridge crashes outright on ESLint 10 ("Converting circular structure
 * to JSON"), so it is gone. Do not reintroduce FlatCompat.
 */
const eslintConfig = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      'prisma/migrations/**',
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
];

export default eslintConfig;
