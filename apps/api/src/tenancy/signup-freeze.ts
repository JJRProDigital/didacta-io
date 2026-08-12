/**
 * Copyright (c) VA360 LABS S.L.
 * SPDX-License-Identifier: LicenseRef-Didacta-Sustainable-Use
 */

import { ConflictException } from '@nestjs/common';

/// Congelación de altas nuevas por tenant (U7).
///
/// ## Lo que ESTO es
///
/// Un interruptor explícito, y nada más. Un `super_admin` decide que un tenant
/// deja de admitir altas nuevas —porque la cohorte está llena, porque está
/// migrando, porque le da la gana— y las cuatro puertas de entrada devuelven
/// 409 con un código estable. Los miembros que ya están dentro no se enteran:
/// siguen entrando, estudiando y comprando como siempre.
///
/// ## Lo que ESTO no es, y no puede llegar a ser
///
/// **No es un tope.** El núcleo no cuenta miembros, no mira la licencia, no
/// sabe que existen los planes y no enciende esto solo. Si algún día alguien
/// añade aquí un `if (miembros > tope)`, Didacta Community deja de ser
/// fair-code y pasa a ser una versión capada, que es exactamente lo contrario
/// del producto.
///
/// Quien decide congelar es una persona, o el plano de control del SaaS
/// gestionado a través de la API pública — desde fuera, con su credencial, y
/// asumiendo él la política de negocio. Una instalación self-hosted arranca sin
/// congelar y se queda así para siempre mientras su operador no lo cambie: las
/// columnas son anulables, sin default, y la migración no toca ninguna fila.
///
/// Hay un test (`signup-freeze.test.ts`) que comprueba que este fichero no
/// importa el SDK de licencias ni cuenta nada. No es decorativo: es la barrera
/// que impide que la deriva ocurra sin que nadie se dé cuenta.

/** Código estable de la respuesta 409. Contrato: no se cambia. */
export const SIGNUPS_FROZEN_CODE = 'TENANT_SIGNUPS_FROZEN';

/** Lo mínimo que hace falta leer del tenant. */
export interface SignupFreezeState {
  signupsFrozenAt: Date | null;
  signupsFrozenReason: string | null;
}

/** Cliente Prisma reducido a lo que necesita esta comprobación. */
interface TenantReader {
  tenant: {
    findUnique(args: {
      where: { id: string };
      select: { signupsFrozenAt: true; signupsFrozenReason: true };
    }): Promise<SignupFreezeState | null>;
  };
}

export function isFrozen(state: SignupFreezeState | null | undefined): boolean {
  return Boolean(state?.signupsFrozenAt);
}

/**
 * Lanza 409 si el tenant tiene las altas congeladas.
 *
 * Se llama en las cuatro puertas de entrada de un miembro nuevo: invitación
 * individual, alta masiva por CSV (que pasa por la misma), registro público y
 * checkout de alumno. Deliberadamente NO se llama al reenviar invitaciones a
 * quien ya está dentro: esa persona ya es miembro y volver a avisarla no da de
 * alta a nadie.
 */
export async function assertSignupsAllowed(prisma: TenantReader, tenantId: string): Promise<void> {
  const state = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { signupsFrozenAt: true, signupsFrozenReason: true },
  });
  if (!isFrozen(state)) return;

  throw new ConflictException({
    code: SIGNUPS_FROZEN_CODE,
    message:
      state?.signupsFrozenReason?.trim() ||
      'Este espacio no admite altas nuevas ahora mismo. Los miembros actuales no están afectados.',
  });
}
