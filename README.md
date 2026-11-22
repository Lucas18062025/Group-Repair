# Group Repair

![Group Repair](./Group-Repair.jpg)

Plataforma de gestión de servicios técnicos (TSMS) para talleres de reparación de móviles, electrodomésticos y electrónica. Diseñada para administrar de forma trazable la recepción de equipos, el diagnóstico, las reparaciones, presupuestos, repuestos, pagos, entregas y garantías.

> **Estado:** especificación y guía de contribución iniciales. La presencia de estos documentos no implica que la aplicación esté implementada, probada ni desplegada.

## Visión

Group Repair busca reemplazar registros dispersos por un flujo de trabajo profesional: cada equipo y cada decisión quedan vinculados a una orden, con responsable y fecha. No pretende ser un CRUD genérico: incorpora estados controlados, historial auditable y trazabilidad desde la recepción hasta la entrega y la garantía.

## Alcance del producto

- Clientes, equipos e historial técnico.
- Órdenes con estados controlados y cronología auditable.
- Diagnósticos, trabajos, control de calidad y evidencia privada.
- Presupuestos versionados y aceptación registrada.
- Repuestos con movimientos de stock trazables.
- Pagos parciales y ajustes/reembolsos sin borrar el historial.
- Entrega, garantía y reclamaciones vinculadas a la reparación original.
- Panel e informes con autorización por rol y aislamiento de cada taller.

Consulta [`SPEC.md`](SPEC.md) para el alcance funcional y criterios de aceptación, y [`AGENTS.md`](AGENTS.md) para las convenciones de desarrollo y seguridad.

## Estado del proyecto

El repositorio comienza con documentación de producto. La arquitectura, stack, aplicación ejecutable, pruebas, CI y despliegue deberán incorporarse y verificarse antes de considerar el sistema listo para uso real.

## Configuración operativa

- Jurisdicción: San Miguel de Tucumán, Tucumán, Argentina.
- Moneda: pesos argentinos (`ARS`) en unidades menores enteras.
- Horario: lunes a sábado, 9:00 a 21:00 de corrido.
- Domingo: cerrado.
- Consultas de garantía: `+54 9 381 524-9553`.

## Persistencia

Los datos operativos se guardan en Cloudflare D1, vinculada al Worker mediante `DB`. Las migraciones versionadas están en `migrations/` y el entorno local usa una copia SQLite gestionada por Wrangler. No se almacenan datos personales reales ni datos de tarjetas en el repositorio.

## Google y Gemini

La arquitectura de autenticación y las conexiones OAuth están implementadas, pero las integraciones reales permanecen desactivadas hasta configurar credenciales externas:

- Google Cloud: OAuth 2.0 Web Client ID, Client Secret, consent screen, redirect URI `https://group-repair.lucaslean1806.workers.dev/api/auth/callback/google` y APIs habilitadas.
- Google Identity: configurar `GOOGLE_CLIENT_ID`. El `GOOGLE_BOOTSTRAP_SUB` solo se usa una vez para el aprovisionamiento inicial del primer administrador y no debe mostrarse en la interfaz pública.
- OAuth: configurar `OAUTH_TOKEN_ENCRYPTION_KEY` con una clave aleatoria de 32 bytes.
- Gemini: configurar `GEMINI_API_KEY`, opcionalmente `GEMINI_MODEL` y `GEMINI_DAILY_LIMIT`.
- Google Sheets necesita permisos de hojas y Drive; Drive y Sheets priorizan scopes limitados a archivos creados o seleccionados.
- Google Photos usa Photos Picker y no solicita acceso indiscriminado a toda la biblioteca.

### Estado Testing y cuentas externas

Mientras el Consent Screen de Google esté en **Testing**, solo pueden autorizarse las cuentas agregadas en:

`Google Cloud Console > APIs y servicios > Pantalla de consentimiento de OAuth > Usuarios de prueba`

Agregar como usuario de prueba cada cuenta Google habilitada. Para usuarios externos sin verificación limitada:

1. Completar Branding, dominios autorizados, soporte, privacidad y términos.
2. Habilitar las APIs reales utilizadas.
3. Publicar la aplicación o iniciar el proceso de verificación de Google.
4. Mantener el acceso pendiente hasta aprobar/verificar las cuentas correspondientes.

Ejemplo de secretos sin valores reales:

```powershell
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_BOOTSTRAP_SUB
npx wrangler secret put OAUTH_TOKEN_ENCRYPTION_KEY
npx wrangler secret put GEMINI_API_KEY
```

## Desarrollo

A partir de este estado, el repositorio incluye una aplicación inicial con React, TypeScript, Vite, Cloudflare Workers y Cloudflare D1.

Requisitos:

- Node.js 22 o compatible.
- Cuenta de Cloudflare con acceso a D1 y Workers.
- `npm`.

Comandos:

```powershell
npm install
npm run cf:types
npm run cf:migrate
npm run dev
npm test
npm run typecheck
npm run build
npx wrangler deploy --dry-run
```

La migración local se encuentra en `migrations/0001_initial.sql`. La configuración Cloudflare está en `wrangler.jsonc`. Los importes se representan en unidades menores enteras; no se procesan números reales ni pagos sensibles en esta fase inicial.

## Seguridad y estado operativo

La implementación actual incorpora persistencia, trazabilidad básica, máquina de estados y validaciones del dominio. No debe considerarse lista para datos reales hasta integrar autenticación de usuarios, autorización por taller y rol, protección avanzada y verificaciones operativas completas.

## Seguridad y privacidad

Reporta vulnerabilidades de forma privada al propietario/administrador del repositorio; no publiques datos de clientes, credenciales, tokens ni evidencia privada en issues. No almacenes números completos de tarjeta ni datos personales innecesarios. El repositorio no garantiza cumplimiento legal por sí mismo.

## Despliegue

No existe despliegue configurado todavía. El despliegue futuro debe gestionar secretos fuera del repositorio, aplicar migraciones revisadas, proteger adjuntos, separar entornos y verificar build, migración y pruebas antes de cada publicación.

## Licencia

No se ha definido una licencia. Todos los derechos reservados hasta que el propietario del proyecto añada una licencia explícita.
