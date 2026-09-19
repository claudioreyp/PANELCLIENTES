# Folios, zonas y seguridad

## Comportamiento

Los listados de Pedidos, historial de mesas y tarjetas de cocina muestran el folio
sin el codigo. Detalles, edicion e impresion conservan ambos. La busqueda por
codigo sigue funcionando y la numeracion del servidor no cambia.

Configuracion abre el mismo editor visual de zonas utilizado por Pedidos. La zona
se crea al confirmar Continuar; las mesas siguen siendo borradores hasta guardar.
Salir conserva la zona vacia. Los guardados parciales conservan respuestas
confirmadas y reconcilian creaciones inciertas por codigo antes de repetirlas.

Seguridad permite consultar cancelaciones de pedidos y platos, reducciones de
importe y retiros. Las instantaneas pertenecen al momento de la accion, no al
catalogo actual. Datos desconocidos se muestran como no registrados.

## Navegacion y compatibilidad

- `/pedidos?order_id=ID` abre el detalle exacto, aunque no este en la pagina actual.
- `/caja?tab=movements&register_id=ID&movement_id=ID` consulta un movimiento exacto
  en servidor, incluyendo periodos anteriores. No usa la caja principal de respaldo.
- El regreso a seguridad conserva filtros, pagina y foco en la accion consultada.
- Los enlaces no cambian de sucursal y los errores conservan datos confirmados.
- La API amplia la auditoria y los filtros de movimientos sin tablas ni migraciones.

## Verificacion aislada

Vitest cubre presentacion, navegacion, errores, sucursales, foco y borradores.
Pytest cubre auditoria transaccional, instantaneas, compatibilidad e aislamiento.
Playwright usa fixtures interceptadas para probar la interfaz sin pedidos ni pagos
reales, en escritorio, tablet y movil. No se requieren cambios en Admins, n8n o QR.

### Resultados del 12 de septiembre de 2026

- Lint y build: aprobados.
- Vitest completo: 343 pruebas aprobadas en 48 archivos.
- Pytest completo: 270 aprobadas y una omitida por requerir PostgreSQL aislado.
- Playwright completo: 237 aprobadas y 6 omitidas (tres de autenticacion real y
  tres limitadas al tipo de dispositivo). Los 15 recorridos de esta mejora
  volvieron a pasar tras el ajuste visual final.
- Revision visual agrupada de escritorio, tablet y movil, con una sola tanda de
  correcciones: fecha apilada en seguridad movil y separacion de la ayuda de zona.
  Las capturas finales deshabilitan animaciones para no registrar la entrada del
  dialogo a media opacidad. Evidencia en `e2e/test-output/security-zones/`.
- Detector Impeccable ejecutado una vez al final sobre las superficies cambiadas:
  tres avisos orientativos, sin errores criticos. Senala el fondo de error
  `#fff3f1`, el enlace azul solicitado `#2465c5` y el radio de foco de 4px como
  valores no documentados en la escala de DESIGN.md. No se ocultaron los avisos
  ni se modifico globalmente el sistema visual para silenciarlos. Resultado en
  `.impeccable/review/folios-zonas-seguridad-detector.json`.

No hubo despliegue, migraciones ni modificaciones de pedidos o pagos reales.
