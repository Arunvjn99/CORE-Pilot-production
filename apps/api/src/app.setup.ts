import { type INestApplication, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import type { AppConfig } from './config/env.js';

/** Single place for HTTP hardening so tests exercise exactly what production runs. */
export function configureApp(app: NestExpressApplication, config: AppConfig): INestApplication {
  app.useLogger(app.get(Logger));
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY_HOPS);
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      strictTransportSecurity:
        config.NODE_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );
  app.enableCors({
    origin: config.CORS_ALLOWED_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    maxAge: 600,
  });
  app.enableShutdownHooks();

  if (config.API_DOCS_ENABLED) {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('CORE AI Design Studio API')
        .setVersion(config.SERVICE_VERSION)
        .build(),
    );
    SwaggerModule.setup('api/docs', app, doc);
  }
  return app;
}
