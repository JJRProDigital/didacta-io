-- U7 — congelación de altas nuevas por tenant.
--
-- Dos columnas anulables y ningún default: una instalación existente queda
-- exactamente como estaba, admitiendo altas. Esto es deliberado y es lo que
-- garantiza que la funcionalidad no cambie el comportamiento de ninguna
-- instalación self-hosted mientras su operador no la encienda a mano.
ALTER TABLE "tenant" ADD COLUMN "signups_frozen_at" TIMESTAMP(3);
ALTER TABLE "tenant" ADD COLUMN "signups_frozen_reason" TEXT;
