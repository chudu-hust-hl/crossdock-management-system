import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AppConfig } from '../../config/configuration';
import { UsersModule } from '../users/users.module';
import { ACCESS_TOKEN_TTL_SECONDS } from './auth.constants';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * Login, and the one JWT configuration of the app. `JwtModule` is global so that
 * `AuthGuard` can verify tokens in every module that imports `UsersModule`.
 */
@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => ({
        secret: configService.get('jwtSecret', { infer: true }),
        signOptions: { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
