import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RuntimeClient } from '../gateway/runtime-client.js';
import { LlmSettingsService } from './llm-settings.service.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { CredentialsController, PlatformCredentialsController } from './credentials.controller.js';
import { CredentialsService } from './credentials.service.js';
import { createKeyWrapper, KEY_WRAPPER } from './crypto/key-wrapper.provider.js';

@Module({
  imports: [AuthModule],
  controllers: [CredentialsController, PlatformCredentialsController],
  providers: [
    CredentialsService,
    LlmSettingsService,
    RuntimeClient,
    {
      provide: KEY_WRAPPER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createKeyWrapper(config),
    },
  ],
})
export class CredentialsModule {}
