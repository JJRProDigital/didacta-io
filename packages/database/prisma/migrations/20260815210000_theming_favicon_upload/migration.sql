-- mod.theming — subida de favicon (lote de feedback de onboarding).
--
-- El favicon solo existía como URL externa pegada a mano (favicon_url).
-- Estas dos columnas son el espejo de logo_storage_key / logo_mime_type:
-- key del blob en el StorageService y MIME real con el que servirlo desde
-- el endpoint público. NULL = URL externa o sin favicon, como hasta hoy,
-- así que ninguna instalación que actualice cambia de comportamiento.

ALTER TABLE "mod_theming_tenant_theme"
  ADD COLUMN "favicon_storage_key" TEXT,
  ADD COLUMN "favicon_mime_type" TEXT;
