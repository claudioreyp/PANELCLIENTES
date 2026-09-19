# Paridad con Maspedidos: fase uno

Fecha de verificacion: 2026-09-09.

Esta fase adapta las capacidades existentes del POS operativo a las referencias del usuario. No constituye una replica certificada de todos los servicios de Maspedidos. La autoridad de producto sigue siendo `../../AGENTS.md`.

## Matriz de Entrega

| Apartado | Verificado en esta fase | Conservado | Pendiente o fuera de alcance |
| --- | --- | --- | --- |
| Navegacion y controles | Inter local, paleta neutra, verde accesible, tablas compactas, menu movil inerte al cerrar, foco y Escape; limites 900/901/920/921px | Identidad Escalar AI, accesos por rol y sucursal | No se replica publicidad, suscripcion, tutoriales ni soporte |
| Inicio | Tarjetas y ayudas accesibles; vacios explicitos sin convertir fallos en ceros; fechas y graficos por teclado | Calculos de ventas, cobros, periodos Lima y disponibilidad actual | Evidencia visual de paridad centrada en estados vacios; graficos con datos comprobados en pruebas funcionales |
| Pedidos | Tabla, detalle, menus, copia, dialogo de impresion, comentarios y productos; preservacion ante fallos secundarios | Numeros reales, pagos, envio inmediato a cocina y comprobantes | No se hicieron cobros, cancelaciones ni impresiones fisicas reales |
| Comandas y mesas | Tarjetas, historial, completar/reabrir y correcciones con datos simulados | Instantaneas, comandas correctivas separadas y flujo de mesas | No se modificaron comandas reales |
| Menu | Productos, categorias, personalizaciones, promociones, selectores y editores con foco protegido | Precios, descuentos, variantes, disponibilidad y asociaciones | Sin nuevas integraciones ni cambios comerciales reales |
| Caja | Lenguaje visual comun, cortes, conteo a ciegas y movimientos; todos los datos visibles en movil | Validaciones, saldos y estados de caja | No se abrieron/cerraron cajas reales |
| Disponibilidad | Busqueda con texto separado de la lupa, estados e interruptores tactiles; restricciones de seleccion probadas | Disponibilidad de variantes/opciones y minimos obligatorios | Sin cambios de disponibilidad real |
| General, Sucursal y Servicios | Tarjetas, Guardar/Cancelar, proteccion de borradores y errores; carga de logo parcial | Contratos actuales y configuracion del negocio | Pais no editable desde esta pantalla |
| Miembros | Permisos efectivos del servidor, estados de invitacion separados, borradores ante 403/409 | Versiones, idempotencia y auditoria | No se enviaron invitaciones reales; PIN/dispositivos completo pospuesto |
| Permisos API | Sin escalamiento de members_manager, ultimo administrador protegido, aislamiento y concurrencia SQLite | Acceso de owner/superadmin conforme al contrato | PostgreSQL: SQL FOR UPDATE comprobado, no se ejecuto una prueba concurrente contra una BD PostgreSQL real |
| Envios | Cobertura por distancia/bandas validada antes de envio gratuito, limites y reintentos idempotentes | Modos y tarifas existentes | Tarifas por colonias pospuestas; sin activar proveedores externos |
| Auditoria, Zonas, Cajas e Impresion | Contenedor comun; formularios y navegacion protegidos; controles incompletos explicados | Recursos e historial actuales y preferencias de tickets | QZ directo y nuevas plantillas sin soporte pospuestos |
| Menu digital y sus ajustes | Acceso y contratos propios conservados | Horarios, metodos de pago y WhatsApp existentes | Pantallas ocultas del menu digital de Maspedidos no verificadas |

## Pruebas y Evidencia

- CLIENTES: lint y build correctos; Vitest completo, 238 pruebas aprobadas en 40 archivos.
- Apis: Pytest completo, 202 pruebas aprobadas con SQLite aislado; cuatro advertencias de dependencias (Starlette/httpx y configuracion heredada de Alembic), sin fallos.
- Playwright usa interceptores locales y datos sinteticos. Las capturas de paridad rechazan escrituras de API; los recorridos de mutaciones solo alteran fixtures en memoria.
- Capturas agrupadas en `.impeccable/review/parity-*.png`: escritorio 1280px, tablet 820px, movil 412px y editores a 884px.
- Revision independiente bajo contrato Impeccable mediante subagente generico, sin heredar la conversacion de implementacion. Sus hallazgos y el veredicto se registran en `.impeccable/review/finish-review.md`.
- Detector ejecutado una sola vez: dos avisos sobre Inter, aceptados porque esa tipografia fue exigida por el usuario. No se modifico la configuracion para ocultarlos.
- Playwright completo: 184 pruebas aprobadas, cinco omitidas y ningun fallo ni resultado intermitente. Tres omisiones corresponden al acceso Auth real sin credenciales de prueba y dos a capturas de 884px que solo aplican al proyecto de escritorio. Resultado detallado: `.impeccable/review/final-playwright.json`.
- El mismo revisor confirmo resueltos los seis hallazgos materiales tras la correccion conjunta. Su veredicto `ship` se limita a esas correcciones; no certifica funcionalidades externas ni paridad integral.
- Sistema visual construido documentado en `DESIGN.md` y `.impeccable/design.json`, con diez primitivas reutilizables. La documentacion distingue los estilos operativos de login y menu publico, que no se redisenaron en esta fase.

## Limites Operativos

No se modificaron Admins, n8n ni gateway QR. No hay tablas ni migraciones nuevas en esta fase. No se desplego ni se hizo push. Las pruebas no modificaron pedidos, pagos o ajustes reales. Login real por credenciales asignadas queda fuera de las pruebas automatizadas cuando no se proporcionan credenciales de prueba; no se sustituyen por credenciales privadas.
