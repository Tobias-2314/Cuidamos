/**
 * Arma el deep link compartible de una invitación (PGM-18).
 *
 * El backend (PGM-19) NO envía emails -- `create_family_invitation` solo
 * devuelve un token. El Frontend arma este link y lo comparte con `Share` de
 * React Native (WhatsApp, email, lo que elija el usuario); ver NOTES del
 * agente para el detalle de esta decisión de producto.
 *
 * Usa el `scheme` ya configurado en `app.json` (`cuidamos://`) + la ruta de
 * Expo Router `app/join/[token].tsx`, así el link abre la app directo en la
 * pantalla de aceptar invitación.
 */
export function buildInvitationLink(token: string): string {
  return `cuidamos://join/${token}`;
}

/**
 * Texto listo para pegar en el share sheet nativo (`Share.share`) --
 * mensaje corto en español explicando qué es el link, para que quien lo
 * reciba por WhatsApp/email entienda de qué se trata sin contexto adicional.
 */
export function buildInvitationShareMessage(token: string): string {
  return `Te invito a unirte a nuestra familia en Cuidamos. Abrí este link desde tu teléfono: ${buildInvitationLink(token)}`;
}
