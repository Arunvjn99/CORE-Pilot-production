import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { CredentialsController, PlatformCredentialsController } from './credentials.controller.js';
import { CredentialsService } from './credentials.service.js';
import { createKeyWrapper, KEY_WRAPPER } from './crypto/key-wrapper.provider.js';

@Module({
  controllers: [CredentialsController, PlatformCredentialsController],
  providers: [
    CredentialsService,
    {
      provide: KEY_WRAPPER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createKeyWrapper(config),
    },
  ],
})
export class CredentialsModule {}
