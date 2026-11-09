import { createConfig } from '@core-studio/config/eslint';

export default [
  ...createConfig(import.meta.dirname),
  {
    // NestJS DI needs runtime class references for constructor parameters.
    languageOptions: {
      parserOptions: { emitDecoratorMetadata: true, experimentalDecorators: true },
    },
  },
];
