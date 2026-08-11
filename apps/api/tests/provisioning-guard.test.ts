/**
 * Copyright (c) VA360 LABS S.L.
 * SPDX-License-Identifier: LicenseRef-Didacta-Sustainable-Use
 *
 * UC-C103 — `JwtOrProvisioningGuard`.
 *
 * Lo que se fija aquí:
 *  - el camino Bearer se DELEGA entero en JwtAuthGuard (si se reimplantara,
 *    las rutas que usan este guard perderían el enforcement de MFA por rol);
 *  - una credencial válida solo abre los handlers con `@AllowProvisioning()`;
 *  - el actor de máquina NO se cuela en `request.user`: sin usuario ni tenant
 *    inventados, que es lo que mantiene fuera a los interceptores globales.
 */

import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { PUBLIC_ROUTE_KEY } from '../src/auth/jwt-auth.guard';
import {
  ALLOW_PROVISIONING_KEY,
  JwtOrProvisioningGuard,
} from '../src/auth/jwt-or-provisioning.guard';
import type { ProvisioningCredentialService } from '../src/auth/provisioning-credential.service';

const CREDENTIAL_ID = '11111111-2222-3333-4444-555555555555';
const GOOD_TOKEN = 'didprov_token-bueno';

function makeContext(request: Partial<FastifyRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class Ctrl {},
  } as unknown as ExecutionContext;
}

function makeGuard(metadata: Record<string, unknown>) {
  const jwt = { canActivate: vi.fn().mockResolvedValue(true) };
  const credentials = {
    verify: vi.fn(async (token: string | null | undefined) =>
      token === GOOD_TOKEN ? { credentialId: CREDENTIAL_ID } : null,
    ),
  };
  const reflector = {
    getAllAndOverride: vi.fn((key: string) => metadata[key]),
  };
  const guard = new JwtOrProvisioningGuard(
    jwt as unknown as JwtAuthGuard,
    credentials as unknown as ProvisioningCredentialService,
    reflector as unknown as Reflector,
  );
  return { guard, jwt, credentials };
}

describe('JwtOrProvisioningGuard', () => {
  let allowed: Record<string, unknown>;

  beforeEach(() => {
    allowed = { [ALLOW_PROVISIONING_KEY]: true };
  });

  it('delega en JwtAuthGuard cuando el header es Bearer', async () => {
    const { guard, jwt, credentials } = makeGuard(allowed);
    const request = { headers: { authorization: 'Bearer un.jwt.cualquiera' } };

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);

    expect(jwt.canActivate).toHaveBeenCalledTimes(1);
    expect(credentials.verify).not.toHaveBeenCalled();
  });

  it('delega en JwtAuthGuard cuando no hay header (que es quien devuelve el 401)', async () => {
    const { guard, jwt } = makeGuard(allowed);

    await guard.canActivate(makeContext({ headers: {} }));

    expect(jwt.canActivate).toHaveBeenCalledTimes(1);
  });

  it('credencial válida en handler abierto: pasa y popula el actor de máquina', async () => {
    const { guard } = makeGuard(allowed);
    const request: Partial<FastifyRequest> = {
      headers: { authorization: `Provisioning ${GOOD_TOKEN}` },
    };

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);

    expect(request.provisioningActor).toEqual({ credentialId: CREDENTIAL_ID });
    // Lo importante: NO se inventa una sesión.
    expect(request.user).toBeUndefined();
  });

  it('credencial válida en handler NO marcado: 403 y sin actor', async () => {
    const { guard } = makeGuard({});
    const request: Partial<FastifyRequest> = {
      headers: { authorization: `Provisioning ${GOOD_TOKEN}` },
    };

    await expect(guard.canActivate(makeContext(request))).rejects.toMatchObject({
      response: { code: 'AUTH_PROVISIONING_ROUTE_NOT_ALLOWED' },
    });
    await expect(guard.canActivate(makeContext(request))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(request.provisioningActor).toBeUndefined();
  });

  it('credencial inválida: 401 sin mirar la lista blanca ni delegar en el JWT', async () => {
    const { guard, jwt } = makeGuard(allowed);
    const request = { headers: { authorization: 'Provisioning didprov_no-vale' } };

    await expect(guard.canActivate(makeContext(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(guard.canActivate(makeContext(request))).rejects.toMatchObject({
      response: { code: 'AUTH_PROVISIONING_CREDENTIAL_INVALID' },
    });
    expect(jwt.canActivate).not.toHaveBeenCalled();
  });

  it('una credencial revocada deja de abrir la ruta que tenía abierta', async () => {
    const { guard, credentials } = makeGuard(allowed);
    const request: Partial<FastifyRequest> = {
      headers: { authorization: `Provisioning ${GOOD_TOKEN}` },
    };
    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);

    credentials.verify.mockResolvedValue(null);

    await expect(guard.canActivate(makeContext({ ...request }))).rejects.toMatchObject({
      response: { code: 'AUTH_PROVISIONING_CREDENTIAL_INVALID' },
    });
  });

  it('ruta pública: pasa sin tocar credencial ni JWT', async () => {
    const { guard, jwt, credentials } = makeGuard({ [PUBLIC_ROUTE_KEY]: true });

    await expect(
      guard.canActivate(makeContext({ headers: { authorization: 'Provisioning lo-que-sea' } })),
    ).resolves.toBe(true);

    expect(jwt.canActivate).not.toHaveBeenCalled();
    expect(credentials.verify).not.toHaveBeenCalled();
  });
});
