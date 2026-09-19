# Revision segura: accesos, integracion y rendimiento

Fecha: 2026-09-16. Cierre de verificacion: 2026-09-17.
Alcance: Admins, CLIENTES, Apis y documentacion.
Sin despliegue, push, modificaciones de servicios externos ni migraciones en la
base de uso. Se preservaron los numerosos cambios locales anteriores.

## Cambios verificados

- Politica POS completo centralizada en la API sin reescribir campos heredados.
- Credenciales administrativas exclusivas del superadministrador, paquete de APIs
  generico y secretos emitidos una sola vez, con respuestas no almacenables.
- Alta protegida contra doble pulsacion, slug concurrente y respuesta incierta.
  Se conserva compensacion ante fallos de Auth o de la transaccion local.
- Suspensiones y membresias actuales comprobadas en HTTP, integracion y sockets;
  rechazo explicito de autenticacion de desarrollo en produccion.
- Cache de consultas en memoria, invalidacion tras operaciones/eventos, deduplicacion
  y conexion compartida por sucursal. Observadores inactivos no hacen polling.
- Extraccion del detalle y funciones de presentacion de Pedidos, sin cambiar su
  marcado. Rutas publicas/dispositivos separadas y precarga por foco/hover.

## Medicion reproducible

Playwright, mismas fixtures, mismos tres viewports, API de Mesas con 400 ms de
retardo por lectura. Sin pedidos o impresiones reales. Prueba:
`e2e/tables-commandas.spec.ts`, caso `performance: revisiting tables with a slow API`.

| Medida | Antes | Despues |
| --- | ---: | ---: |
| Regresar a Mesas, escritorio | 945 ms | aproximadamente 80 ms |
| Regresar a Mesas, tablet | 922 ms | aproximadamente 80 ms |
| Regresar a Mesas, movil | 925 ms | 80-110 ms |
| Lecturas areas/mesas durante ese recorrido | 8 | 2 |
| JS inicial minificado, build CLIENTES | 555.08 kB | 521.85 kB |
| JS inicial gzip, build CLIENTES | 165.66 kB | 156.42 kB |

Las consultas de menos de un segundo se consideran frescas; despues se conserva
contenido mientras se revalida. La entrada expira tras cinco minutos sin uso.
Los intervalos activos se mantienen: Pedidos/Mesas 15 s, Comandas 8 s, catalogo 30 s.
El cache no vuelve a ejecutar escrituras ni acciones de impresion.

Las capturas `e2e/test-output/navigation-before-*.png` y `navigation-after-*.png`
fueron identicas byte a byte en los tres tamanos durante la comparacion agrupada.
Se revisaron tambien alta y paquete de APIs de Admins en los tres tamanos.
Se corrigio el modal dentro del contenedor animado usando un portal, con contencion
de foco, Escape y restauracion del foco al salir, sin rediseno del POS.
Detector final de Impeccable: sin hallazgos en los componentes afectados.

No se afirma una mejora medida de carga inicial en red: el arranque frio de Vite
varia por compilacion. La reduccion del bundle si corresponde a builds de produccion.
Persisten avisos no bloqueantes por chunks superiores a 500 kB; no se ocultaron.

## Pruebas y limites

- CLIENTES: lint, 736 pruebas Vitest y build correctos.
- Admins: lint, 7 pruebas Vitest y build correctos; 6 casos Playwright de alta,
  secretos, reconciliacion y consulta posterior pasan en escritorio/tablet/movil.
- Apis: 677 pruebas Pytest correctas, una omitida por requerir PostgreSQL. Incluye
  roles, suspension, aislamiento de credenciales, compatibilidad, transacciones,
  pagos, cocina, impresion, dispositivos y migraciones sobre datos aislados.
- Alta concurrente comprobada sobre SQLite temporal de archivo con dos solicitudes:
  una alta y un conflicto, una sola creacion de usuario externo simulado.
- Navegador: 263 casos pasan y uno se omite (arrastre de mesas no aplicable al
  listado movil) en Pedidos, Mesas, Comandas, caja, delivery, historial,
  editores/cola QZ y PWA. Impresion, instalacion y APIs externas se simulan: estas
  pruebas no consumen papel ni sustituyen pruebas fisicas previas.
- Verificacion adicional de cambio de sucursal: 3 casos pasan, en escritorio,
  tablet y movil. Se retienen las respuestas de areas/mesas de la primera sucursal
  y se entregan despues de cargar la segunda; no reemplazan sus datos ni muestran
  mesas del ambito anterior. Lint de CLIENTES vuelve a pasar tras este caso.
- Otros 6 casos pasan contra una API real temporal en loopback y SQLite aislado:
  vincular otro navegador, autenticar por PIN, revocar el acceso y conservar el
  perfil, imagenes de carta y QR de Yape. Las migraciones se aplicaron solo a esa
  base temporal. Comando: `npx playwright test --config playwright.agent.config.ts`.
- Las pruebas usan Auth simulado para altas; el login del propietario se verifica
  contra su membresia real en la API aislada, no contra un proyecto Supabase real.
- PostgreSQL no disponible: `POS_TEST_POSTGRES_URL` sin configurar y Docker no
  operativo. No se intento usar la base real ni iniciar servicios de produccion.
- No se probaron Meta, consumidores externos o workflows en vivo. La guia generica
  y los requisitos de activacion estan en `../../Apis/docs/access-integration.md`.

## Comandos

En cada frontend: `npm run lint`, `npm run test`, `npm run build`.
En Apis: `python -m pytest -q`.
En Admins: `npx playwright test --config playwright.integration.config.ts`.
En CLIENTES: `npx playwright test e2e/tables-commandas.spec.ts e2e/orders-workspace.spec.ts e2e/app-install.spec.ts e2e/printing-workspace.spec.ts e2e/table-history.spec.ts e2e/new-order-delivery.spec.ts e2e/cash-workspace.spec.ts --workers=2`.
Caso adicional de aislamiento: `npx playwright test e2e/tables-commandas.spec.ts --grep "query cache never" --workers=2`.
