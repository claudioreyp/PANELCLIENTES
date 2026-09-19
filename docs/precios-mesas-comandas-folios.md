# Precios, mesas, comandas y folios: verificacion

Fecha: 2026-09-12. Alcance: CLIENTES y Apis; reglas canonicas en AGENTS.md del workspace.

## Resultado funcional

| Flujo | Resultado implementado | Evidencia automatizada |
| --- | --- | --- |
| Precios | Tamano con precio absoluto; extras separados sin duplicar total. | Selector, desglose, recorrido de pedidos y mesas. |
| Mesas | Guardado en sede/zona original, sin dialogo de destino. Recuperacion parcial y por codigo de mesa tras respuesta perdida. | TablesWorkspace: guardado, errores parciales y cambio de sede. |
| Revision activa | Misma comanda, secuencia y hora; vista efectiva con historial antes/despues. | API y navegador: modificaciones sucesivas, cantidades y totales. |
| Cancelacion parcial | Producto tachado con motivo; extras retirados por unidades, sin tachar opciones restantes. | Repeticiones, retiro y ediciones posteriores. |
| Nueva tanda | Agregar productos crea otra comanda; revisar una completada crea una correctiva. | API y navegador: completar, corregir y seguir la version vigente. |
| Cancelacion total | Bloqueo del ultimo producto desde el editor; Cancelar pedido retira pendientes sin nueva comanda. | API de revisiones y borrado heredado; pedidos y mesas. |
| Folios | Secuencia por negocio compartida entre sedes; codigo completo independiente. | Migracion, concurrencia SQLite, aislamiento, busqueda y presentacion. |
| Cocina | Estado/version esperados; rechazo de lectura obsoleta y recuperacion con clave de idempotencia actualizada. | API y DigitalCommandBoard. |
| Sincronizacion | Respuesta confirmada aplicada antes de recargas secundarias; respuestas de sedes anteriores descartadas. | Vitest y recorridos con lecturas fallidas. |

## Ejecucion final

- `npm run lint`: correcto.
- `npm run build`: correcto (TypeScript y Vite).
- `npm test`: 265 pruebas aprobadas en 43 archivos.
- `python -m pytest`: 219 aprobadas, 1 omitida; 6 advertencias de deprecacion de dependencias/configuracion.
- `npx playwright test e2e/tables-commandas.spec.ts e2e/orders-workspace.spec.ts --workers=3 --reporter=line`: 95 aprobadas y 1 omitida en escritorio, tablet y movil. Se omite el arrastre del plano en movil, donde se muestra una lista; su editor de distribucion si se prueba.
- Pytest usa bases aisladas; Playwright simula las respuestas de API. No equivale a una prueba integrada de produccion ni de impresora fisica.
- Comparacion visual agrupada de precios, detalle, extras retirados, mesas y cocina. Se verificaron teclado, foco y ausencia de desbordamientos en los recorridos automatizados.

## Migracion y entorno local

- Migracion Alembic `20260910_0020`: folios historicos, contador por negocio y version de comanda, sin eliminar datos.
- Aplicada localmente de 0019 a 0020 tras respaldo verificado por SHA-256.
- Respaldo: `C:/Users/claud/AppData/Local/EscalarAI/POS/Backups/impulsa_pos-before-folios-20260912-092818.db`.
- Comprobaciones posteriores: integridad SQLite correcta, sin errores de claves foraneas ni pedidos sin folio.
- API local con health `ok`; POS disponible en `http://127.0.0.1:5173/pedidos`.
- No se crearon ni cancelaron pedidos reales para pruebas, ni se alteraron pagos reales. La migracion autorizada asigno los folios historicos.
- Sin despliegue ni cambios en Admins, n8n o gateway QR.

## Limites y evidencia visual

- `expected_version` sigue siendo opcional para clientes heredados por compatibilidad del contrato; CLIENTES siempre lo envia. Un consumidor antiguo que lo omita no obtiene proteccion de version de contenido y debe actualizarse.
- Las revisiones sincronizan trabajos de impresion aun pendientes; cancelar retira esos trabajos silenciosamente. Un trabajo ya reclamado puede estar imprimiendose y no se afirma que pueda retirarse fisicamente.
- Pendiente: ejecutar concurrencia PostgreSQL con `POS_TEST_POSTGRES_URL` apuntando a un entorno aislado. No hay servidor de pruebas disponible; Docker tampoco tiene daemon activo. Esa prueba se omite, no se informa como aprobada.
- Una sola ejecucion final del detector Impeccable: `.impeccable/review/folios-detector.json`.
- Resultado: 81 observaciones (47 colores, 26 tamanos de fuente, 6 radios y 2 bordes laterales). No es un resultado limpio.
- Las observaciones se concentran en los estilos compartidos de detalle y cocina. Queda pendiente normalizar/documentar sus tokens sin ampliar esta entrega a un rediseno.
- Los dos bordes laterales corresponden a los comentarios azules pedidos en las referencias; se mantienen intencionalmente. El folio oscuro y codigo gris tambien responden al diseno solicitado.
- Capturas agrupadas en `.impeccable/review/`: `retired-extra-*`, `tables-editor-*`, `table-command-editor-*`, `table-command-actions-*` y `detailed-new-preview-*`.

## Revision independiente adicional

Dos subagentes revisaron por separado API e interfaz. Se incorporaron estas correcciones con pruebas aisladas, sin repetir el detector ni otra ronda cosmetica:

- Refrescar bajo bloqueo la comanda en la ruta heredada antes de validar su version.
- No liberar una mesa reutilizada al cancelar una cuenta anterior, aun ante datos historicos inconsistentes.
- Sincronizar el contenido de impresiones pendientes y retirarlas silenciosamente al cancelar, sin alterar trabajos ya reclamados.
- Aplicar la respuesta confirmada de cerrar/reabrir mesa antes de recargas fallidas u obsoletas.
- Descartar aperturas, transferencias y otras respuestas de una visita anterior a la sucursal.
- Deshabilitar el editor durante su guardado para evitar que se pierdan cambios realizados durante la escritura.
- Persistir el arrastre comparando contra la posicion y version capturadas al comenzar, incluso despues de un render intermedio.

Las seis regresiones nuevas de API y 16 de Vitest pasan dentro de las suites completas. El arrastre visual se prueba en escritorio y tablet horizontal (1180 x 820); tablet vertical y movil usan la lista compacta y conservan las pruebas del editor de distribucion.
