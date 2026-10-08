import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import eslint from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
import eslintPluginPrettier from 'eslint-plugin-prettier/recommended'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const autoImportGlobals = JSON.parse(
  readFileSync(fileURLToPath(new URL('./.eslintrc-auto-import.json', import.meta.url)), 'utf8'),
).globals

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'public/**',
      'src/assets/**',
      'build/**',
      'node_modules/**',
      'src/auto-imports.d.ts',
      'src/components.d.ts',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,vue}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...autoImportGlobals,
      },
    },
  },
  {
    files: ['**/*.{ts,mts,cts,vue}'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
      },
    },
  },
  {
    rules: {
      'no-console': 'off',
      'no-plusplus': 'off',
      'no-shadow': 'off',
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-underscore-dangle': 'off',
      'no-use-before-define': 'off',
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-param-reassign': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-redeclare': 'off',
      '@typescript-eslint/no-redeclare': 'error',
      camelcase: 'off',
      'no-void': 'off',
    },
  },
  eslintPluginPrettier,
  eslintConfigPrettier,
)
