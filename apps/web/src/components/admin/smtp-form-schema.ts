/**
 * Copyright (c) VA360 LABS S.L.
 * SPDX-License-Identifier: LicenseRef-Didacta-Sustainable-Use
 */

/**
 * Schema Zod del form SMTP, extraído del componente de UI para que pueda
 * importarse desde tests unitarios sin arrastrar React / JSX / 'use client'.
 *
 * El backend valida con el mismo shape — ver `SmtpUpsertSchema` en
 * `apps/api/src/admin/admin-smtp.controller.ts`. El único delta es que acá
 * usamos `coerce.number` para que un `<input type="number">` (que llega como
 * string en algunos browsers) se convierta antes de la validación de rango.
 *
 * i18n: un schema no puede usar hooks, así que los mensajes custom son KEYS
 * del catálogo `adminSso` (grupo `validation`). El componente que muestra el
 * issue las resuelve con `labelOr(t, issue.message, issue.message)` — si el
 * mensaje no es una key (defaults de Zod), se muestra tal cual.
 */

import { z } from 'zod';

export const smtpFormSchema = z.object({
  host: z.string().trim().min(1, 'validation.hostRequired').max(255),
  port: z.coerce.number().int().min(1, 'validation.portInvalid').max(65535),
  encryption: z.enum(['tls', 'starttls', 'none']),
  username: z.string().trim().min(1, 'validation.usernameRequired').max(255),
  password: z.string().max(2048).optional(),
  fromEmail: z.string().trim().email('validation.fromEmailInvalid').max(255),
  fromName: z.string().trim().max(255).optional(),
});

export type SmtpFormValues = z.infer<typeof smtpFormSchema>;

/**
 * Modo de cifrado canónico de los puertos SMTP conocidos, o null si el puerto
 * no tiene convención clara. El form lo usa para autoajustar el selector al
 * cambiar el puerto (el admin siempre puede corregirlo a mano): 465 → TLS
 * implícito, 587 → STARTTLS, 25/1025 → sin cifrado (relays y MTAs locales
 * tipo mailpit; un 25 con STARTTLS real se selecciona a mano).
 */
export function canonicalEncryptionForPort(port: number): SmtpFormValues['encryption'] | null {
  if (port === 465) return 'tls';
  if (port === 587) return 'starttls';
  if (port === 25 || port === 1025) return 'none';
  return null;
}
