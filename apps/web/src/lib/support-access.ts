'use client';

/**
 * Copyright (c) VA360 LABS S.L.
 * SPDX-License-Identifier: LicenseRef-Didacta-Sustainable-Use
 */

/// Acceso de soporte de vida corta (U8), lado navegador.
///
/// Dos llamadas y nada más: canjear el token del enlace, y preguntarle al
/// servidor si la sesión actual sigue siendo un acceso de soporte vivo.
///
/// La segunda existe para que el aviso del aula no dependa de lo que quedó
/// guardado en el navegador: si un operador revoca la concesión, el aviso tiene
/// que apagarse —y la sesión caerse— sin esperar a que nadie recargue.

import { apiFetch } from './api-client';

export interface SupportAccessContext {
  grantId: string;
  /** Lo que escribió quien abrió el acceso. Se enseña tal cual. */
  reason: string;
  expiresAt: string;
}

export interface RedeemedSupportAccess {
  accessToken: string;
  expiresIn: number;
  expiresAt: string;
  reason: string;
  grantId: string;
  user: {
    id: string;
    email: string;
    name: string;
    tenantId: string;
    tenantSlug: string;
    roles: string[];
  };
}

export const supportAccessApi = {
  /** Canjea el token del enlace. De un solo uso: si falla, hay que pedir otro. */
  redeem(token: string): Promise<RedeemedSupportAccess> {
    return apiFetch<RedeemedSupportAccess>('/api/v1/auth/support-access/redeem', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  },

  /** `null` para cualquier sesión normal, que es el caso de casi todo el mundo. */
  async current(bearer: string): Promise<SupportAccessContext | null> {
    const res = await apiFetch<{ support: SupportAccessContext | null }>(
      '/api/v1/auth/support-access/current',
      {},
      bearer,
    );
    return res.support;
  },
};

/**
 * Minutos y segundos que quedan, ya formateados (`4:07`). Devuelve `null`
 * cuando la ventana ya pasó, para que quien lo pinte no tenga que decidir qué
 * hacer con un negativo.
 */
export function remainingLabel(expiresAt: string, now: number = Date.now()): string | null {
  const restanteMs = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(restanteMs) || restanteMs <= 0) return null;
  const totalSegundos = Math.floor(restanteMs / 1000);
  const minutos = Math.floor(totalSegundos / 60);
  const segundos = totalSegundos % 60;
  return `${minutos}:${String(segundos).padStart(2, '0')}`;
}
