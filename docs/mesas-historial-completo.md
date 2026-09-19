# Mesas e historial completo: verificacion

Fecha: 2026-09-12. Alcance: CLIENTES y Apis. Reglas de producto en el AGENTS.md del workspace.

## Matriz funcional

| Area | Resultado | Evidencia |
| --- | --- | --- |
| Zona de mesas | Memoria de sesion por usuario, negocio y sucursal; se conserva al navegar y se valida tras una carga exitosa. Sin almacenamiento persistente. | TablesWorkspace y TenantProvider: navegacion, cierre de sesion, zona eliminada, errores y respuestas de otra sucursal. |
| Historial de mesas | Todas las zonas y fechas de la sucursal; cuentas finalizadas, canceladas o liberadas, incluso con cocina pendiente o mesa eliminada. | Pytest con aislamiento, liberacion, archivado, eliminacion y contexto guardado. |
| Panel de pedidos | Todo el historial, busqueda global, 12 registros por pagina y orden estable por creacion e ID descendentes. | Vitest de contratos y Pytest con 237 pedidos entre fechas. |
| Detalle historico | Consulta sin editar, cobrar, trasladar o reabrir; comandas plegables, contexto guardado, pagos y caja disponible. | TableHistory y recorridos simulados de navegador. |
| Cancelacion | Motivo obligatorio en CLIENTES y opcional compatible en API; auditoria transaccional. Los cobros confirmados no se convierten en cero. | Vitest de error/reintento/cambio de sucursal; Pytest de motivo, idempotencia y cobros. |
| Impresion | Flujos actuales de cuenta y comandas; imprimir cuenta queda deshabilitado si se cancelo. | Impresion simulada; sin impresora fisica. |
| Actualizacion | Conserva el ultimo resultado confirmado ante error, con aviso y Reintentar; rechaza API incompatible en vez del respaldo de 200 pedidos. | Pruebas de contrato, recargas fallidas y respuestas tardias. |
| Diseno | Leyenda inferior eliminada, zonas y acciones sin recortes; espacio reservado para iconos, prefijos y sufijos. | Pruebas de estilos/geometria y comparacion visual agrupada en escritorio, tablet y movil. |

## Pruebas

- `npm run lint`: correcto.
- `npm run build`: correcto, TypeScript y Vite.
- `npm test`: 303 pruebas aprobadas en 45 archivos.
- Pytest completo: 246 aprobadas, 1 prueba PostgreSQL opcional deseleccionada; 6 advertencias. Las 27 pruebas especificas de historial incluyen nombre de caja estable tras renombrarla, sesion desvinculada y aislamiento de su auditoria.
- Playwright completo: 221 aprobadas, 1 fallo de selector ambiguo y 3 omitidas. Corregido el selector para comprobar por separado pedido y comanda; revalidacion 3/3 aprobada en los tres dispositivos, sin fallos pendientes.
- Reportes conservados: `e2e/test-output/final-report.json` y `e2e/test-output/cancellation-selector-recheck-report.json`. Los 27 recorridos del nuevo historial pasan.
- Las tres omisiones son dos comprobaciones exclusivas de escritorio a 884 px y un arrastre que no aplica en movil. No se ejecuto autenticacion real con credenciales.
- Las pruebas de API usan SQLite aislado. El navegador simula las respuestas de API y la impresion; no equivale a validar una impresora fisica ni un despliegue integrado.
- Dos revisiones independientes de API e interfaz, ademas del responsable de pruebas de navegador.

## Revision visual e Impeccable

- Comparacion agrupada en los tres dispositivos: pedidos, mesas, historial, detalle pagado/cancelado y campos de direccion/precio fijo.
- La primera corrida de navegador detecto que la cuenta de mesa interceptaba los clics de la cancelacion. Se corrigio la capa del dialogo y se agregaron regresiones geometricas en tres resoluciones; no se oculto el fallo usando clics forzados.
- Una confirmacion visual posterior, limitada a la cancelacion de mesa en los tres dispositivos, valida la correccion de esa capa.
- Capturas: `e2e/test-output/table-history-visuals/{desktop,tablet,mobile}/`.
- Una sola ejecucion del detector: `.impeccable/review/table-history-detector.json`. La correccion funcional posterior de la capa de cancelacion se verifica con Vitest y Playwright, sin repetir el detector.
- Resultado: 27 observaciones, no un detector limpio. Hay 15 observaciones de colores fuera de la documentacion, 10 de tamanos y 2 advertencias sobre Inter.
- Inter se conserva expresamente por el diseno acordado. Los colores semanticos de cancelacion/aviso y mesa reproducen las referencias; su consolidacion en tokens/documentacion queda identificada, sin rediseno transversal.

## Limites

- El modo diario predeterminado de `/orders/workspace` sigue disponible para clientes anteriores. Los nuevos modos exigen una API que declare `period` y `view` en su respuesta.
- Si falta un nombre historico o motivo guardado no se reconstruye desde el catalogo/configuracion actual: se muestra una etiqueta generica o "Motivo no registrado".
- Los nuevos cobros guardan el nombre de la caja en su auditoria existente. El detalle lo consulta alli y no en el nombre actual de la caja; sin instantanea se omite la etiqueta.
- Verificada por lectura de OpenAPI la disponibilidad local de `period`, `view` y el motivo opcional de cancelacion.
- No se crearon tablas ni migraciones. Sin despliegue ni cambios en Admins, n8n o gateway QR.
- No se modificaron pedidos, pagos o ajustes reales para verificar estos cambios.
