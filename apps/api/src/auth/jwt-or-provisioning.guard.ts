/**
 * Copyright (c) VA360 LABS S.L.
 * SPDX-License-Identifier: LicenseRef-Didacta-Sustainable-Use
 */

import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { JwtAuthGuard, PUBLIC_ROUTE_KEY } from './jwt-auth.guard';
import {
  ProvisioningCredentialService,
  type ProvisioningActor,
} from './provisioning-credential.service';

/** Esquema del header: `Authorization: Provisioning <token>`. */
const SCHEME = 'Provisioning ';

export const ALLOW_PROVISIONING_KEY = 'allowProvisioning';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Actor de MÁQUINA. Se popula solo cuando la petición llegó con una
     * credencial de provisioning válida. Deliberadamente separado de `user`:
     * no hay usuario ni tenant que inventar, y los interceptores globales que
     * miran `user.sub` (estado de cuenta, restricciones) se saltan solos.
     */
    provisioningActor?: ProvisioningActor;
  }
}

/**
 * Guard de las rutas que un plano de control externo necesita operar.
 *
 * Acepta dos cosas:
 *
 *  - `Authorization: Bearer <jwt>` — delega ENTERO en `JwtAuthGuard`. No
 *    reimplementa nada: si lo hiciera, las rutas que cambien a este guard
 *    perderían el enforcement de MFA por rol, que vive allí.
 *  - `Authorization: Provisioning <token>` — credencial de instancia
 *    (`ProvisioningCredentialService`). Solo vale en los handlers marcados
 *    con `@AllowProvisioning()`.
 *
 * El orden importa: primero se valida la credencial (401 si no vale, mire
 * donde mire) y después la lista blanca (403 si la credencial es buena pero la
 * ruta no está abierta a máquinas). Así el 403 solo puede llegar a quien ya
 * tiene una credencial válida, y no sirve para enumerar rutas.
 */
@Injectable()
export class JwtOrProvisioningGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtAuthGuard,
    private readonly credentials: ProvisioningCredentialService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const authHeader = request.headers['authorization'];

    if (typeof authHeader === 'string' && authHeader.startsWith(SCHEME)) {
      const actor = await this.credentials.verify(authHeader.slice(SCHEME.length).trim());
      if (!actor) {
        throw new UnauthorizedException({
          message: 'Credencial de provisioning inválida o revocada.',
          code: 'AUTH_PROVISIONING_CREDENTIAL_INVALID',
        });
      }

      const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_PROVISIONING_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowed) {
        throw new ForbiddenException({
          message:
            'La credencial de provisioning no autoriza esta ruta. Su alcance es la lista blanca de operaciones sobre tenants.',
          code: 'AUTH_PROVISIONING_ROUTE_NOT_ALLOWED',
        });
      }

      request.provisioningActor = actor;
      return true;
    }

    return this.jwt.canActivate(context);
  }
}
