/**
 * Copyright (c) VA360 LABS S.L.
 * SPDX-License-Identifier: LicenseRef-Didacta-Sustainable-Use
 */

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { resolveWebBaseUrl } from '../common/resolve-web-base-url';
import type { AdminActor } from '../auth/admin-actor';
import { extractClientContext } from '../auth/client-context';
import { AllowProvisioning, CurrentUser } from '../auth/decorators';
import { JwtOrProvisioningGuard } from '../auth/jwt-or-provisioning.guard';
import type { SessionClaims } from '../auth/token.service';
import { ZodValidationPipe } from '../auth/zod-validation.pipe';
import { AdminTenantsService, type TenantUsageItem } from './admin-tenants.service';

// Los schemas de las rutas de la lista blanca se exportan para que
// `tests/contract/admin-tenants.contract.test.ts` fije la forma de la petición
// —nombres de campo incluidos— sin duplicarla a mano. Míralo antes de
// tocarlos: son contrato con `didacta-cloud`.
export const createTenantSchema = z.object({
  slug: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  adminEmail: z.string().email().max(200),
  adminName: z.string().min(1).max(120).optional(),
  primaryHostname: z.string().min(1).max(253),
});
type CreateTenantDto = z.infer<typeof createTenantSchema>;

export const setStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']),
});
type SetStatusDto = z.infer<typeof setStatusSchema>;

const renameSchema = z.object({
  name: z.string().min(1).max(120),
});
type RenameDto = z.infer<typeof renameSchema>;

export const domainSchema = z.object({
  hostname: z.string().min(1).max(253),
});
type DomainDto = z.infer<typeof domainSchema>;

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
 * Resuelve quién está actuando: la máquina si la petición trajo credencial de
 * provisioning, y si no, la persona —a la que se le sigue exigiendo
 * super_admin—.
 *
 * `req.provisioningActor` solo puede estar puesto si `JwtOrProvisioningGuard`
 * validó la credencial Y el handler lleva `@AllowProvisioning()`; la lista
 * blanca no se re-comprueba aquí a propósito, para que exista un solo sitio
 * donde ampliarla.
 */
function requireAdminActor(user: SessionClaims | undefined, req: FastifyRequest): AdminActor {
  const machine = req.provisioningActor;
  if (machine) return { kind: 'provisioning', credentialId: machine.credentialId };
  return { kind: 'user', userId: requireSuperAdmin(user).sub };
}

@ApiTags('Admin · Tenants')
@ApiBearerAuth()
@Controller('admin/tenants')
@UseGuards(JwtOrProvisioningGuard)
export class AdminTenantsController {
  constructor(private readonly service: AdminTenantsService) {}

  @Get()
  @AllowProvisioning()
  @ApiOperation({
    summary: 'Listar todos los tenants. Solo super_admin o credencial de provisioning.',
  })
  async list(@Req() req: FastifyRequest, @CurrentUser() user: SessionClaims | undefined) {
    requireAdminActor(user, req);
    return this.service.list();
  }

  @Get('capacity')
  @ApiOperation({
    summary:
      '11º piloto License SDK — informa cuántos tenants hay y si la licencia EE permite crear más (feat:multi_tenant.real). Solo super_admin.',
  })
  async capacity(@CurrentUser() user: SessionClaims | undefined) {
    requireSuperAdmin(user);
    return this.service.getCapacityInfo();
  }

  // OJO: `usage` va ANTES de `:id`, igual que `capacity`. Al revés, Fastify
  // resolvería `/admin/tenants/usage` con el handler de `:id` e intentaría
  // buscar un tenant llamado "usage".
  @Get('usage')
  @AllowProvisioning()
  @ApiOperation({
    summary:
      'Miembros activos por tenant a una fecha de corte. Solo super_admin o credencial de provisioning.',
    description: [
      'Fuente de verdad del consumo por tenant. **La definición es contractual**: es la',
      'misma que aparece en la página de precios de Didacta Cloud, y sobre ella se',
      'calcula el tramo que paga cada cliente.',
      '',
      '**Cuenta**: usuario con acceso al aula, activo y no borrado.',
      '',
      '**No cuenta**: administradores del tenant (`tenant_admin`, `super_admin`),',
      'invitaciones nunca aceptadas (`PENDING`), suspendidos (`SUSPENDED`), bajas',
      '(`DEACTIVATED`) y borrados lógicos.',
      '',
      'Formadores, auditores y gestores de empresa **sí** cuentan: consumen la',
      'plataforma igual que un alumno.',
      '',
      '`asOf` es una fecha ISO-8601 opcional; por defecto, ahora. Una fecha futura',
      'devuelve 400 — no se factura sobre un consumo que aún no ha ocurrido.',
    ].join('\n'),
  })
  async usage(
    @Req() req: FastifyRequest,
    @CurrentUser() user: SessionClaims | undefined,
    @Query('asOf') asOf?: string,
  ): Promise<TenantUsageItem[]> {
    requireAdminActor(user, req);
    let cutoff: Date | undefined;
    if (asOf !== undefined && asOf !== '') {
      cutoff = new Date(asOf);
      if (Number.isNaN(cutoff.getTime())) {
        throw new BadRequestException({
          message: 'El parámetro asOf no es una fecha ISO-8601 válida.',
          code: 'ADMIN_TENANT_USAGE_ASOF_INVALID',
        });
      }
    }
    return this.service.getUsage(cutoff);
  }

