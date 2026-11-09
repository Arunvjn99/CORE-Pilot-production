import { createConfig } from '@core-studio/config/eslint';
// The template is customer app source: linted by its own build check, not by the platform rules.
export default [
  { ignores: ['template/**', '.generated/**'] },
  ...createConfig(import.meta.dirname),
];
