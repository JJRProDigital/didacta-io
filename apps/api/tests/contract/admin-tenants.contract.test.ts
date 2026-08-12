/**
 * Copyright (c) VA360 LABS S.L.
 * SPDX-License-Identifier: LicenseRef-Didacta-Sustainable-Use
 *
 * ============================================================================
 * CONTRATO CON `didacta-cloud` — UC-C104
 * ============================================================================
 *
 * Estas siete operaciones son las que un plano de control externo consume para
 * dar de alta, operar y facturar tenants. **Romperlas es un breaking change**:
 * no basta con que la suite siga verde aquí, hay que coordinar el cambio con
 * `didacta-cloud` (y con cualquier self-hoster que automatice su instalación)
 * antes de mergear.
 *
 * Lo que se fija: la ruta y el verbo, los nombres de campo de la petición, los
 * nombres de campo de la respuesta y los códigos de error. No solo los status
 * codes: un cliente se rompe igual si `activeMembers` pasa a llamarse
 * `active_members` que si el endpoint desaparece.
 *
 * Sustituye al shadow build cross-repo de abril, que necesitaba un PAT y
 * permisos de organización que nunca llegaron a funcionar, y que además solo
 * hacía `tsc --noEmit || echo warning`. Este test corre en cada PR, sin
 * secretos y sin acceso a ningún otro repositorio.
 *
 * Si añades un campo NUEVO opcional a una respuesta, actualiza la lista de
 * abajo: crecer el contrato está bien, encogerlo o renombrarlo no.
 */

import { LicenseService } from '@didacta/license-sdk';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AdminTenantsController,
  createTenantSchema,
  domainSchema,
  setStatusSchema,
  signupsSchema,
} from '../../src/admin/admin-tenants.controller';
import { SIGNUPS_FROZEN_CODE } from '../../src/tenancy/signup-freeze';
import { AdminTenantsService } from '../../src/admin/admin-tenants.service';

const ACTOR = { kind: 'user' as const, userId: 'user-super-1' };
const TENANT_ID = '99999999-8888-7777-6666-555555555555';

/** Las 7 operaciones del contrato: verbo + ruta relativa al controller. */
const CONTRACT_ROUTES: Array<{ handler: string; method: number; path: string }> = [
  { handler: 'list', method: RequestMethod.GET, path: '/' },
  { handler: 'usage', method: RequestMethod.GET, path: 'usage' },
  { handler: 'getOne', method: RequestMethod.GET, path: ':id' },
  { handler: 'create', method: RequestMethod.POST, path: '/' },
  { handler: 'setStatus', method: RequestMethod.PATCH, path: ':id/status' },
  { handler: 'setSignups', method: RequestMethod.PATCH, path: ':id/signups' },
  { handler: 'addDomain', method: RequestMethod.POST, path: ':id/domains' },
  { handler: 'removeDomain', method: RequestMethod.DELETE, path: ':id/domains/:hostname' },
];

/** Respuesta de `list`, `getOne`, `create`, `setStatus`, `addDomain` y `removeDomain`. */
const TENANT_ITEM_FIELDS = [
  'id',
  'slug',
  'name',
  'status',
  'createdAt',
  'domains',
  'userCount',
  'courseCount',
];
const TENANT_DOMAIN_FIELDS = ['hostname', 'isPrimary', 'isVerified'];

/** Respuesta de `usage`. Es la que sostiene la facturación por tramos. */
const TENANT_USAGE_FIELDS = ['tenantId', 'slug', 'activeMembers', 'asOf'];

const TENANT_ROW = {
  id: TENANT_ID,
  slug: 'acme',
  name: 'Acme Corp',
  status: 'ACTIVE' as const,
  createdAt: new Date('2026-01-15T10:00:00.000Z'),
  domains: [{ hostname: 'acme.didacta.io', isPrimary: true, isVerified: true }],
  _count: { users: 12 },
};

function makePrisma() {
  return {
    tenant: {
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(TENANT_ROW),
      findMany: vi.fn().mockResolvedValue([TENANT_ROW]),
      update: vi.fn().mockResolvedValue(TENANT_ROW),
    },
    tenantDomain: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    role: { findUnique: vi.fn().mockResolvedValue({ id: 'role-tenant-admin' }) },
    user: { groupBy: vi.fn().mockResolvedValue([{ tenantId: TENANT_ID, _count: { id: 7 } }]) },
    modCoursesCourse: {
      count: vi.fn().mockResolvedValue(3),
      groupBy: vi.fn().mockResolvedValue([{ tenantId: TENANT_ID, _count: { id: 3 } }]),
    },
    $transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        tenant: { create: vi.fn().mockResolvedValue({ id: TENANT_ID }), update: vi.fn() },
        tenantDomain: { create: vi.fn().mockResolvedValue({}) },
        user: { create: vi.fn().mockResolvedValue({ id: 'user-admin-1' }) },
        userRole: { create: vi.fn().mockResolvedValue({}) },
        session: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      }),
    ),
  };
}

