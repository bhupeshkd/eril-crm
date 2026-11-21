import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET') || 'eril-dev-secret',
    });
  }

  async validate(payload: JwtPayload) {
    if (!payload || !payload.sub) {
      throw new UnauthorizedException('Invalid token payload');
    }
    return {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role,
      emailVerified: payload.emailVerified,
      mfaEnabled: payload.mfaEnabled,
      currentOrganizationId: payload.currentOrganizationId,
      currentWorkspaceId: payload.currentWorkspaceId,
      workspaceMemberships: payload.workspaceMemberships,
      permissions: payload.permissions ?? [],
    };
  }
}
