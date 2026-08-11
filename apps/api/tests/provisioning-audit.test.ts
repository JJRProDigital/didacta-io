/**
 * Copyright (c) VA360 LABS S.L.
 * SPDX-License-Identifier: LicenseRef-Didacta-Sustainable-Use
 *
 * UC-C103 AC3 — el audit log distingue a la máquina de la persona.
 *
 * Un alta de tenant hecha por el plano de control tiene que poder leerse como
 * lo que es. Antes de UC-C103 el actor era un `user.id` y punto: meter ahí el
 * id de una credencial habría dejado filas indistinguibles de las de un humano.
 */

import { LicenseService } from '@didacta/license-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminTenantsService } from '../src/admin/admin-tenants.service';

type ServiceCtor = ConstructorParameters<typeof AdminTenantsService>;

const CREDENTIAL_ID = '11111111-2222-3333-4444-555555555555';
const HUMAN_ID = 'user-super-1';
const TENANT_ID = 'tenant-nuevo';

const dto = {
  slug: 'acme',
  name: 'Acme Corp',
  adminEmail: 'admin@acme.test',
  primaryHostname: 'acme.didacta.test',
};

function makePrisma() {
  const detail = {
    id: TENANT_ID,
    slug: dto.slug,
    name: dto.name,
    status: 'ACTIVE' as const,
    createdAt: new Date(),
    domains: [{ hostname: dto.primaryHostname, isPrimary: true, isVerified: true }],
    _count: { users: 1 },
  };
  return {
    tenant: {
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(detail),
      update: vi.fn().mockResolvedValue(detail),
    },
    tenantDomain: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    role: { findUnique: vi.fn().mockResolvedValue({ id: 'role-tenant-admin' }) },
    modCoursesCourse: {
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        tenant: { create: vi.fn().mockResolvedValue({ id: TENANT_ID }), update: vi.fn() },
        tenantDomain: { create: vi.fn().mockResolvedValue({}) },
        user: { create: vi.fn().mockResolvedValue({ id: 'user-admin-1' }) },
        userRole: { create: vi.fn().mockResolvedValue({}) },
        session: { deleteMany: vi.fn().mockResolvedValue({ count: 3 }) },
      }),
    ),
  };
}

interface AuditEntry {
  action: string;
  actorId: string | null;
  metadata: Record<string, unknown>;
}

describe('UC-C103 AC3 · actor del audit log', () => {
  let audit: { record: ReturnType<typeof vi.fn> };
  let prisma: ReturnType<typeof makePrisma>;
  let service: AdminTenantsService;

  /** Primera entrada registrada, con el fallo explícito si no hubo ninguna. */
  function firstEntry(): AuditEntry {
    const [call] = audit.record.mock.calls;
    if (!call) throw new Error('no se registró ninguna entrada de auditoría');
    return call[0] as AuditEntry;
  }

  beforeEach(async () => {
    audit = { record: vi.fn().mockResolvedValue(undefined) };
    prisma = makePrisma();
    const license = new LicenseService();
    await license.load({ allowDevBypass: true, key: 'dev-key' });
    service = new AdminTenantsService(
      ...([
        prisma,
        audit,
        { requestAndSendEmail: vi.fn().mockResolvedValue(undefined) },
        license,
        { warn: vi.fn(), log: vi.fn(), error: vi.fn(), debug: vi.fn() },
      ] as unknown as ServiceCtor),
    );
  });

  it('create con credencial: el actor es la credencial y la fila se marca como de máquina', async () => {
    await service.create({ kind: 'provisioning', credentialId: CREDENTIAL_ID }, dto, 'http://x');

    expect(audit.record).toHaveBeenCalledTimes(1);
    const entry = firstEntry();
    expect(entry.action).toBe('admin.tenant.created');
    expect(entry.actorId).toBe(CREDENTIAL_ID);
    expect(entry.metadata.actorKind).toBe('provisioning');
  });

  it('create con persona: el actor es el usuario y la fila NO lleva marca de máquina', async () => {
    await service.create({ kind: 'user', userId: HUMAN_ID }, dto, 'http://x');

    const entry = firstEntry();
    expect(entry.actorId).toBe(HUMAN_ID);
    expect(entry.metadata).not.toHaveProperty('actorKind');
  });

  it('setStatus con credencial: mismo criterio de actor', async () => {
    await service.setStatus(
      { kind: 'provisioning', credentialId: CREDENTIAL_ID },
      TENANT_ID,
      'SUSPENDED',
    );

    const entry = firstEntry();
    expect(entry.action).toBe('admin.tenant.status_changed.suspended');
    expect(entry.actorId).toBe(CREDENTIAL_ID);
    expect(entry.metadata.actorKind).toBe('provisioning');
  });

  it('addDomain y removeDomain heredan el mismo actor', async () => {
    prisma.tenantDomain.findUnique.mockResolvedValue(null);
    await service.addDomain(
      { kind: 'provisioning', credentialId: CREDENTIAL_ID },
      TENANT_ID,
      'otro.didacta.test',
    );
    expect(firstEntry().actorId).toBe(CREDENTIAL_ID);
    expect(firstEntry().metadata.actorKind).toBe('provisioning');
  });
});
