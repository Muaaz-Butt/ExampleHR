import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { TimeOffModule } from './time-off/time-off.module';
import { CommonModule } from './common/common.module';
import { HcmModule } from './hcm/hcm.module';
import { TimeOffRequest } from './time-off/entities/time-off-request.entity';
import { Balance } from './time-off/entities/balance.entity';

const isProduction = process.env.NODE_ENV === 'production';

export function validateEnvironment(config: Record<string, string>) {
  if (!config.HCM_API_BASE_URL) {
    throw new Error('Missing required environment variable: HCM_API_BASE_URL');
  }
  return config;
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: validateEnvironment,
    }),
    CommonModule,
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: process.env.SQLITE_DB_PATH || 'data/sqlite.db',
      entities: [TimeOffRequest, Balance],
      synchronize: !isProduction,
      logging: false,
      autoLoadEntities: true,
    }),
    TimeOffModule,
    HcmModule,
  ],
})
export class AppModule {}
