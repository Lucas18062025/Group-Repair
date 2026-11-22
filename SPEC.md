# SPEC.md — Especificación del producto Group Repair

## 1. Propósito y alcance

Group Repair es una plataforma de gestión de servicios técnicos (TSMS) para talleres que reparan teléfonos móviles, electrodomésticos y electrónica, realizan microsoldadura y diagnóstico de placas, sustituyen componentes y administran mantenimiento y garantías. El producto debe ser operativo, auditable y seguro; no una colección de pantallas CRUD sin flujo de negocio.

La aplicación debe ofrecer una fuente de verdad trazable para clientes, equipos, órdenes, diagnósticos, presupuestos, aprobaciones, trabajos, pagos, inventario, evidencias, entrega y garantía. Los objetivos iniciales son aplicación web responsive, soporte multiusuario por taller y capacidad de evolucionar sin perder historial.

## 2. Usuarios y permisos

Los roles son una base configurable por taller; asignar el menor privilegio necesario:

- **Propietario/administrador:** configura taller, usuarios, permisos, catálogos y parámetros; consulta informes y auditoría.
- **Recepción/atención:** registra clientes y equipos, crea órdenes, documenta recepción, entrega y comunica avances según permisos.
- **Técnico:** consulta órdenes asignadas, registra inspección, diagnóstico, tiempos, materiales, pruebas y evidencia.
- **Responsable técnico:** revisa diagnósticos, presupuestos y controles de calidad; puede aprobar excepciones autorizadas.
- **Caja/administración:** registra pagos, reembolsos y movimientos permitidos; no altera diagnósticos técnicos.
- **Consulta:** acceso de solo lectura al alcance concedido.

Toda autorización se valida en servidor. Cada recurso pertenece a un taller (tenant); ningún usuario debe consultar o modificar datos de otro taller. Los permisos concretos son configurables, pero el sistema debe denegar por defecto y separar funciones sensibles.

## 3. Módulos funcionales

### 3.1 Taller, usuarios y configuración

- Perfil del taller: nombre, datos de contacto, ubicación, zona horaria, moneda, formato de numeración y preferencias.
- Usuarios, invitaciones, roles, estado y sesiones; revocación de acceso.
- Catálogos configurables de marcas, categorías, fallos, servicios, métodos de pago y estados auxiliares.
- Configuración explícita de impuestos, moneda y reglas de numeración; no asumir jurisdicción fiscal.

### 3.2 Clientes

- Persona o empresa, nombre/razón social, teléfono, correo y dirección opcional.
- Búsqueda por nombre, teléfono, correo o identificador, con resultados paginados.
- Historial de equipos, órdenes, comunicaciones registradas y saldos asociados según permisos.
- Evitar duplicados mediante aviso y sugerencias; la fusión de registros, si existe, debe ser explícita y auditable.
- Limitar acceso a datos personales y facilitar corrección/exportación/eliminación conforme a política aplicable y retención obligatoria.

### 3.3 Equipos y recepción

- Equipo vinculado a cliente: tipo/categoría, marca, modelo, número de serie o IMEI opcional y enmascarado en vistas no autorizadas, color y accesorios recibidos.
- Registrar estado físico/funcional al ingreso, síntomas descritos por cliente, daños preexistentes, bloqueo/contraseña solo si es indispensable y con tratamiento seguro, fecha/hora y receptor.
- Checklist de recepción configurable por categoría. Capturar fotografías/archivos como evidencia con consentimiento y acceso privado.
- Entregar comprobante de recepción con identificador de orden y condiciones relevantes configurables.

### 3.4 Órdenes de reparación y ciclo de vida

- Número legible único por taller, fecha de apertura, cliente, equipo, descripción reportada, prioridad, técnico/responsable, fechas objetivo y canal/origen.
- Flujo base: **Recibida → En diagnóstico → Esperando aprobación → Aprobada / Rechazada → En reparación → En pruebas → Lista para entrega → Entregada**. Estados auxiliares: **En espera de repuesto**, **No reparable**, **Cancelada**, **Reabierta**. Configuración de etiquetas no debe romper las transiciones ni métricas.
- Toda transición registra actor, hora, estado anterior/nuevo y motivo cuando corresponda. Restringir transiciones inválidas y conservar historial; correcciones se registran como eventos, nunca se ocultan.
- Incluir asignación, notas internas, notas visibles al cliente, tareas, tiempos de trabajo, recordatorios y cronología unificada.
- Cancelación, reapertura, cierre y excepciones requieren permisos y motivo. No marcar entregada si hay controles de entrega pendientes definidos por el taller.

### 3.5 Diagnóstico y trabajo técnico

