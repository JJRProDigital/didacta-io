-- mod.theming — cómo se presenta la marca del tenant.
--
-- Una columna con default y nada más. 'logo_only' es EXACTAMENTE lo que ya
-- hacían el sidebar y /signin con un logo presente (el logo sustituye al
-- nombre, a su ancho natural), así que ninguna instalación que actualice
-- cambia de aspecto: la columna añade la elección ('logo_and_name' para
-- isotipos cuadrados que quieren el nombre al lado), no un comportamiento.

ALTER TABLE "mod_theming_tenant_theme"
  ADD COLUMN "logo_display_mode" TEXT NOT NULL DEFAULT 'logo_only';
