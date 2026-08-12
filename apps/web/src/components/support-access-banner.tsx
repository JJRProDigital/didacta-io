'use client';

/**
 * Copyright (c) VA360 LABS S.L.
 * SPDX-License-Identifier: LicenseRef-Didacta-Sustainable-Use
 */

/// Aviso permanente mientras un acceso de soporte (U8) está abierto.
///
/// Es la contrapartida visible de dejar entrar a soporte en el aula de un
/// cliente. Sin él, el acceso sería una puerta silenciosa; con él, cualquiera
/// que mire la pantalla —el propio agente de soporte, o el cliente sentado al
/// lado en una videollamada— ve que hay alguien de fuera dentro, por qué, y
/// cuánto le queda.
///
/// Tres decisiones deliberadas:
///
/// - **No se puede cerrar.** No hay botón de descartar ni estado que lo
///   esconda. Un aviso que se puede quitar deja de ser una garantía y pasa a
///   ser una cortesía. `support-access.test.ts` comprueba que sigue sin tenerlo.
///
/// - **La verdad la dice el servidor.** El motivo y la caducidad se refrescan
///   contra `/auth/support-access/current`, no contra lo que quedó en el
///   navegador: si un operador revoca la concesión, el aviso se apaga y la
///   siguiente petición tumba la sesión.
///
/// - **La cuenta atrás corre.** Los quince minutos son una promesa; enseñarlos
///   descontando es lo que la hace creíble.

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { authStorage } from '@/lib/auth-storage';
import { remainingLabel, supportAccessApi, type SupportAccessContext } from '@/lib/support-access';

/** Cada cuánto se le vuelve a preguntar al servidor si la concesión sigue viva. */
const REVALIDATE_MS = 30_000;

export function SupportAccessBanner() {
  const t = useTranslations('shell');
  const [support, setSupport] = useState<SupportAccessContext | null>(null);
  const [restante, setRestante] = useState<string | null>(null);

  // Estado real, del servidor. Se pregunta siempre —no solo cuando el
  // navegador cree que hay acceso de soporte— porque lo que hay en
  // localStorage lo puede editar quien tenga la sesión, y este aviso existe
  // precisamente para que no dependa de su buena voluntad.
  useEffect(() => {
    let cancelado = false;

    async function consultar() {
      const token = authStorage.getAccessToken();
      if (!token) return;
      try {
        const actual = await supportAccessApi.current(token);
        if (!cancelado) setSupport(actual);
      } catch {
        // Sesión recién caída o API muda: no pintamos nada. El aviso solo
        // aparece cuando el servidor confirma que hay un acceso abierto.
      }
    }

    void consultar();
    const id = window.setInterval(() => void consultar(), REVALIDATE_MS);
    return () => {
      cancelado = true;
      window.clearInterval(id);
    };
  }, []);

  // Cuenta atrás. Se recalcula desde `expiresAt` en cada tick en vez de restar
  // uno: así una pestaña dormida no se despierta con un reloj adelantado.
  useEffect(() => {
    if (!support) {
      setRestante(null);
      return;
    }
    const tick = () => setRestante(remainingLabel(support.expiresAt));
    tick();
    const id = window.setInterval(tick, 1_000);
    return () => window.clearInterval(id);
  }, [support]);

  if (!support) return null;

  return (
    <div
      role="alert"
      className="flex items-center justify-center gap-3 border-b border-danger-700 bg-danger-600 px-4 py-1.5 text-[13px] font-medium text-white"
    >
      <p className="min-w-0 truncate">
        <strong className="font-semibold">{t('supportAccessBanner.title')}</strong>{' '}
        {t('supportAccessBanner.body', { reason: support.reason })}
      </p>
      <span className="shrink-0 rounded bg-white/20 px-2 py-0.5 font-mono tabular-nums">
        {restante ?? t('supportAccessBanner.expired')}
      </span>
    </div>
  );
}
