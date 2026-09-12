# Cuidamos — Visión del producto

> **Fuente de verdad** para el Tech Lead y los agentes del bucle de desarrollo. Cualquier issue que se implemente debe poder justificarse contra este documento.

---

## Nombre

**Cuidamos** (provisional).

## Problema

Familias españolas que coordinan el cuidado de un familiar mayor dependiente entre varios hermanos/familiares hoy lo hacen por WhatsApp, notas sueltas y llamadas. Resultado: errores ("¿le diste ya la pastilla de las 5?"), sobrecarga desigual, pérdida de información crítica.

## Usuario objetivo

- Hijo/a de **40-55 años**.
- Coordina con **1-3 hermanos** el cuidado de padre/madre dependiente.
- Ya paga cuidador externo, pañales, medicación.
- Dispuesto a pagar **5-10€/mes** por dejar de depender del caos de WhatsApp.

## Diferenciación vs. calendario familiar genérico (Cozi, FamilyWall, etc.)

1. **Reparto de turnos visible y equilibrado** entre cuidadores (evita el "siempre cuido yo").
2. **Medicación con confirmación de toma en tiempo real** (no solo recordatorio).
3. **Traspasos de turno** tipo diario de guardia (notas cortas al terminar).
4. **Ficha centralizada** de la persona cuidada (médicos, seguro, contactos, documentos).

---

## Alcance del MVP (orden de prioridad)

| # | Feature | Descripción |
|---|---|---|
| F1 | Autenticación y grupo familiar | Crear familia, invitar a otros cuidadores, perfil de cada uno |
| F2 | Persona cuidada (perfil central) | Nombre, condición, médicos, contactos de emergencia |
| F3 | Calendario de turnos | Vista semana/mes, asignación de turnos, visualización de horas/turnos por cuidador |
| F4 | Registro de medicación | Lista con horario y dosis, marca "dado" con hora real y nota |
| F5 | Traspaso de turno | Formulario rápido al cerrar turno (3-4 campos) |
| F6 | Notificaciones | Recordatorio de turno próximo y medicación pendiente |

## Fuera de alcance del MVP

- Facturación / pagos.
- Gestión de gastos compartidos.
- Integración con calendarios externos (Google Calendar).
- Multi-persona-cuidada por familia (v1: 1 sola).

---

## Stack técnico

- **App**: React Native con **Expo** (build vía `eas build`, APK para pruebas / AAB para Play Store).
- **Backend**: **Supabase** (Postgres + Auth + Row Level Security + Storage + Edge Functions).
- **Notificaciones**: Expo Notifications (FCM por debajo).
- **Distribución**: EAS Build → Play Console, **track de pruebas cerradas** hasta validar con familias reales.

**Justificación**: el MVP es una app nativa Android desde el día 1 (no PWA), porque el canal de distribución de las familias objetivo es Play Store.

---

## Requisitos NO negociables

### Privacidad / RGPD (art. 9 — datos de salud)

- **Cifrado en reposo** de campos de salud (pgcrypto).
- **Row-Level Security** estricto: solo miembros de la familia leen/escriben sus datos.
- **Consentimiento explícito** registrado al crear el perfil de la persona cuidada.
- **Política de privacidad** clara accesible desde la app.
- **Borrado total** de datos de la familia bajo demanda (RGPD art. 17).
- **Exportación** de datos de la familia (RGPD art. 20).

### Google Play (app de salud)

- Cuenta desarrollador con verificación de identidad (trámite en paralelo).
- Formulario **Data Safety** en Play Console.
- **No sustituye criterio médico**: declararlo explícito en la UI y en la ficha de Play Store para evitar clasificación como app médica.
- **Permisos mínimos**: solo notificaciones en el MVP. Nada de contactos, ubicación, almacenamiento.

### UX / producto

- **Cero fricción en el reparto**: el usuario debe poder ver en <1 vista quién cubrió qué.
- **Traspaso de turno < 30 segundos**: máximo 4 campos, escritura mínima.
- **Marcar medicación como dada < 3 tap**: acción crítica de alta frecuencia.

---

## Criterios de "cumple la idea" (para el Tech Lead)

Cualquier issue implementada debe superar estas preguntas:

1. **¿Reduce la fricción actual del WhatsApp?** Si el flujo requiere más pasos que un mensaje de WhatsApp, algo está mal.
2. **¿Respeta RGPD?** Si toca campos de salud sin cifrar o sin RLS, es un BLOCK.
3. **¿Es Android-first?** No hay concesiones para web o iOS en el MVP.
4. **¿Es visible el reparto entre cuidadores?** Aunque la issue sea puntual, no debe romper la métrica de reparto.
5. **¿Está documentado el "no consejo médico"** si toca la ficha médica o medicación?

---

## Fuera del bucle autónomo (queda a humano)

- Alta y verificación de cuenta Play Console.
- Redacción legal de la política de privacidad.
- Formulario Data Safety en Play Console.
- Firma de AAB para producción.
- Contratación de DPO (si escala más allá de 3-5 familias beta).
