import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: webhook signatures (e.g. Meta's) are computed over the exact bytes received.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const port = Number(process.env.API_PORT || 3001);
  const prefix = process.env.API_GLOBAL_PREFIX || 'api/v1';

  app.setGlobalPrefix(prefix);
  app.enableCors({
    origin: process.env.APP_URL || 'http://localhost:3000',
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
