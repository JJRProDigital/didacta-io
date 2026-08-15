'use client';

/**
 * Copyright (c) VA360 LABS S.L.
 * SPDX-License-Identifier: LicenseRef-Didacta-Sustainable-Use
 */

import { CommunityFeed } from '@/components/community-feed';
import { GettingStartedChecklist } from '@/components/getting-started-checklist';

export default function ComunidadPage() {
  return (
    <div className="space-y-4">
      {/* Solo admins con el asistente completado y pasos pendientes; para el
          resto rinde null y el feed queda como estaba. `/inicio` redirige
          aquí: este es el aterrizaje real del panel. */}
      <GettingStartedChecklist />
      <CommunityFeed />
    </div>
  );
}
