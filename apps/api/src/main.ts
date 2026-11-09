import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { loadConfig } from './config/env.js';

const config = loadConfig();
const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
  bufferLogs: true,
});
configureApp(app, config);
await app.listen(config.PORT, '0.0.0.0');
