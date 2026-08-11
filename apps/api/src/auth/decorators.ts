/**
 * Copyright (c) VA360 LABS S.L.
 * SPDX-License-Identifier: LicenseRef-Didacta-Sustainable-Use
 */

import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { MFA_EXEMPT_KEY, PUBLIC_ROUTE_KEY, REQUIRES_MFA_KEY } from './jwt-auth.guard';
import { ALLOW_PROVISIONING_KEY } from './jwt-or-provisioning.guard';
import type { SessionClaims } from './token.service';

export const Public = () => SetMetadata(PUBLIC_ROUTE_KEY, true);
export const RequiresMfa = () => SetMetadata(REQUIRES_MFA_KEY, true);

/**
 * Marca una ruta como exenta del enforcement automático de MFA para roles
 * admin. Sólo debería aplicarse a endpoints estrictamente necesarios para
 * que un admin sin mfaVerified pueda completar el setup/verify (los del
 * propio flujo MFA + perfil mínimo). NO usar en ningún endpoint con
 * efectos de negocio.
 */
export const MfaExempt = () => SetMetadata(MFA_EXEMPT_KEY, true);

/**
 * Abre este handler a la credencial de provisioning (`JwtOrProvisioningGuard`).
 *
 * Es la lista blanca del plano de control, y está pensada para quedarse corta:
 * la credencial no tiene tenant ni usuario, así que cada ruta marcada aquí es
 * una operación que una máquina puede hacer sobre TODA la instalación. Antes de
 * añadir una, pregúntate si el plano de control se rompe sin ella.
 *
 * `tests/provisioning-credential-surface.test.ts` recorre todas las rutas
 * `admin/*` registradas y falla si aparece una marcada que no esté en la lista
 * declarada allí — ensanchar el alcance exige tocar el test a propósito.
 */
export const AllowProvisioning = () => SetMetadata(ALLOW_PROVISIONING_KEY, true);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionClaims | undefined => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest>();
    return request.user;
  },
);
