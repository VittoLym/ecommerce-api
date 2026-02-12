import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
const cookieParser = require('cookie-parser');
import 'dotenv/config';

const config = new DocumentBuilder()
  .setTitle('Ecommerce API')
  .setDescription('Professional ecommerce backend with payments and observability')
  .setVersion('1.0')
  .addBearerAuth()
  .build();
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);
  app.use(cookieParser());
  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
