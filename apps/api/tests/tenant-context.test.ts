import { describe, expect, it } from 'vitest';
import { TenantContextService } from '../src/tenancy/tenant-context.service';
import {
  isSanctionedGlobalAccess,
  runAsTenantOrSanctioned,
  runGlobalWithoutTenant,
  runSanctionedGlobalAccess,
  tenantContextStorage,
} from '../src/tenancy/tenant-context.storage';

describe('TenantContextService', () => {
  it('expone el contexto dentro del scope de run()', async () => {
    const service = new TenantContextService();
    const result = await service.run(
      { tenantId: 't-1', userId: 'u-1', traceId: 'tr-1' },
      async () => service.get(),
    );
    expect(result).toEqual({ tenantId: 't-1', userId: 'u-1', traceId: 'tr-1' });
  });

  it('contextos paralelos no se pisan entre requests concurrentes', async () => {
    const service = new TenantContextService();
    const a = service.run({ tenantId: 'A', traceId: 'a' }, async () => {
      await new Promise((r) => setTimeout(r, 10));
      return service.get()?.tenantId;
    });
    const b = service.run({ tenantId: 'B', traceId: 'b' }, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return service.get()?.tenantId;
    });
    const [tA, tB] = await Promise.all([a, b]);
    expect(tA).toBe('A');
    expect(tB).toBe('B');
  });

  it('require() lanza fuera de un scope', () => {
    const service = new TenantContextService();
    expect(() => service.require()).toThrow(/no disponible/);
  });

  it('get() devuelve undefined fuera de scope', () => {
    const service = new TenantContextService();
    expect(service.get()).toBeUndefined();
  });
});

describe('runAsTenantOrSanctioned (patrón webhook F3)', () => {
  it('con tenant abre el contexto ALS de ese tenant (sin marca sancionada)', async () => {
    const seen = await runAsTenantOrSanctioned('t-webhook', async () => ({
      tenantId: tenantContextStorage.getStore()?.tenantId,
      sanctioned: isSanctionedGlobalAccess(),
    }));
    expect(seen).toEqual({ tenantId: 't-webhook', sanctioned: false });
  });

  it('sin tenant (null/undefined) degrada a acceso global sancionado', async () => {
    for (const empty of [null, undefined]) {
      const seen = await runAsTenantOrSanctioned(empty, async () => ({
        tenantId: tenantContextStorage.getStore()?.tenantId,
        sanctioned: isSanctionedGlobalAccess(),
      }));
      expect(seen).toEqual({ tenantId: undefined, sanctioned: true });
    }
  });
});

/**
 * UC-C102 — el helper que hace posible un listado cross-tenant correcto.
 *
 * `runSanctionedGlobalAccess` por sí solo NO basta en una petición HTTP: el
 * middleware ya dejó contexto de tenant en el ALS, así que la extensión de RLS
 * escopa la query a ESE tenant y el resultado sale silenciosamente mal (los
 * números del tenant desde el que miras, repetidos en todas las filas).
 */
describe('runGlobalWithoutTenant', () => {
  it('sale del contexto de tenant Y marca el acceso como sancionado', async () => {
    const visto = await tenantContextStorage.run(
      { tenantId: 't-mirando', traceId: 'tr' },
      async () =>
        runGlobalWithoutTenant(async () => ({
          ctx: tenantContextStorage.getStore(),
          sancionado: isSanctionedGlobalAccess(),
        })),
    );
    expect(visto.ctx).toBeUndefined();
    expect(visto.sancionado).toBe(true);
  });

  it('marcar solo como sancionado NO basta: el contexto sobrevive', async () => {
    const visto = await tenantContextStorage.run(
      { tenantId: 't-mirando', traceId: 'tr' },
      async () => runSanctionedGlobalAccess(async () => tenantContextStorage.getStore()?.tenantId),
    );
    expect(visto).toBe('t-mirando');
  });

  it('devuelve al contexto anterior al salir', async () => {
    await tenantContextStorage.run({ tenantId: 't-1', traceId: 'tr' }, async () => {
      await runGlobalWithoutTenant(async () => undefined);
      expect(tenantContextStorage.getStore()?.tenantId).toBe('t-1');
    });
  });

  it('el await ocurre dentro del scope (PrismaPromise es lazy)', async () => {
    let dentro = false;
    await runGlobalWithoutTenant(async () => {
      await new Promise((r) => setTimeout(r, 5));
      dentro = isSanctionedGlobalAccess();
    });
    expect(dentro).toBe(true);
  });
});
