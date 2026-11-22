# Group Repair

![Group Repair](./Group-Repair.jpg)

Group Repair es una aplicación web para gestionar las operaciones de un taller de reparación: clientes, equipos, órdenes, diagnósticos, presupuestos, pagos e inventario. Está pensada para mantener trazabilidad de las operaciones y centralizar la información del taller.

## Aplicación

- **Aplicación desplegada:** [group-repair.lucaslean1806.workers.dev](https://group-repair.lucaslean1806.workers.dev/)
- **Stack:** React, TypeScript, Vite, Cloudflare Workers y Cloudflare D1.
- **Persistencia:** Cloudflare D1, vinculada al Worker mediante `DB`.
- **Especificación del producto:** [`SPEC.md`](SPEC.md).
- **Privacidad:** [Política de privacidad](https://group-repair.lucaslean1806.workers.dev/privacy)
- **Términos:** [Términos de servicio](https://group-repair.lucaslean1806.workers.dev/terms)

La aplicación incluye un panel operativo y secciones para clientes, equipos, órdenes e inventario. El Worker expone operaciones de API para la gestión del taller, con validaciones de dominio, registro de eventos y persistencia en D1. La disponibilidad de servicios externos —por ejemplo, Google o Gemini— depende de la configuración de credenciales y APIs correspondientes.

## Acceso público temporal

El acceso al panel y a las operaciones generales de negocio está habilitado sin login obligatorio. Las funciones administrativas, la gestión de cuentas Google autorizadas y las credenciales OAuth permanecen protegidas por sesión aprobada.

Mientras el modo público esté activo, terceros pueden utilizar las operaciones generales disponibles desde la aplicación. No se debe usar con datos reales de clientes hasta que se habilite la separación multiusuario y se revisen los permisos del taller. Los secretos de Google, Gemini y Cloudflare no se exponen al frontend.
## Despliegue (Cloudflare)

La aplicación está desplegada en Cloudflare Workers: [https://group-repair.lucaslean1806.workers.dev/](https://group-repair.lucaslean1806.workers.dev/).

Para publicar cambios, configurá los bindings y secretos necesarios en el entorno de Cloudflare, revisá y aplicá las migraciones pertinentes, y ejecutá las pruebas y verificaciones de build antes del despliegue. Mantené los secretos fuera del repositorio y separá los entornos según corresponda.

### Gemini

Gemini permanece deshabilitado hasta configurar su secreto independiente:

```bash
npx wrangler secret put GEMINI_API_KEY
```

Opcionalmente se puede configurar el modelo y el límite diario mediante variables públicas:

```json
"vars": {
  "GEMINI_MODEL": "gemini-2.5-flash",
  "GEMINI_DAILY_LIMIT": "20"
}
```

No ejecutes ni declares la integración como operativa hasta una prueba real con respuesta del proveedor.

## Configuración operativa

- Jurisdicción del taller: San Miguel de Tucumán, Tucumán, Argentina.
- Moneda: pesos argentinos (`ARS`).
- Horario informado: lunes a sábado, de 9:00 a 21:00; domingos cerrado.
- Consultas sobre garantías: `+54 9 381 524-9553`.

Las condiciones de garantía y cualquier requisito fiscal o legal deben confirmarse para el caso aplicable; la aplicación no sustituye asesoramiento profesional.

## Seguridad y privacidad

No cargues información real de clientes, credenciales, tokens ni evidencia privada en issues o commits. Gestioná las credenciales mediante secretos del entorno de despliegue y evitá almacenar datos de tarjetas de pago. Reportá vulnerabilidades de forma privada al propietario del repositorio.

## Licencia

Este proyecto está bajo la licencia [MIT](LICENSE).
