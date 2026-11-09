import { Global, Module } from '@nestjs/common';
import type { AppConfig } from './env.js';

export const APP_CONFIG = Symbol('APP_CONFIG');

@Global()
@Module({})
export class ConfigModule {
  static forRoot(config: AppConfig) {
    return {
      module: ConfigModule,
      providers: [{ provide: APP_CONFIG, useValue: Object.freeze(config) }],
      exports: [APP_CONFIG],
    };
  }
}