- Hallazgo, pruebas realizadas, causa probable/confirmada, nivel de certeza, fotos/documentos, componentes afectados, riesgos y recomendación.
- Historial de diagnóstico por autor y fecha; una corrección crea nueva versión o nota de rectificación.
- Registro de trabajo ejecutado, componentes usados, técnicos, duración y pruebas posteriores.
- Control de calidad configurable: funciones verificadas, resultado, técnico revisor y evidencia. Distinguir “no probado” de “correcto”.
- Advertir sobre datos del cliente y registrar consentimiento/instrucciones de respaldo o borrado cuando proceda; no prometer recuperación de datos.

### 3.6 Presupuestos y aprobación

- Presupuesto versionado ligado a orden, partidas de mano de obra/repuestos/servicios, cantidades, precios, descuentos, impuestos configurados, total y vigencia.
- Cálculos en servidor con unidades menores enteras y reglas de redondeo explícitas; preservar la versión aprobada.
- Estados: borrador, enviado, aprobado, rechazado, vencido y sustituido. Guardar actor, canal, fecha, alcance autorizado y evidencia de aceptación/rechazo.
- No iniciar trabajo facturable fuera del alcance aprobado salvo excepción autorizada y documentada; un cambio requiere nueva versión y aprobación cuando aplique.

### 3.7 Pagos y caja

- Registrar pagos parciales, anticipos, saldo, método, referencia externa opcional, fecha, usuario y orden/factura asociada.
- Reembolsos/anulaciones mediante movimientos compensatorios con motivo y permiso; no borrar movimientos asentados.
- No procesar ni almacenar PAN/CVV ni credenciales bancarias. El pago con tarjeta se integra mediante proveedor externo, si se implementa.
- Distinguir importe presupuestado, importe cobrado, reembolsos y saldo; generar recibo verificable.

### 3.8 Inventario y repuestos

- Catálogo de SKU, descripción, compatibilidad, proveedor opcional, ubicación, costo/precio y stock mínimo.
- Movimientos inmutables de entrada, salida por orden, reserva, liberación, ajuste y devolución con usuario, fecha, motivo y referencia. El saldo se deriva de movimientos o se mantiene con consistencia transaccional.
- Validar disponibilidad y evitar stock negativo salvo permiso y registro explícito. Registrar costo asociado a la orden; no cambiar retroactivamente el costo histórico.
- Alertas de bajo stock y trazabilidad de repuesto instalado, lote/serie cuando aplique.

### 3.9 Evidencias y documentos

- Adjuntos ligados a orden, diagnóstico, presupuesto o entrega con tipo, autor, fecha y descripción.
- Archivos privados, acceso autorizado por taller y recurso, límites de tamaño/tipo, nombre aleatorio y metadatos saneados. Registrar cargas/eliminaciones; si se permite eliminar, conservar evento y cumplir política de retención.
- Permitir comprobantes y reportes imprimibles; separar documentos internos de documentos compartibles con cliente.

### 3.10 Entrega y garantía

- Lista de verificación de entrega: identidad/representación, estado, accesorios devueltos, pruebas, saldo y conformidad; registrar fecha, actor y evidencia de recepción.
- Garantía configurable por taller/servicio y condiciones; registrar inicio, vencimiento, cobertura/exclusiones y documento entregado. No inferir obligaciones legales universales.
- Una reclamación de garantía se vincula a la orden original, registra síntomas, evaluación, decisión, trabajos y piezas; mantener historial y diferenciar garantía aprobada, rechazada y fuera de cobertura.

### 3.11 Panel, búsqueda e informes

- Panel con órdenes por estado, atrasos, trabajo pendiente, entregas, aprobaciones pendientes e indicadores de inventario.
- Búsqueda global autorizada por orden, cliente, equipo, serie/IMEI, teléfono y SKU; paginación, límites y enmascaramiento.
- Informes de carga de trabajo, tiempos, conversión de presupuestos, ingresos/movimientos, garantías y stock; filtros por periodo, técnico y estado. Definir indicadores y zona horaria. Exportación solo para roles autorizados, auditada y minimizada.

## 4. Modelo de dominio mínimo

Entidades con identificador estable y `tenant_id` obligatorio cuando contienen información del taller:

- `Workshop`, `User`, `Membership/Role`, `Customer`, `Device`.
- `RepairOrder`, `OrderStatusEvent`, `Assignment`, `WorkLog`, `Diagnostic`, `QualityCheck`, `InternalNote/CustomerUpdate`.
- `Quote`, `QuoteVersion`, `QuoteLine`, `ApprovalEvidence`.
- `PaymentTransaction`, `Refund/Adjustment`.
- `Part`, `StockMovement`, `Supplier` (opcional), `PartReservation`.
- `Attachment`, `DeliveryRecord`, `Warranty`, `WarrantyClaim`, `AuditEvent`.

Usar claves foráneas, restricciones de unicidad compuestas por taller donde corresponda, índices para búsquedas frecuentes y timestamps. Mantener invariantes en transacciones: total de presupuesto, balance y stock no pueden divergir por escrituras concurrentes. Auditar operaciones críticas sin duplicar información sensible.

