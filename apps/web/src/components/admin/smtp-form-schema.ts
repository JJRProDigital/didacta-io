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

export type SmtpPresetKey = 'brevo' | 'gmail' | 'outlook' | 'ses' | 'mailgun' | 'sendgrid';

export interface SmtpPreset {
  key: SmtpPresetKey;
  /** Nombre de marca — no se traduce. */
  name: string;
  host: string;
  port: number;
  encryption: SmtpFormValues['encryption'];
  /** Username fijo que exige el proveedor (p. ej. «apikey» en SendGrid). */
  username?: string;
  /** Substrings del host que identifican al proveedor (detección). */
  hostMatch: readonly string[];
}

/**
 * Presets de los proveedores habituales (estilo FluentSMTP): rellenan
 * host/puerto/cifrado — y el usuario cuando el proveedor lo fija — y enseñan
 * la pista de credenciales que cada uno necesita (`smtp.presetHint.*` en el
 * catálogo adminSso). Solo SMTP: las APIs propietarias de envío (Brevo API,
 * SendGrid API…) quedan fuera a propósito.
 *
 * Hosts regionales (SES, Mailgun): se prerrellena la región EU — el público
 * de Didacta — y la pista dice cómo cambiarla. Un preset editable que acierta
 * el 90% gana a un campo vacío.
 */
export const SMTP_PRESETS: readonly SmtpPreset[] = [
  {
    key: 'brevo',
    name: 'Brevo',
    host: 'smtp-relay.brevo.com',
    port: 587,
    encryption: 'starttls',
    hostMatch: ['brevo.com', 'sendinblue.com'],
  },
  {
    key: 'gmail',
    name: 'Gmail / Google Workspace',
    host: 'smtp.gmail.com',
    port: 587,
    encryption: 'starttls',
    hostMatch: ['gmail.com', 'googlemail.com'],
  },
  {
    key: 'outlook',
    name: 'Outlook / Microsoft 365',
    host: 'smtp.office365.com',
    port: 587,
    encryption: 'starttls',
    hostMatch: ['office365.com', 'outlook.com'],
  },
  {
    key: 'ses',
    name: 'Amazon SES',
    host: 'email-smtp.eu-west-1.amazonaws.com',
    port: 587,
    encryption: 'starttls',
    hostMatch: ['amazonaws.com'],
  },
  {
    key: 'mailgun',
    name: 'Mailgun',
    host: 'smtp.eu.mailgun.org',
    port: 587,
    encryption: 'starttls',
    hostMatch: ['mailgun.org'],
  },
  {
    key: 'sendgrid',
    name: 'SendGrid',
    host: 'smtp.sendgrid.net',
    port: 587,
    encryption: 'starttls',
    username: 'apikey',
    hostMatch: ['sendgrid.net'],
  },
] as const;

/**
 * Identifica el proveedor a partir del host tecleado/guardado, para que la
 * tarjeta resalte el preset y enseñe su pista también en configs que no
 * nacieron del botón. null = host propio o proveedor desconocido.
 */
export function detectSmtpPreset(host: string): SmtpPresetKey | null {
  const limpio = host.trim().toLowerCase();
  if (!limpio) return null;
  for (const preset of SMTP_PRESETS) {
    if (preset.hostMatch.some((m) => limpio.includes(m))) return preset.key;
  }
  return null;
}
