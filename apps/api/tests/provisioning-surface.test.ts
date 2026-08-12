/**
 * Copyright (c) VA360 LABS S.L.
 * SPDX-License-Identifier: LicenseRef-Didacta-Sustainable-Use
 *
 * UC-C103 AC2 — **superficie** de la credencial de provisioning.
 *
 * Este es el test que impide que el alcance se ensanche por descuido. La
 * credencial no tiene tenant ni usuario: cada ruta que abre es una operación
 * que una máquina puede hacer sobre TODA la instalación. Añadir un
 * `@AllowProvisioning()` en cualquier sitio del código, o poner el guard en
 * otro controller, rompe este test a propósito — la lista de abajo hay que
 * tocarla a mano, mirando lo que se está abriendo.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AdminTenantsController } from '../src/admin/admin-tenants.controller';
import { ALLOW_PROVISIONING_KEY } from '../src/auth/jwt-or-provisioning.guard';

/**
 * Las 8 operaciones que el plano de control necesita para dar de alta, operar
 * y facturar un tenant. Ni una más.
 *
 * `setSignups` (U7) se añadió el 2026-08-12 a conciencia: congelar altas es el
 * enforcement del techo de plan, y esa decisión la toma el plano de control
 * desde fuera. El núcleo solo obedece un interruptor — no cuenta miembros ni
 * mira licencias, y `signup-freeze.test.ts` lo vigila.
 */
const WHITELIST = [
  'list',
  'usage',
  'getOne',
  'create',
  'setStatus',
  'setSignups',
  'addDomain',
  'removeDomain',
];

/**
 * Rutas de `AdminTenantsController` que NO abre la credencial, con el porqué:
 *  - `capacity`: informa del cupo de licencia del operador, no de provisioning.
 *  - `rename`: decisión de negocio del humano que opera la academia.
 */
const DENIED = ['capacity', 'rename'];

const SRC_ROOT = join(process.cwd(), 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const TS_FILES = walk(SRC_ROOT).filter((f) => f.endsWith('.ts'));

/** Ficheros de `src/` cuyo contenido casa con el patrón, en ruta POSIX. */
function filesMatching(pattern: RegExp): string[] {
  return TS_FILES.filter((file) => pattern.test(readFileSync(file, 'utf8')))
    .map((file) => relative(SRC_ROOT, file).split(sep).join('/'))
    .sort();
}

/** Handlers del controller según la metadata de Nest (no una lista escrita a mano). */
function routeHandlersOf(controller: new (...args: never[]) => unknown): string[] {
  const proto = controller.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor')
    .filter((name) => {
      const handler = proto[name];
      return (
        typeof handler === 'function' &&
        Reflect.getMetadata(PATH_METADATA, handler) !== undefined &&
        Reflect.getMetadata(METHOD_METADATA, handler) !== undefined
      );
    });
}

function isAllowed(controller: new (...args: never[]) => unknown, handler: string): boolean {
  const proto = controller.prototype as Record<string, unknown>;
  return Reflect.getMetadata(ALLOW_PROVISIONING_KEY, proto[handler] as object) === true;
}

describe('UC-C103 AC2 · superficie de la credencial de provisioning', () => {
  it('abre exactamente las 8 rutas de la lista blanca en AdminTenantsController', () => {
    const abiertas = routeHandlersOf(AdminTenantsController).filter((h) =>
      isAllowed(AdminTenantsController, h),
    );
    expect(abiertas.sort()).toEqual([...WHITELIST].sort());
  });

  it('cubre TODAS las rutas del controller: cada una está abierta o denegada, sin olvidos', () => {
    const todas = routeHandlersOf(AdminTenantsController).sort();
    expect(todas).toEqual([...WHITELIST, ...DENIED].sort());
  });

  it('las rutas denegadas no llevan la marca', () => {
    for (const handler of DENIED) {
      expect(isAllowed(AdminTenantsController, handler)).toBe(false);
    }
  });

  it('no hay ningún @AllowProvisioning() fuera de AdminTenantsController', () => {
    // Línea entera, no `includes`: si no, los doc-comments que lo citan en
    // prosa (el guard, el service) darían falsos positivos.
    const conMarca = filesMatching(/^\s*@AllowProvisioning\(\)\s*$/m);
    expect(conMarca).toEqual(['admin/admin-tenants.controller.ts']);
  });

  it('el guard que acepta la credencial solo protege AdminTenantsController', () => {
    const conGuard = filesMatching(/^\s*@UseGuards\(JwtOrProvisioningGuard\)\s*$/m);
    expect(conGuard).toEqual(['admin/admin-tenants.controller.ts']);
  });

  it('emitir y revocar la credencial NO es alcanzable con la propia credencial', () => {
    const source = readFileSync(
      join(SRC_ROOT, 'admin', 'admin-provisioning.controller.ts'),
      'utf8',
    );
    // Una credencial que puede rotarse a sí misma no se puede revocar de verdad.
    expect(source).toContain('@UseGuards(JwtAuthGuard)');
    expect(source).not.toContain('AllowProvisioning');
  });
});
