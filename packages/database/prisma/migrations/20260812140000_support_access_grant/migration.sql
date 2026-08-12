-- U8 — acceso de soporte de vida corta.
--
-- Tabla NUEVA y nada más. No se altera ninguna tabla existente, no se escribe
-- ninguna fila y no hay defaults que cambien el comportamiento de nadie: una
-- instalación que actualice se queda exactamente como estaba, sin acceso de
-- soporte, hasta que su operador emita la primera concesión a mano.
--
-- Lleva `tenant_id`, así que `rls.sql` le aplica sola la política de
-- aislamiento por tenant al reaplicarse tras la migración. Las operaciones que
-- la tocan son cross-tenant por naturaleza (un operador de instancia sobre un
-- tenant que no es el suyo) y corren bajo `runGlobalWithoutTenant`.
CREATE TABLE "support_access_grant" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "reason" VARCHAR(280) NOT NULL,
    "issued_by_kind" VARCHAR(20) NOT NULL,
    "issued_by_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "redeemed_at" TIMESTAMP(3),
    "session_id" UUID,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_access_grant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "support_access_grant_token_hash_key" ON "support_access_grant"("token_hash");

CREATE INDEX "support_access_grant_tenant_id_expires_at_idx" ON "support_access_grant"("tenant_id", "expires_at");

ALTER TABLE "support_access_grant" ADD CONSTRAINT "support_access_grant_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
