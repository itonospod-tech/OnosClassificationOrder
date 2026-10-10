import react from '@onosfactory/eslint-config/react';
import tseslint from 'typescript-eslint';

// Build output only. `.eslintignore` is dead from ESLint 9 on, so every ignore has to live here or the
// generated files get linted: a stray `.next/` (Next.js output, git-ignored) alone produced 429 errors.
export default tseslint.config({ ignores: ['dist/**', 'dist-prod/**', 'dev-dist/**', 'public/**', '.next/**', 'coverage/**'] }, ...react);
