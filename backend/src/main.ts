import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { DomainsService } from './sites/domains';

async function bootstrap() {
  // rawBody: webhook signatures (e.g. Meta's) are computed over the exact bytes received.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const port = Number(process.env.API_PORT || 3001);
  const prefix = process.env.API_GLOBAL_PREFIX || 'api/v1';

  app.setGlobalPrefix(prefix);
  // The app's own origin is always allowed; verified custom domains (agency app domains and
  // site domains) are looked up so a white-label login or a published site can call the API.
  const appOrigin = new URL(process.env.APP_URL || 'http://localhost:3000').origin;
  const domains = app.get(DomainsService);
  app.enableCors({
    origin: (origin, cb) => {
      if (!origin || origin === appOrigin) return cb(null, true);
      domains.isAllowedOrigin(origin).then((ok) => cb(null, ok), () => cb(null, false));
    },
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(port);
  Logger.log(`ERIL API listening on http://localhost:${port}/${prefix}`);
}
bootstrap();
