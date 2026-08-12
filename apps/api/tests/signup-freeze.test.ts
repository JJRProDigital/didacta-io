/**
 * Copyright (c) VA360 LABS S.L.
 * SPDX-License-Identifier: LicenseRef-Didacta-Sustainable-Use
 *
 * U7 — congelación de altas nuevas por tenant.
 *
 * La mitad de este fichero prueba que la funcionalidad hace lo que dice. La
 * otra mitad prueba algo más importante: **que no se convierta en un tope**.
 *
 * Didacta Community es fair-code. Si algún día alguien conecta esta
 * congelación a la licencia, al plan o a un recuento de miembros, el producto
 * pasa a ser una versión capada del de pago — y eso no ocurriría de golpe,
 * ocurriría en un PR de tres líneas que nadie mira dos veces. Los tests de
 * «lo que NO puede pasar» existen para que ese PR se ponga rojo.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SIGNUPS_FROZEN_CODE, assertSignupsAllowed, isFrozen } from '../src/tenancy/signup-freeze';

const FUENTE = join(process.cwd(), 'src', 'tenancy', 'signup-freeze.ts');

function prismaCon(state: { signupsFrozenAt: Date | null; signupsFrozenReason?: string | null }) {
  return {
    tenant: {
      findUnique: vi.fn().mockResolvedValue({
        signupsFrozenAt: state.signupsFrozenAt,
        signupsFrozenReason: state.signupsFrozenReason ?? null,
      }),
    },
  } as never;
}

describe('U7 · congelación de altas', () => {
  it('un tenant recién creado admite altas: las columnas nacen nulas', async () => {
    await expect(
      assertSignupsAllowed(prismaCon({ signupsFrozenAt: null }), 'tenant-1'),
    ).resolves.toBeUndefined();
    expect(isFrozen({ signupsFrozenAt: null, signupsFrozenReason: null })).toBe(false);
  });

  it('congelado, lanza 409 con un código estable', async () => {
    const prisma = prismaCon({
      signupsFrozenAt: new Date(),
      signupsFrozenReason: 'Cohorte llena.',
    });

    await expect(assertSignupsAllowed(prisma, 'tenant-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(assertSignupsAllowed(prisma, 'tenant-1')).rejects.toMatchObject({
      response: { code: SIGNUPS_FROZEN_CODE, message: 'Cohorte llena.' },
    });
  });

  it('sin motivo escrito, el mensaje sigue siendo comprensible para quien se queda fuera', async () => {
    const prisma = prismaCon({ signupsFrozenAt: new Date(), signupsFrozenReason: '   ' });
    await expect(assertSignupsAllowed(prisma, 'tenant-1')).rejects.toMatchObject({
      response: { message: expect.stringContaining('no admite altas nuevas') },
    });
  });

  it('un tenant que no existe no bloquea nada: el caller ya tiene su propio 404', async () => {
    const prisma = { tenant: { findUnique: vi.fn().mockResolvedValue(null) } } as never;
    await expect(assertSignupsAllowed(prisma, 'no-existe')).resolves.toBeUndefined();
  });

  it('lee UNA fila y solo dos columnas: nada de recuentos', async () => {
    const prisma = prismaCon({ signupsFrozenAt: null });
    await assertSignupsAllowed(prisma, 'tenant-1');

    const llamadas = (
      prisma as unknown as { tenant: { findUnique: { mock: { calls: unknown[][] } } } }
    ).tenant.findUnique.mock.calls;
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]![0]).toEqual({
      where: { id: 'tenant-1' },
      select: { signupsFrozenAt: true, signupsFrozenReason: true },
    });
  });
});

/**
 * Quita comentarios para mirar solo el CÓDIGO. Sin esto, la prosa que explica
 * por qué esto no es un tope —que necesariamente nombra planes y licencias—
 * haría fallar a los tests que prohíben nombrarlos. Se prohíbe el
 * acoplamiento, no la explicación.
 */
function soloCodigo(fuente: string): string {
  return fuente
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

describe('U7 · lo que NO puede pasar — Community no se capa', () => {
  const fuente = soloCodigo(readFileSync(FUENTE, 'utf8'));

  it('no importa el SDK de licencias', () => {
    // Si esto se pone rojo, alguien está a punto de convertir un interruptor
    // de operador en un límite de plan. Ese es el momento de parar.
    expect(fuente).not.toMatch(/from '@didacta\/license-sdk'/);
    expect(fuente).not.toMatch(/LicenseService|requireCapability|isCapabilityEnabled/);
  });

  it('no cuenta usuarios, miembros ni nada', () => {
    expect(fuente).not.toMatch(/\.count\(|groupBy|activeMembers|memberCap/);
  });

  it('no conoce planes, tramos ni facturación', () => {
    expect(fuente).not.toMatch(/plan|tramo|stripe|billing|subscription/i);
  });

  it('solo consulta la tabla `tenant`', () => {
    const modelos = [...fuente.matchAll(/prisma\.(\w+)\./g)].map((m) => m[1]);
    expect(new Set(modelos)).toEqual(new Set(['tenant']));
  });

  it('la migración no toca ninguna fila existente', () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        '..',
        '..',
        'packages',
        'database',
        'prisma',
        'migrations',
        '20260812100000_tenant_signups_freeze',
        'migration.sql',
      ),
      'utf8',
    );
    // Columnas anulables y sin DEFAULT: una instalación existente queda
    // exactamente como estaba. Un `DEFAULT now()` habría congelado a todo el
    // mundo en el momento de actualizar.
    const sentencias = sql
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    expect(sentencias).toMatch(/ADD COLUMN "signups_frozen_at" TIMESTAMP\(3\);/);
    expect(sentencias).not.toMatch(/DEFAULT/i);
    expect(sentencias).not.toMatch(/UPDATE|NOT NULL/i);
  });
});
