/**
 * Copyright (c) VA360 LABS S.L.
 * SPDX-License-Identifier: LicenseRef-Didacta-Sustainable-Use
 *
 * UC-C103 — credencial de provisioning de la instancia.
 *
 * Lo que se fija aquí:
 *  - el token en plano NO se persiste, solo su hash, y cifrado;
 *  - emitir otra revoca la anterior (una credencial viva por instancia);
 *  - revocar corta en la petición siguiente, aunque la verificación cachee.
 */

import { describe, expect, it, vi } from 'vitest';
import { PrismaInstanceConfigService } from '../src/modules/prisma-instance-config.service';
import { ProvisioningCredentialService } from '../src/auth/provisioning-credential.service';

interface StoredRow {
  value: unknown;
  isSecret: boolean;
  actorId: string | null;
}

/** Doble del store de `core_instance_setting`: Map plano, sin cifrado real. */
function makeSettingsStub() {
  const store = new Map<string, StoredRow>();
  const stub = {
    store,
    get: vi.fn(async (scope: string, key: string) => store.get(`${scope}|${key}`)?.value),
    set: vi.fn(
      async (
        scope: string,
        key: string,
        value: unknown,
        opts?: { isSecret?: boolean; actorId?: string | null },
      ) => {
        store.set(`${scope}|${key}`, {
          value,
          isSecret: opts?.isSecret ?? false,
          actorId: opts?.actorId ?? null,
        });
      },
    ),
    delete: vi.fn(async (scope: string, key: string) => {
      store.delete(`${scope}|${key}`);
    }),
  };
  return stub;
}

function makeService() {
  const settings = makeSettingsStub();
  const service = new ProvisioningCredentialService(
    settings as unknown as PrismaInstanceConfigService,
  );
  return { service, settings };
}

const SUPER_ADMIN = 'user-super-1';

describe('ProvisioningCredentialService', () => {
  it('emite un token con prefijo propio y guarda solo el hash, cifrado', async () => {
    const { service, settings } = makeService();

    const issued = await service.issue(SUPER_ADMIN);

    expect(issued.token.startsWith('didprov_')).toBe(true);
    expect(issued.id).toMatch(/^[0-9a-f-]{36}$/);

    const row = settings.store.get('provisioning|credential');
    expect(row?.isSecret).toBe(true);
    expect(row?.actorId).toBe(SUPER_ADMIN);

    // Lo persistido no contiene el token en plano por ningún lado.
    const serialized = JSON.stringify(row?.value);
    expect(serialized).not.toContain(issued.token);
    expect(serialized).toContain('"hash"');
  });

  it('verify acepta el token emitido y devuelve el id de la credencial', async () => {
    const { service } = makeService();
    const issued = await service.issue(SUPER_ADMIN);

    await expect(service.verify(issued.token)).resolves.toEqual({ credentialId: issued.id });
  });

  it('verify rechaza un token que no coincide, uno sin prefijo y el vacío', async () => {
    const { service } = makeService();
    await service.issue(SUPER_ADMIN);

    await expect(service.verify('didprov_' + 'x'.repeat(43))).resolves.toBeNull();
    await expect(service.verify('lmsk_algo')).resolves.toBeNull();
    await expect(service.verify('')).resolves.toBeNull();
    await expect(service.verify(null)).resolves.toBeNull();
    await expect(service.verify(undefined)).resolves.toBeNull();
  });

  it('verify devuelve null cuando la instancia nunca emitió credencial', async () => {
    const { service } = makeService();
    await expect(service.verify('didprov_' + 'y'.repeat(43))).resolves.toBeNull();
  });

  it('emitir otra revoca la anterior — una credencial viva por instancia', async () => {
    const { service, settings } = makeService();
    const first = await service.issue(SUPER_ADMIN);
    const second = await service.issue(SUPER_ADMIN);

    expect(second.id).not.toBe(first.id);
    await expect(service.verify(first.token)).resolves.toBeNull();
    await expect(service.verify(second.token)).resolves.toEqual({ credentialId: second.id });
    expect(settings.store.size).toBe(1);
  });

  it('revocar corta en la petición siguiente pese a la caché de verificación (AC4)', async () => {
    const { service } = makeService();
    const issued = await service.issue(SUPER_ADMIN);

    // Primera verificación: deja la credencial en caché.
    await expect(service.verify(issued.token)).resolves.toEqual({ credentialId: issued.id });

    const result = await service.revoke(SUPER_ADMIN);
    expect(result).toEqual({ revoked: true, id: issued.id });

    // Sin invalidación de caché, esto seguiría devolviendo el actor hasta 60 s.
    await expect(service.verify(issued.token)).resolves.toBeNull();
  });

  it('revocar sin credencial viva es idempotente', async () => {
    const { service, settings } = makeService();
    await expect(service.revoke(SUPER_ADMIN)).resolves.toEqual({ revoked: false, id: null });
    expect(settings.delete).not.toHaveBeenCalled();
  });

  it('la caché evita releer el store en cada verificación', async () => {
    const { service, settings } = makeService();
    const issued = await service.issue(SUPER_ADMIN);
    settings.get.mockClear();

    await service.verify(issued.token);
    await service.verify(issued.token);
    await service.verify(issued.token);

    expect(settings.get).toHaveBeenCalledTimes(1);
  });
});