## 5. Requisitos no funcionales

- Seguridad multi-tenant por defecto, autenticación segura, autorización por recurso/acción, protección contra CSRF/XSS/inyección, límites de tasa y gestión segura de secretos.
- Privacidad por diseño, minimización de datos, política configurable de retención, backups probados y procedimiento documentado de incidentes.
- Disponibilidad, rendimiento y recuperación medibles; objetivo inicial de UI utilizable en conexión normal y paginación del lado servidor para colecciones crecientes. Definir SLO y RPO/RTO antes de operar producción.
- Responsive, accesible con teclado/lector de pantalla, mensajes claros y español como idioma inicial. Preparar internacionalización de moneda/fecha.
- Observabilidad con logs estructurados sin secretos, métricas y errores correlacionables por identificador de solicitud.
- Mantener migraciones y despliegues repetibles; separar entornos; ejecutar verificaciones antes de promoción y disponer de rollback.

## 6. Requisitos de calidad y aceptación

Un primer lanzamiento funcional debe demostrar al menos:

1. Un usuario autorizado crea un cliente, registra un equipo con accesorios/condición y abre una orden con número único.
2. La recepción, historial y evidencias quedan vinculados a la orden y autor/fecha.
3. Un técnico registra diagnóstico, materiales y pruebas sin perder versiones anteriores.
4. Se emite presupuesto versionado, se registra aceptación/rechazo y el sistema impide iniciar trabajo facturable no aprobado según reglas configuradas.
5. El stock se actualiza mediante movimientos trazables; los movimientos concurrentes no permiten inconsistencias silenciosas.
6. Se registran anticipo, pago parcial y reembolso compensatorio; los totales y saldo se calculan correctamente.
7. Se completa control de calidad, entrega y garantía; reclamación se vincula a reparación original.
8. Cada usuario solo accede a talleres y funciones autorizadas; pruebas automatizadas cubren aislamiento multi-tenant y denegación de acceso.
9. Formularios muestran estados de carga/error/vacío, validan datos y funcionan en viewport móvil y teclado.
10. Migraciones, lint, comprobación de tipos, pruebas y compilación se ejecutan en CI; cualquier bloqueo de producción queda documentado.

## 7. Arquitectura y despliegue

La implementación puede seleccionar el stack adecuado al repositorio, pero debe documentar sus decisiones y respetar los límites dominio/API/persistencia/UI. Preferir tecnologías mantenidas y compatibles con el entorno objetivo. No comprometer credenciales ni datos de prueba reales.

El despliegue debe documentar configuración, variables de entorno, migraciones, backups, almacenamiento privado y estrategia de rollback. Cloudflare u otro proveedor solo se considera desplegado tras confirmar configuración, permisos, secretos, resultado de build y URL activa. No afirmar despliegue sin verificación.

## 8. Fuera de alcance inicial

- Contabilidad general, nómina, comercio electrónico completo, logística avanzada o ERP integral.
- Diagnóstico automático mediante IA, control remoto de dispositivos o acceso a datos personales del equipo.
- Garantizar cumplimiento de una ley, norma fiscal o certificación sin análisis de jurisdicción y auditoría formal.
- Procesar directamente información de tarjetas o almacenar credenciales de pago.

## 9. Decisiones de negocio confirmadas

- **Jurisdicción:** San Miguel de Tucumán, Tucumán, Argentina.
- **Moneda:** pesos argentinos (`ARS`).
- **Horarios:** lunes a sábado de 9:00 a 21:00 de corrido.
- **Domingos:** cerrado.
- **Garantías:** las condiciones y alcance deben confirmarse por teléfono al `+54 9 381 524-9553`. La aplicación no debe declarar cobertura legal o comercial hasta que la decisión quede registrada.
- **Zona horaria operativa:** `America/Argentina/Tucuman`.

## 10. Pendientes antes de producción

Antes de operar con datos reales, completar: impuestos fiscales aplicables, consentimientos y retención, plantilla de documentos, canales de notificación, proveedor de identidad/pagos, volumen esperado y objetivos de disponibilidad/recuperación.

## 11. Integraciones Google y Gemini

- Google Sign-In valida OIDC/ID Token, nonce, audiencia, emisor, expiración y firma de Google.
- Nuevas cuentas quedan PENDING y requieren aprobación administrativa.
- Google está separado de Drive, Sheets y Photos; no concede acceso incremental automáticamente.
- OAuth utiliza state, PKCE, cifrado AES-GCM de tokens y desconexión por servicio.
- Gemini opera mediante secreto independiente, límites diarios, timeout y registro de uso.
- Las integraciones reales requieren credenciales de Google Cloud Console y Google AI Studio; no deben declararse activas hasta completar configuración y pruebas.
