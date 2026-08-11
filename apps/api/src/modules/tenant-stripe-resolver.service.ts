/**
 * Copyright (c) VA360 LABS S.L.
 * SPDX-License-Identifier: LicenseRef-Didacta-Sustainable-Use
 */

import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { TenantConfigService } from '@didacta/core-kernel';

/**
 * Credenciales Stripe de un tenant (o del fallback global de instancia).
 * Un solo par, compartido por mod.billing y mod.subscriptions — igual que
 * hoy comparten `STRIPE_SECRET_KEY` a nivel de instancia. No pueden separarse
 * en dos pares independientes: `subscriptions-webhook.controller.ts` reenvía
 * eventos ya verificados a mod.billing (`dispatchToBilling`) sin volver a
 * comprobar firma — un secret distinto por módulo rompería ese fan-out.
 */
export const StripeCredentialsSchema = z.object({
  secretKey: z.string().min(1),
  webhookSecret: z.string().min(1),
  /** Si falta, mod.subscriptions cae a `webhookSecret` (mismo criterio que hoy con SUBSCRIPTIONS_WEBHOOK_SECRET). */
  subscriptionsWebhookSecret: z.string().min(1).optional(),
});

export type StripeCredentials = z.infer<typeof StripeCredentialsSchema>;

export type StripeCredentialsSource = 'tenant' | 'tenant_unverified' | 'global' | 'none';

export interface ResolvedStripeCredentials {
  credentials: StripeCredentials;
  source: StripeCredentialsSource;
  verified: boolean;
}

/**
 * Lector del candado `billing.allowGlobalStripeFallback` (`instance_setting`).
 * Se inyecta como función y no como servicio para no arrastrar el grafo de DI
 * hasta aquí: este resolutor se construye A MANO en `ModuleRegistryService`.
 */
export type GlobalFallbackFlagReader = () => Promise<boolean>;

/** Cuánto se cachea el candado. `resolve()` corre en cada checkout y en cada webhook. */
const FLAG_CACHE_MS = 60_000;

/**
 * Resolutor centralizado de credenciales Stripe por tenant.
 *
 * Mismo patrón que `TenantSmtpResolverService`:
 * 1. Si el tenant tiene credenciales propias en `tenant_setting`
 *    (scope=`billing`, key=`stripe`) → usar esas.
 * 2. Si no, si hay env globales (`STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`)
 *    → fallback de instancia (cubre despliegues que aún no migraron al panel).
 * 3. Si nada de lo anterior aplica → `null`.
 *
 * ⚠️ El escalón 2 es un camino HEREDADO. En un despliegue multi-tenant de verdad
 * —un pool donde conviven academias de distintos dueños— heredar la clave de
 * `STRIPE_SECRET_KEY` significa que el dinero de los alumnos de un tenant sin
 * configurar entra en la cuenta de Stripe del OPERADOR, en silencio y sin error.
 * Por eso existe el candado `billing.allowGlobalStripeFallback`: por defecto
 * `true` (no rompe a ningún self-hoster que hoy cobre por env), y a `false`
 * el escalón 2 desaparece y el tenant sin credenciales propias resuelve a
 * `null` → el checkout falla con un error claro en vez de cobrar mal.
 *
 * NO loguea credenciales nunca. Solo `source`/`verified` para poder
 * correlacionar fallos con el origen real sin filtrar secretos.
 */
@Injectable()
export class TenantStripeResolverService {
  private readonly logger = new Logger(TenantStripeResolverService.name);

  private flagCache?: { value: boolean; expiresAt: number };

  constructor(
    private readonly tenantConfig: TenantConfigService,
    private readonly readGlobalFallbackFlag?: GlobalFallbackFlagReader,
  ) {}

  async resolve(tenantId: string): Promise<ResolvedStripeCredentials | null> {
    const tenantResolved = await this.readTenantConfig(tenantId);
    if (tenantResolved) return tenantResolved;

    if (!(await this.globalFallbackAllowed())) return null;

    const globalCredentials = this.readGlobalConfig();
    if (globalCredentials) {
      return { credentials: globalCredentials, source: 'global', verified: false };
    }
    return null;
  }

  /** Invalida el cache del candado. Lo llama el panel al guardar el setting. */
  invalidateGlobalFallbackFlag(): void {
    this.flagCache = undefined;
  }

  /**
   * ¿Se permite heredar las credenciales de instancia? Default `true` para no
   * cambiar el comportamiento de nadie que actualice. Si la lectura falla se
   * asume `true` por la misma razón: un problema de BD no puede convertirse en
   * un corte de cobros.
   */
  private async globalFallbackAllowed(): Promise<boolean> {
    if (!this.readGlobalFallbackFlag) return true;

    const now = Date.now();
    if (this.flagCache && this.flagCache.expiresAt > now) return this.flagCache.value;

    let value = true;
    try {
      value = await this.readGlobalFallbackFlag();
    } catch (err) {
      this.logger.warn(
        `[stripe-resolver] no se pudo leer billing.allowGlobalStripeFallback: ` +
          `${(err as Error).message.slice(0, 200)}. Se asume permitido.`,
      );
    }
    this.flagCache = { value, expiresAt: now + FLAG_CACHE_MS };
    return value;
  }

  /** Variante solo-tenant, sin caer al fallback global — usada por el botón "Probar conexión" del panel. */
  async resolveTenantOnly(tenantId: string): Promise<ResolvedStripeCredentials | null> {
    return this.readTenantConfig(tenantId);
  }

  async hasTenantConfig(tenantId: string): Promise<boolean> {
    return (await this.readTenantConfig(tenantId)) !== null;
  }

  private async readTenantConfig(tenantId: string): Promise<ResolvedStripeCredentials | null> {
    let raw: unknown;
    try {
      raw = await this.tenantConfig.get(tenantId, 'billing', 'stripe');
    } catch (err) {
      this.logger.warn(
        `[stripe-resolver] no se pudo leer Stripe del tenant ${tenantId}: ${(err as Error).message.slice(0, 200)}. ` +
          'Cae al fallback global si está disponible.',
      );
      return null;
    }
    if (!raw) return null;

    const parsed = StripeCredentialsSchema.parse(raw);
    let meta: { verifiedAt?: string | null } | undefined;
    try {
      meta = (await this.tenantConfig.get(tenantId, 'billing', 'stripe_meta')) as
        | { verifiedAt?: string | null }
        | undefined;
    } catch {
      meta = undefined;
    }
    const verified = Boolean(meta?.verifiedAt);
    return {
      credentials: parsed,
      source: verified ? 'tenant' : 'tenant_unverified',
      verified,
    };
  }

  private readGlobalConfig(): StripeCredentials | null {
    const secretKey = process.env['STRIPE_SECRET_KEY']?.trim();
    const webhookSecret = process.env['STRIPE_WEBHOOK_SECRET']?.trim();
    if (!secretKey || !webhookSecret) return null;

    const subscriptionsWebhookSecret =
      process.env['SUBSCRIPTIONS_WEBHOOK_SECRET']?.trim() || undefined;
    const candidate = { secretKey, webhookSecret, subscriptionsWebhookSecret };
    const result = StripeCredentialsSchema.safeParse(candidate);
    return result.success ? result.data : null;
  }
}
