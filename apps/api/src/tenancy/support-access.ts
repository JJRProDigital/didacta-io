/**
 * Copyright (c) VA360 LABS S.L.
 * SPDX-License-Identifier: LicenseRef-Didacta-Sustainable-Use
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/// Acceso de soporte de vida corta (U8) — las reglas, sin base de datos.
///
/// ## Qué resuelve
///
/// Un cliente reporta un problema que solo se ve dentro de su aula. Hasta ahora
/// las salidas eran dos, y las dos malas: pedirle la contraseña, o darle a
/// soporte un usuario permanente en su tenant. Esto es la tercera: una ventana
/// de minutos, con motivo escrito, de un solo uso y con rastro por los dos
/// lados.
///
/// ## Qué NO es
///
/// **No es impersonación.** El acceso no entra como el cliente ni hereda su
/// identidad: abre sesión como un usuario de soporte propio y visible, para que
/// el audit log del tenant pueda decir la verdad sobre quién hizo qué. Atribuir
/// a una persona real acciones que no hizo destruye exactamente lo que un log
/// de auditoría existe para sostener.
///
/// **No es una puerta silenciosa.** Mientras la sesión vive, el aula enseña un
/// banner que no se puede cerrar. Si un día alguien quita ese banner, el acceso
/// de soporte deja de ser un favor al cliente y pasa a ser una llave maestra
/// escondida — `support-access.test.ts` lo vigila.
///
/// **No es una capacidad de pago.** Un self-hoster tiene esto igual: es su
/// super_admin quien abre la ventana, para su propio equipo de soporte. El
/// núcleo no mira la licencia ni sabe que existe Didacta Cloud.

/** Prefijo del token en claro. Igual que `didprov_`, para reconocerlo de un vistazo. */
const TOKEN_PREFIX = 'didsup_';

/**
 * Techo duro de la ventana: 15 minutos. Lo pidió Valen y no es negociable
 * desde fuera — la petición puede pedir MENOS, nunca más. Vive aquí y no en un
 * default de columna a propósito: un default se cambia con una migración que
 * nadie relee, esta constante se cambia con un test rojo.
 */
export const SUPPORT_ACCESS_MAX_TTL_SECONDS = 15 * 60;

/** Ventana por defecto cuando el emisor no pide una más corta. */
export const SUPPORT_ACCESS_DEFAULT_TTL_SECONDS = SUPPORT_ACCESS_MAX_TTL_SECONDS;

/** Códigos de error del canje. Contrato con `didacta-cloud`: no se cambian. */
export const SUPPORT_ACCESS_CODES = {
  /** El token no existe, no tiene el prefijo o no coincide con ninguna concesión. */
  INVALID: 'SUPPORT_ACCESS_INVALID',
  /** Existía pero ya pasó su ventana. */
  EXPIRED: 'SUPPORT_ACCESS_EXPIRED',
  /** Ya se canjeó una vez. Es de un solo uso. */
  ALREADY_REDEEMED: 'SUPPORT_ACCESS_ALREADY_REDEEMED',
  /** Un operador la cortó antes de tiempo. */
  REVOKED: 'SUPPORT_ACCESS_REVOKED',
  /** El tenant no admite sesiones (suspendido o archivado). */
  TENANT_UNAVAILABLE: 'SUPPORT_ACCESS_TENANT_UNAVAILABLE',
  /** No hay ninguna concesión con ese id. */
  NOT_FOUND: 'SUPPORT_ACCESS_NOT_FOUND',
} as const;

/**
 * Identidad del usuario con el que entra soporte. Es un usuario del tenant, no
 * un fantasma: el cliente lo ve en su lista de miembros y en su audit log, que
 * es justo lo que queremos.
 *
 * El dominio `.invalid` está reservado por el RFC 2606 precisamente para esto:
 * garantiza que ningún correo salga nunca hacia esta dirección.
 */
export const SUPPORT_USER_EMAIL = 'soporte@didacta.invalid';
export const SUPPORT_USER_NAME = 'Soporte técnico (acceso temporal)';

/**
 * Rol con el que entra soporte.
 *
 * `tenant_admin` y no menos: un acceso que no puede ver la configuración del
 * tenant no diagnostica nada y acaba en «mándame una captura». Y no más:
 * `super_admin` opera la instalación ENTERA, incluidos los demás tenants del
 * pool, que es exactamente lo que este acceso no debe poder tocar.
 *
 * Efecto secundario buscado: `tenant_admin` está en la lista de roles que NO
 * cuentan como miembro activo (`AdminTenantsService.getUsage`), así que abrir
 * un acceso de soporte jamás le sube la factura a un cliente.
 */
export const SUPPORT_USER_ROLE = 'tenant_admin';

/** Concesión, reducida a lo que hace falta para decidir si vale. */
export interface SupportGrantState {
  expiresAt: Date;
  redeemedAt: Date | null;
  revokedAt: Date | null;
}

export type SupportGrantVerdict =
  | { ok: true }
  | { ok: false; code: (typeof SUPPORT_ACCESS_CODES)[keyof typeof SUPPORT_ACCESS_CODES] };

/**
 * ¿Se puede canjear esta concesión ahora mismo?
 *
 * El orden de las comprobaciones importa para el mensaje que recibe quien la
 * usa: «ya se canjeó» y «la cortaron» son cosas distintas de «caducó», y quien
 * está intentando entrar necesita saber cuál le pasó.
 */
export function verifyGrant(grant: SupportGrantState, now: Date = new Date()): SupportGrantVerdict {
  if (grant.revokedAt) return { ok: false, code: SUPPORT_ACCESS_CODES.REVOKED };
  if (grant.redeemedAt) return { ok: false, code: SUPPORT_ACCESS_CODES.ALREADY_REDEEMED };
  if (grant.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, code: SUPPORT_ACCESS_CODES.EXPIRED };
  }
  return { ok: true };
}

/**
 * Recorta la ventana pedida al techo. Un `ttlSeconds` mayor que el máximo no es
 * un error de validación: se sirve la ventana máxima y punto. Así el techo no
 * depende de que ningún llamante —incluido el plano de control— lo respete.
 */
export function clampTtlSeconds(requested?: number | null): number {
  if (requested === undefined || requested === null || !Number.isFinite(requested)) {
    return SUPPORT_ACCESS_DEFAULT_TTL_SECONDS;
  }
  const floored = Math.floor(requested);
  if (floored < 60) return 60;
  return Math.min(floored, SUPPORT_ACCESS_MAX_TTL_SECONDS);
}

/** Token en claro. Se devuelve UNA vez, al emitir; nunca se persiste. */
export function generateSupportToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export function hasSupportTokenPrefix(token: string): boolean {
  return token.startsWith(TOKEN_PREFIX);
}

export function hashSupportToken(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

/** Comparación en tiempo constante contra un hash almacenado. */
export function supportTokenMatches(candidate: string, storedHash: string): boolean {
  const a = Buffer.from(hashSupportToken(candidate), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
