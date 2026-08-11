/**
 * Copyright (c) VA360 LABS S.L.
 * SPDX-License-Identifier: LicenseRef-Didacta-Sustainable-Use
 */

/**
 * Quién ejecuta una operación de administración de tenants: una persona con
 * sesión, o el plano de control con su credencial de provisioning.
 *
 * Existe para que el audit log pueda decir la verdad. Antes de UC-C103 el
 * actor era un `string` y solo podía ser un `user.id`; meter ahí el id de una
 * credencial de máquina habría dejado filas indistinguibles de las de un
 * humano, que es justo lo que un log de auditoría no puede permitirse.
 */
export type AdminActor =
  | { kind: 'user'; userId: string }
  | { kind: 'provisioning'; credentialId: string };

/**
 * Lo que va a `audit_log.actor_id` (columna uuid, nullable, sin FK a `user`).
 * Para una máquina es el UUID de la credencial: así el índice por actor sirve
 * también para responder «qué hizo el plano de control».
 */
export function auditActorId(actor: AdminActor): string {
  return actor.kind === 'user' ? actor.userId : actor.credentialId;
}

/**
 * Marca que se mezcla en `metadata` para distinguir una acción de máquina de
 * una humana. Para un humano no añade nada: las filas históricas no cambian de
 * forma y la cadena de hashes del audit log sigue verificando igual.
 */
export function auditActorTrace(actor: AdminActor): { actorKind?: 'provisioning' } {
  return actor.kind === 'provisioning' ? { actorKind: 'provisioning' } : {};
}
