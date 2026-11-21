import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { User } from '../database/entities/user.entity';
import { Session } from '../database/entities/session.entity';
import { WorkspaceMember } from '../database/entities/workspace-member.entity';
import { Organization } from '../database/entities/organization.entity';
import { Workspace } from '../database/entities/workspace.entity';
import { Role } from '../database/entities/role.entity';
import { RolePermission } from '../database/entities/permission.entity';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Session,
      WorkspaceMember,
      Organization,
      Workspace,
      Role,
      RolePermission,
    ]),
    PassportModule,
    // registerAsync: read the secret after ConfigModule has loaded .env,
    // so signing and JwtStrategy verification use the same key.
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET') || 'eril-dev-secret',
        signOptions: { expiresIn: config.get<string>('JWT_ACCESS_TTL') || '15m' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
