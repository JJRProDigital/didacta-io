/**
 * Copyright (c) VA360 LABS S.L.
 * SPDX-License-Identifier: LicenseRef-Didacta-Sustainable-Use
 */

import {
  Controller,
  Delete,
  ForbiddenException,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  ProvisioningCredentialService,
  type IssuedProvisioningCredential,
} from '../auth/provisioning-credential.service';
import type { SessionClaims } from '../auth/token.service';

function requireSuperAdmin(user: SessionClaims | undefined): SessionClaims {
  if (!user) throw new UnauthorizedException();
  if (!user.roles.includes('super_admin')) {
    throw new ForbiddenException({
      message: 'Esta acción requiere rol super_admin.',
      code: 'ADMIN_FORBIDDEN_SUPER_ADMIN_REQUIRED',
    });
  }
  return user;
}

/**
 * Emisión y revocación de la credencial de provisioning de la instancia.
 *
 * Va con `JwtAuthGuard` a secas, NO con `JwtOrProvisioningGuard`: la credencial
 * no puede emitirse a sí misma una nueva ni revocar la suya. Quien controla el
 * acceso de una máquina es siempre una persona con sesión.
 */
@ApiTags('Admin · Provisioning')
@ApiBearerAuth()
@Controller('admin/provisioning-credential')
@UseGuards(JwtAuthGuard)
export class AdminProvisioningController {
  constructor(private readonly credentials: ProvisioningCredentialService) {}

  @Post()
  @ApiOperation({
    summary: 'Emitir la credencial de provisioning de la instancia. Solo super_admin.',
    description: [
      'Devuelve el token en plano **una sola vez**: no se guarda en ninguna parte,',
      'solo su SHA-256 cifrado en `core_instance_setting`. Si se pierde, se emite',
      'otra.',
      '',
      'Emitir una nueva **revoca la anterior** — la instancia tiene como mucho una',
      'credencial viva.',
      '',
      'Se usa con `Authorization: Provisioning <token>` y solo abre la lista blanca',
      'de operaciones sobre tenants (listar, ver, crear, cambiar estado, dominios y',
      'consumo). No sustituye a una sesión de super_admin.',
    ].join('\n'),
  })
  async issue(
    @CurrentUser() user: SessionClaims | undefined,
  ): Promise<IssuedProvisioningCredential> {
    const u = requireSuperAdmin(user);
    return this.credentials.issue(u.sub);
  }

  @Delete()
  @ApiOperation({
    summary: 'Revocar la credencial de provisioning viva. Solo super_admin.',
    description:
      'Idempotente. En una instalación de un proceso corta ya en la petición siguiente; con varias réplicas, como mucho 60 s después en las demás.',
  })
  async revoke(
    @CurrentUser() user: SessionClaims | undefined,
  ): Promise<{ revoked: boolean; id: string | null }> {
    const u = requireSuperAdmin(user);
    return this.credentials.revoke(u.sub);
  }
}
