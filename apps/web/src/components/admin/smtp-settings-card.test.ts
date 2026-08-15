/**
 * Tests del schema de validación del form SMTP + del payload que mandamos al
 * backend.
 *
 * No usamos React Testing Library porque el repo no lo tiene instalado
 * (todos los tests de `apps/web/src` son de lógica pura: ver
 * `lib/sidebar-modules-filter.test.ts`, `modules/billing/client.test.ts`,
 * etc.). El comportamiento visual del componente queda cubierto por el
 * E2E spec `apps/e2e/tests/admin-smtp-settings.spec.ts`.
 */

import { describe, expect, it } from 'vitest';
import {
  canonicalEncryptionForPort,
  detectSmtpPreset,
  SMTP_PRESETS,
  smtpFormSchema,
} from './smtp-form-schema';

describe('smtpFormSchema', () => {
  const valid = {
    host: 'smtp.example.com',
    port: 587,
    encryption: 'starttls',
    username: 'apikey',
    password: 'secret-xyz',
    fromEmail: 'noreply@example.com',
    fromName: 'Didacta',
  };

  it('parsea un form válido', () => {
    const result = smtpFormSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('rechaza port fuera de rango (0)', () => {
    const result = smtpFormSchema.safeParse({ ...valid, port: 0 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['port']);
    }
  });

  it('rechaza port fuera de rango (65536)', () => {
    const result = smtpFormSchema.safeParse({ ...valid, port: 65536 });
    expect(result.success).toBe(false);
  });

  it('rechaza fromEmail no-email', () => {
    const result = smtpFormSchema.safeParse({ ...valid, fromEmail: 'no-arroba' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['fromEmail']);
    }
  });

  it('rechaza host vacío', () => {
    const result = smtpFormSchema.safeParse({ ...valid, host: '' });
    expect(result.success).toBe(false);
  });

  it('permite password vacío (validación de "required cuando no hay guardado" la hace el caller)', () => {
    const result = smtpFormSchema.safeParse({ ...valid, password: '' });
    expect(result.success).toBe(true);
  });

  it('permite omitir fromName (opcional)', () => {
    const { fromName: _ignored, ...rest } = valid;
    void _ignored;
    const result = smtpFormSchema.safeParse(rest);
    expect(result.success).toBe(true);
  });

  it('coerce: port como string numérico se convierte a number', () => {
    const result = smtpFormSchema.safeParse({ ...valid, port: '465' as unknown as number });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.port).toBe(465);
    }
  });

  it('trim aplica a host y username', () => {
    const result = smtpFormSchema.safeParse({
      ...valid,
      host: '  smtp.example.com  ',
      username: '  apikey  ',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.host).toBe('smtp.example.com');
      expect(result.data.username).toBe('apikey');
    }
  });

  it('rechaza un modo de cifrado desconocido', () => {
    const result = smtpFormSchema.safeParse({ ...valid, encryption: 'ssl3' });
    expect(result.success).toBe(false);
  });
});

describe('canonicalEncryptionForPort', () => {
  it('mapea los puertos con convención', () => {
    expect(canonicalEncryptionForPort(465)).toBe('tls');
    expect(canonicalEncryptionForPort(587)).toBe('starttls');
    expect(canonicalEncryptionForPort(25)).toBe('none');
    expect(canonicalEncryptionForPort(1025)).toBe('none');
  });

  it('null en puertos sin convención (no pisa la elección del admin)', () => {
    expect(canonicalEncryptionForPort(2525)).toBeNull();
    expect(canonicalEncryptionForPort(8025)).toBeNull();
  });
});

describe('SMTP_PRESETS', () => {
  it('todos los presets pasan el schema del form al aplicarse', () => {
    for (const p of SMTP_PRESETS) {
      const result = smtpFormSchema.safeParse({
        host: p.host,
        port: p.port,
        encryption: p.encryption,
        username: p.username ?? 'usuario@dominio.com',
        password: 'clave',
        fromEmail: 'noreply@dominio.com',
      });
      expect(result.success, p.key).toBe(true);
    }
  });

  it('el cifrado de cada preset coincide con la convención de su puerto', () => {
    for (const p of SMTP_PRESETS) {
      const canonical = canonicalEncryptionForPort(p.port);
      if (canonical) expect(p.encryption, p.key).toBe(canonical);
    }
  });

  it('cada preset se detecta a sí mismo por su propio host', () => {
    for (const p of SMTP_PRESETS) {
      expect(detectSmtpPreset(p.host), p.key).toBe(p.key);
    }
  });
});

describe('detectSmtpPreset', () => {
  it('detecta variantes reales del host (regiones, mayúsculas, espacios)', () => {
    expect(detectSmtpPreset('smtp.mailgun.org')).toBe('mailgun');
    expect(detectSmtpPreset('email-smtp.us-east-1.amazonaws.com')).toBe('ses');
    expect(detectSmtpPreset('  SMTP.GMAIL.COM  ')).toBe('gmail');
  });

  it('null con host propio, desconocido o vacío', () => {
    expect(detectSmtpPreset('mail.mi-academia.com')).toBeNull();
    expect(detectSmtpPreset('')).toBeNull();
    expect(detectSmtpPreset('   ')).toBeNull();
  });
});
