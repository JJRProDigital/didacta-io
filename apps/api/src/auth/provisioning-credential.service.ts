/**
 * Copyright (c) VA360 LABS S.L.
 * SPDX-License-Identifier: LicenseRef-Didacta-Sustainable-Use
 */

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaInstanceConfigService } from '../modules/prisma-instance-config.service';

const SCOPE = 'provisioning';
const KEY = 'credential';
const TOKEN_PREFIX = 'didprov_';

/**
 * Ventana máxima que puede sobrevivir una credencial ya revocada en una réplica
 * que no fue la que la revocó. Ver el doc-comment de la clase.
 */
const VERIFY_CACHE_TTL_MS = 60_000;

/** Lo que se persiste. El token en plano no se guarda en ninguna parte. */
interface StoredCredential {
  /** UUID propio de la credencial. Es lo que se escribe como actor en el audit log. */
  id: string;
  /** SHA-256 hex del token en plano. */
  hash: string;
  /** Primeros y últimos caracteres, para que un humano reconozca cuál está viva. */
  preview: string;
  createdAt: string;
  /** userId del super_admin que la emitió. */
  createdById: string;
}

export interface IssuedProvisioningCredential {
  id: string;
  /** Token en plano. Se devuelve UNA SOLA VEZ, al emitirla. */
  token: string;
  preview: string;
  createdAt: string;
}

/** Actor de máquina que autentica una petición de provisioning. */
export interface ProvisioningActor {
  credentialId: string;
}

/**
 * Credencial de PROVISIONING: la que usa un plano de control externo (Didacta
 * Cloud, o el script de cualquier self-hoster) para operar la lista de tenants
 * de la instancia sin hacerse pasar por una persona.
 *
 * ## Por qué no es una `ApiKey`
 *
 * `ApiKey` está atada a un tenant (`tenant_id` + `user_id`, ambos con FK), y
 * `JwtOrApiKeyGuard` construye los claims con `tenantId: key.tenantId` y
 * `roles: key.scopes`. Una credencial atada a un tenant no puede autorizar
 * «crear un tenant nuevo»: habría que inventar un tenant y un usuario falsos, y
 * ensanchar la comprobación de super_admin para un scope que vive en la misma
 * lista que `courses:read`. Cualquier ampliación futura de esa lista se
 * convertiría en una vía de escalada cross-tenant.
 *
 * Por eso es una credencial de INSTANCIA: vive en `core_instance_setting`
 * (tabla global, sin RLS), no tiene tenant ni usuario, y solo abre la lista
 * blanca de rutas declarada con `@AllowProvisioning()`.
 *
 * ## Qué se guarda
 *
 * Solo el SHA-256 del token, y además cifrado en reposo (`isSecret: true`, la
 * misma AES-256-GCM que el resto de secretos de instancia). El plano se enseña
 * una vez, al emitirla. Emitir otra revoca la anterior — la instancia tiene una
 * credencial viva como mucho.
 *
 * ## Revocación y caché
 *
 * La verificación cachea la fila ≤ 60 s para no pegar a la BD (con descifrado)
 * en cada petición del plano de control. La caché se invalida en el acto al
 * emitir o revocar, así que en una instalación de un solo proceso —el caso
 * normal de Community— revocar corta ya en la petición siguiente. En un pool
 * con varias réplicas, la réplica que revocó corta al instante y el resto como
 * mucho 60 s después: es el precio de no tener caché compartida, y está acotado
 * a propósito.
 */
@Injectable()
export class ProvisioningCredentialService {
  private readonly logger = new Logger(ProvisioningCredentialService.name);
  private cache: { record: StoredCredential | null; expiresAt: number } | null = null;

  constructor(private readonly settings: PrismaInstanceConfigService) {}

  /**
   * Emite una credencial nueva y devuelve el token en plano. Si ya había una,
   * queda revocada en el mismo acto (rotación).
   */
  async issue(actorId: string): Promise<IssuedProvisioningCredential> {
    const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    const record: StoredCredential = {
      id: randomUUID(),
      hash: this.hash(token),
      preview: `${token.slice(0, 14)}…${token.slice(-4)}`,
      createdAt: new Date().toISOString(),
      createdById: actorId,
    };

    const previous = await this.read();
    await this.settings.set(SCOPE, KEY, record, { isSecret: true, actorId });
    this.cache = null;

    this.logger.warn(
      `[provisioning] credencial ${record.id} emitida por ${actorId}` +
        (previous ? `; la anterior (${previous.id}) queda revocada` : ''),
    );

    return {
      id: record.id,
      token,
      preview: record.preview,
      createdAt: record.createdAt,
    };
  }

  /**
   * Resuelve el actor de máquina de un token. Devuelve null si no hay
   * credencial viva, si el token no tiene el prefijo o si no coincide.
   */
  async verify(token: string | null | undefined): Promise<ProvisioningActor | null> {
    if (!token || !token.startsWith(TOKEN_PREFIX)) return null;

    const now = Date.now();
    if (!this.cache || this.cache.expiresAt <= now) {
      this.cache = { record: await this.read(), expiresAt: now + VERIFY_CACHE_TTL_MS };
    }
    const record = this.cache.record;
    if (!record) return null;
    if (!this.matches(token, record.hash)) return null;

    return { credentialId: record.id };
  }

  /** Revoca la credencial viva. Idempotente: sin credencial devuelve `revoked: false`. */
  async revoke(actorId: string): Promise<{ revoked: boolean; id: string | null }> {
    const existing = await this.read();
    if (!existing) {
      this.cache = null;
      return { revoked: false, id: null };
    }

    await this.settings.delete(SCOPE, KEY, { actorId });
    this.cache = null;
    this.logger.warn(`[provisioning] credencial ${existing.id} revocada por ${actorId}`);
    return { revoked: true, id: existing.id };
  }

  private async read(): Promise<StoredCredential | null> {
    return (await this.settings.get<StoredCredential>(SCOPE, KEY)) ?? null;
  }

  private hash(plain: string): string {
    return createHash('sha256').update(plain).digest('hex');
  }

  private matches(candidate: string, storedHash: string): boolean {
    const candidateHash = Buffer.from(this.hash(candidate), 'hex');
    const stored = Buffer.from(storedHash, 'hex');
    if (candidateHash.length !== stored.length) return false;
    return timingSafeEqual(candidateHash, stored);
  }
}