/** Código de error de una excepción de Nest, o null si no la lanzó. */
async function errorCodeOf(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (err) {
    const response = (err as { response?: { code?: string } }).response;
    return response?.code ?? null;
  }
}

describe('CONTRATO · admin/tenants ↔ didacta-cloud', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: AdminTenantsService;

  beforeEach(async () => {
    prisma = makePrisma();
    const license = new LicenseService();
    await license.load({ allowDevBypass: true, key: 'dev-key' });
    service = new AdminTenantsService(
      ...([
        prisma,
        { record: vi.fn().mockResolvedValue(undefined) },
        { requestAndSendEmail: vi.fn().mockResolvedValue(undefined) },
        license,
        { warn: vi.fn(), log: vi.fn(), error: vi.fn(), debug: vi.fn() },
      ] as unknown as ConstructorParameters<typeof AdminTenantsService>),
    );
  });

  describe('rutas', () => {
    it('el controller cuelga de admin/tenants', () => {
      expect(Reflect.getMetadata(PATH_METADATA, AdminTenantsController)).toBe('admin/tenants');
    });

    it.each(CONTRACT_ROUTES)('$handler → $path', ({ handler, method, path }) => {
      const fn = (AdminTenantsController.prototype as unknown as Record<string, unknown>)[handler];
      expect(fn, `falta el handler ${handler}`).toBeTypeOf('function');
      expect(Reflect.getMetadata(PATH_METADATA, fn as object)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, fn as object)).toBe(method);
    });

    it('`usage` se declara antes que `:id` — al revés, Fastify buscaría un tenant llamado "usage"', () => {
      const orden = Object.getOwnPropertyNames(AdminTenantsController.prototype);
      expect(orden.indexOf('usage')).toBeLessThan(orden.indexOf('getOne'));
    });
  });

  describe('petición', () => {
    it('crear tenant acepta exactamente estos campos', () => {
      const body = {
        slug: 'acme',
        name: 'Acme Corp',
        adminEmail: 'admin@acme.io',
        adminName: 'Admin',
        primaryHostname: 'acme.didacta.io',
      };
      expect(createTenantSchema.parse(body)).toEqual(body);
      expect(Object.keys(createTenantSchema.shape).sort()).toEqual(
        ['slug', 'name', 'adminEmail', 'adminName', 'primaryHostname'].sort(),
      );
    });

    it('`adminName` es el único opcional al crear', () => {
      const sinAdminName = {
        slug: 'acme',
        name: 'Acme Corp',
        adminEmail: 'admin@acme.io',
        primaryHostname: 'acme.didacta.io',
      };
      expect(createTenantSchema.safeParse(sinAdminName).success).toBe(true);
      for (const campo of ['slug', 'name', 'adminEmail', 'primaryHostname']) {
        const incompleto: Record<string, unknown> = { ...sinAdminName };
        delete incompleto[campo];
        expect(
          createTenantSchema.safeParse(incompleto).success,
          `${campo} debe ser obligatorio`,
        ).toBe(false);
      }
    });

    it('cambiar estado acepta los tres valores del enum y ninguno más', () => {
      for (const status of ['ACTIVE', 'SUSPENDED', 'ARCHIVED']) {
        expect(setStatusSchema.safeParse({ status }).success).toBe(true);
      }
      expect(setStatusSchema.safeParse({ status: 'DELETED' }).success).toBe(false);
      expect(setStatusSchema.safeParse({ status: 'active' }).success).toBe(false);
    });

    it('congelar altas lleva `frozen` y un `reason` obligatorio', () => {
      // El motivo se le enseña a quien se queda fuera, así que no es opcional:
      // «no admite altas» a secas no le dice nada a un alumno que quería entrar.
      expect(signupsSchema.parse({ frozen: true, reason: 'Cohorte completa.' })).toEqual({
        frozen: true,
        reason: 'Cohorte completa.',
      });
      expect(signupsSchema.safeParse({ frozen: true }).success).toBe(false);
      expect(signupsSchema.safeParse({ frozen: true, reason: 'no' }).success).toBe(false);
      expect(Object.keys(signupsSchema.shape).sort()).toEqual(['frozen', 'reason']);
    });

    it('el código que devuelven las cuatro puertas congeladas es estable', () => {
      // Cloud y el propio LMS lo distinguen de cualquier otro 409. Cambiarlo
      // rompe a los dos.
      expect(SIGNUPS_FROZEN_CODE).toBe('TENANT_SIGNUPS_FROZEN');
    });

    it('añadir dominio lleva `hostname`', () => {
      expect(domainSchema.parse({ hostname: 'otro.didacta.io' })).toEqual({
        hostname: 'otro.didacta.io',
      });
      expect(Object.keys(domainSchema.shape)).toEqual(['hostname']);
    });
  });

  describe('respuesta', () => {
    it('list devuelve los campos del contrato, con `createdAt` en ISO-8601', async () => {
      const [item] = await service.list();
      expect(item).toBeDefined();
      expect(Object.keys(item!).sort()).toEqual([...TENANT_ITEM_FIELDS].sort());
      expect(item!.createdAt).toBe('2026-01-15T10:00:00.000Z');
      expect(Object.keys(item!.domains[0]!).sort()).toEqual([...TENANT_DOMAIN_FIELDS].sort());
      expect(item!.userCount).toBe(12);
      expect(item!.courseCount).toBe(3);
    });

    it('getDetail devuelve la misma forma que list', async () => {
      const detail = await service.getDetail(TENANT_ID);
      expect(Object.keys(detail).sort()).toEqual([...TENANT_ITEM_FIELDS].sort());
    });

    it('usage devuelve tenantId, slug, activeMembers y el corte aplicado', async () => {
      const asOf = new Date('2026-02-01T00:00:00.000Z');
      const [row] = await service.getUsage(asOf);
      expect(row).toBeDefined();
      expect(Object.keys(row!).sort()).toEqual([...TENANT_USAGE_FIELDS].sort());
      expect(row!.tenantId).toBe(TENANT_ID);
      expect(row!.activeMembers).toBe(7);
      // Eco de la fecha pedida: la factura tiene que ser auditable.
      expect(row!.asOf).toBe('2026-02-01T00:00:00.000Z');
    });

    it('un tenant sin miembros aparece con activeMembers 0, no ausente', async () => {
      prisma.user.groupBy.mockResolvedValue([]);
      const [row] = await service.getUsage();
      expect(row?.activeMembers).toBe(0);
    });
  });

  describe('errores', () => {
    const dto = {
      slug: 'acme',
      name: 'Acme Corp',
      adminEmail: 'admin@acme.io',
      primaryHostname: 'acme.didacta.io',
    };

    it('slug con formato inválido', async () => {
      await expect(
        errorCodeOf(() => service.create(ACTOR, { ...dto, slug: 'Acme SA' }, 'http://x')),
      ).resolves.toBe('ADMIN_TENANT_SLUG_INVALID');
    });

    it('hostname con formato inválido', async () => {
      await expect(
        errorCodeOf(() =>
          service.create(ACTOR, { ...dto, primaryHostname: 'ACME_/io' }, 'http://x'),
        ),
      ).resolves.toBe('ADMIN_TENANT_HOSTNAME_INVALID');
    });

    it('slug ya existente', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 'otro' });
      await expect(errorCodeOf(() => service.create(ACTOR, dto, 'http://x'))).resolves.toBe(
        'ADMIN_TENANT_SLUG_EXISTS',
      );
    });

    it('hostname ya asignado', async () => {
      prisma.tenantDomain.findUnique.mockResolvedValue({ id: 'dom-1' });
      await expect(errorCodeOf(() => service.create(ACTOR, dto, 'http://x'))).resolves.toBe(
        'ADMIN_TENANT_HOSTNAME_EXISTS',
      );
    });

    it('tenant inexistente al consultarlo o al cambiarle el estado', async () => {
      prisma.tenant.findFirst.mockResolvedValue(null);
      await expect(errorCodeOf(() => service.getDetail('no-existe'))).resolves.toBe(
        'ADMIN_TENANT_NOT_FOUND',
      );
      await expect(
        errorCodeOf(() => service.setStatus(ACTOR, 'no-existe', 'SUSPENDED')),
      ).resolves.toBe('ADMIN_TENANT_NOT_FOUND');
    });

    it('dominio inexistente al quitarlo', async () => {
      prisma.tenantDomain.findFirst.mockResolvedValue(null);
      await expect(
        errorCodeOf(() => service.removeDomain(ACTOR, TENANT_ID, 'otro.didacta.io')),
      ).resolves.toBe('ADMIN_TENANT_DOMAIN_NOT_FOUND');
    });

    it('el dominio primario no se puede quitar', async () => {
      prisma.tenantDomain.findFirst.mockResolvedValue({ id: 'dom-1', isPrimary: true });
      await expect(
        errorCodeOf(() => service.removeDomain(ACTOR, TENANT_ID, 'acme.didacta.io')),
      ).resolves.toBe('ADMIN_TENANT_PRIMARY_DOMAIN_DELETE_FORBIDDEN');
    });

    it('el corte de facturación no puede estar en el futuro', async () => {
      const futuro = new Date(Date.now() + 86_400_000);
      await expect(errorCodeOf(() => service.getUsage(futuro))).resolves.toBe(
        'ADMIN_TENANT_USAGE_ASOF_IN_FUTURE',
      );
    });
  });
});