  @Get(':id')
  @AllowProvisioning()
  @ApiOperation({ summary: 'Detalle de un tenant. Solo super_admin o credencial de provisioning.' })
  async getOne(
    @Req() req: FastifyRequest,
    @CurrentUser() user: SessionClaims | undefined,
    @Param('id') id: string,
  ) {
    requireAdminActor(user, req);
    return this.service.getDetail(id);
  }

  @Post()
  @AllowProvisioning()
  @ApiOperation({
    summary:
      'Crear tenant + primer tenant_admin + dominio primario. Envía email de bienvenida con link de definir contraseña.',
  })
  async create(
    @Req() req: FastifyRequest,
    @CurrentUser() user: SessionClaims | undefined,
    @Body(new ZodValidationPipe(createTenantSchema)) dto: CreateTenantDto,
  ) {
    const actor = requireAdminActor(user, req);
    // Sin escalón TenantDomain: el tenant que se está creando aún no tiene
    // fila en esa tabla (se crea DENTRO de service.create). Cascada normal:
    // env → Host del request → localhost.
    const webBaseUrl = resolveWebBaseUrl(req);
    return this.service.create(actor, dto, webBaseUrl, extractClientContext(req));
  }

  @Patch(':id/status')
  @AllowProvisioning()
  @ApiOperation({
    summary: 'Cambiar estado del tenant. SUSPENDED/ARCHIVED invalidan sessions de todos los users.',
  })
  async setStatus(
    @Req() req: FastifyRequest,
    @CurrentUser() user: SessionClaims | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setStatusSchema)) dto: SetStatusDto,
  ) {
    const actor = requireAdminActor(user, req);
    return this.service.setStatus(actor, id, dto.status, extractClientContext(req));
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Renombrar tenant (`tenant.name`). Afecta firma de emails ("Equipo {name}") y sidebar. Solo super_admin.',
  })
  async rename(
    @Req() req: FastifyRequest,
    @CurrentUser() user: SessionClaims | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(renameSchema)) dto: RenameDto,
  ) {
    // Sin `@AllowProvisioning()` a propósito: renombrar un tenant es una
    // decisión de negocio del operador humano, no una operación de
    // aprovisionamiento. Cada ruta que no está en la lista blanca es una
    // puerta que la credencial de máquina no abre.
    const u = requireSuperAdmin(user);
    return this.service.rename(
      { kind: 'user', userId: u.sub },
      id,
      dto.name,
      extractClientContext(req),
    );
  }

  @Post(':id/domains')
  @AllowProvisioning()
  @ApiOperation({ summary: 'Añadir dominio adicional al tenant.' })
  async addDomain(
    @Req() req: FastifyRequest,
    @CurrentUser() user: SessionClaims | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(domainSchema)) dto: DomainDto,
  ) {
    const actor = requireAdminActor(user, req);
    return this.service.addDomain(actor, id, dto.hostname, extractClientContext(req));
  }

  @Delete(':id/domains/:hostname')
  @AllowProvisioning()
  @ApiOperation({ summary: 'Quitar dominio del tenant. No permite quitar el primario.' })
  async removeDomain(
    @Req() req: FastifyRequest,
    @CurrentUser() user: SessionClaims | undefined,
    @Param('id') id: string,
    @Param('hostname') hostname: string,
  ) {
    const actor = requireAdminActor(user, req);
    return this.service.removeDomain(actor, id, hostname, extractClientContext(req));
  }
}
