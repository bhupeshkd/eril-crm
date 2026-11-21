import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { DeveloperService } from '../../developer/developer';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly developer: DeveloperService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    // Public REST API: `x-api-key: eril_...` authenticates as a workspace-scoped key.
    const req = context.switchToHttp().getRequest();
    const apiKey = req.headers['x-api-key'];
    if (apiKey) {
      const user = await this.developer.authenticate(String(apiKey));
      if (!user) throw new UnauthorizedException('Invalid or revoked API key');
      req.user = user;
      return true;
    }
    return super.canActivate(context) as Promise<boolean>;
  }

  handleRequest(err: any, user: any) {
    if (err || !user) {
      throw err || new UnauthorizedException('Authentication required');
    }
    return user;
  }
}
