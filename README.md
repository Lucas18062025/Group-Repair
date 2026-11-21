# Group Repair

Plataforma de gestión de servicios técnicos (TSMS) para talleres de reparación de móviles, electrodomésticos y electrónica. Diseñada para administrar de forma trazable la recepción de equipos, diagnósticos, presupuestos, trabajos, repuestos, pagos, evidencias, entregas y garantías.

> **Estado:** especificación y guía de contribución iniciales. La presencia de estos documentos no implica que la aplicación esté implementada, probada ni desplegada.

## Visión
Group Repair busca reemplazar registros dispersos por un flujo de trabajo profesional: cada equipo y cada decisión quedan vinculados a una orden, con responsable y fecha. No pretende ser un CRUD genérico.

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
El repositorio comienza con documentación de producto. La arquitectura, stack, aplicación ejecutable, pruebas, CI y despliegue deberán incorporarse y verificarse antes de considerar el sistema listo para producción. No cargar datos personales reales en entornos de desarrollo.

## Desarrollo
Aún no se ha seleccionado ni configurado una pila de aplicación, por lo que todavía no hay comandos de instalación o ejecución. Cuando se agregue el código, documentar aquí:

1. Requisitos previos y versión de runtime.
2. Instalación de dependencias y configuración local.
3. Variables de entorno (sin valores secretos) y migraciones.
4. Comandos de desarrollo, lint, tipos, pruebas y compilación.
5. Arquitectura, decisiones de persistencia y límites de confianza.

## Seguridad y privacidad
Reporta vulnerabilidades de forma privada al propietario/administrador del repositorio; no publiques datos de clientes, credenciales, tokens ni evidencia privada en issues. No almacenes números completos de tarjeta ni CVV. Antes de operar con clientes reales, definir jurisdicción, política de privacidad/retención, copias de seguridad y procedimiento de incidentes. Consulta `AGENTS.md` y `SPEC.md`.

## Despliegue
No existe despliegue configurado todavía. El despliegue futuro debe gestionar secretos fuera del repositorio, aplicar migraciones revisadas, proteger adjuntos, separar entornos y verificar build, salud y URL pública antes de anunciarlo como activo. Cloudflare puede utilizarse si la arquitectura elegida y los permisos lo permiten.

## Licencia
No se ha definido una licencia. Todos los derechos reservados hasta que el propietario del proyecto añada una licencia explícita.
