# AGENTS.md — Guía para agentes y contribuidores

## Objetivo del producto

Construir **Group Repair**, un sistema profesional de gestión de servicios técnicos (TSMS) para talleres de reparación de móviles, electrodomésticos y electrónica, incluidos microsoldadura y diagnóstico de placas. No es una demo ni un CRUD genérico: debe conservar trazabilidad verificable desde la recepción hasta la entrega y garantía.

Consulta `SPEC.md` antes de implementar o cambiar funcionalidades. Mantén `README.md` actualizado cuando cambien instalación, configuración, comandos, arquitectura o despliegue.

## Principios de ingeniería

- Prioriza exactitud operativa, integridad de datos, seguridad, accesibilidad y facilidad de mantenimiento sobre añadir funciones sin terminar.
- Modela explícitamente estados, transiciones y reglas de negocio. No elimines ni sobrescribas silenciosamente el historial.
- Separa interfaz, lógica de dominio y persistencia. Valida en servidor toda entrada y autorización; las validaciones del cliente son solo UX.
- Usa TypeScript con modo estricto en el código de aplicación, componentes pequeños y responsabilidades claras. Evita `any`, duplicación y dependencias innecesarias.
- Toda fecha se persiste en UTC y se presenta en la zona horaria configurada para el taller. Representa dinero con unidades menores enteras y moneda explícita; no uses aritmética de punto flotante para importes.
- Usa identificadores estables, claves foráneas, restricciones e índices adecuados. Aplica migraciones versionadas y reversibles cuando sea viable; nunca alteres producción manualmente sin migración revisada.
- No registres contraseñas, tokens, datos de pago sensibles ni información privada innecesaria en logs. No almacenes datos completos de tarjetas.
- No incluyas secretos en el repositorio. Usa variables de entorno documentadas y archivos de ejemplo sin valores reales.
- No declares una función desplegada, probada o integrada si no se ejecutó y verificó realmente.

## Requisitos para cambios

1. Lee esta guía y la sección pertinente de `SPEC.md` antes de editar.
2. Para cada flujo, considera estados vacíos, carga, error, permisos insuficientes, datos inválidos y uso en móvil.
3. Mantén auditoría para operaciones sensibles; las acciones críticas deben registrar actor, fecha, entidad y cambio relevante sin exponer secretos.
4. Añade o actualiza pruebas junto al cambio: pruebas unitarias de reglas, integración de persistencia/API y pruebas de flujo cuando corresponda.
5. Comprueba los comandos disponibles en `package.json` o configuración equivalente. Ejecuta formato/lint, tipos, pruebas y compilación antes de cerrar el trabajo; informa claramente de cualquier comprobación que no pudiera ejecutarse.
6. Revisa cambios por riesgos de autorización, exposición entre talleres, XSS, CSRF, inyección, cargas de archivos, abuso de endpoints, secretos y migraciones destructivas.
7. Actualiza documentación y configuración de despliegue si el cambio las afecta.

## Seguridad y privacidad

- Deniega por defecto. Toda lectura y escritura de datos debe estar limitada al taller/tenant activo y autorizada por rol y propiedad del recurso.
- Nunca confíes en un `tenant_id`, rol, precio, total, estado o identidad enviados por el cliente: derivarlos de contexto autenticado y reglas de servidor.
- Protege adjuntos privados con autorización en cada descarga, límites de tamaño y tipo, nombres aleatorios y análisis antimalware cuando esté disponible. No sirvas archivos privados desde URLs públicas permanentes.
- Aplica controles contra CSRF/XSS/inyección, límites de tasa donde corresponda, cookies seguras y cabeceras seguras. Usa hash de contraseñas moderno si la autenticación es propia; preferir proveedor de identidad gestionado.
- Recoge solo datos necesarios, define retención y eliminación conforme a la jurisdicción del despliegue y ofrece exportación/borrado cuando corresponda. Nunca atribuyas cumplimiento legal no auditado.

## Interfaz y accesibilidad

- Interfaz en español por defecto, responsive y usable con teclado; usa etiquetas, foco visible, contraste suficiente y mensajes de error comprensibles.
- No comuniques estados solo con color. Confirma acciones irreversibles o sensibles y evita patrones oscuros.
- Formularios deben preservar datos ante errores cuando sea seguro y distinguir claramente borrador de información confirmada.

## Git y cambios

- Usa commits pequeños y descriptivos cuando el flujo de trabajo lo permita.
- No añadas dependencias, licencias, credenciales, datos reales de clientes ni archivos generados innecesarios.
- No cambies contratos públicos o esquema sin documentar impacto y estrategia de migración.
