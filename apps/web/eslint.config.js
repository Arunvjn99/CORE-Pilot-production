import reactHooks from 'eslint-plugin-react-hooks';
import { createConfig } from '@core-studio/config/eslint';

export default [
  ...createConfig(import.meta.dirname),
  { ignores: ['playwright-report/**', 'test-results/**'] },
  reactHooks.configs.flat.recommended,
];
