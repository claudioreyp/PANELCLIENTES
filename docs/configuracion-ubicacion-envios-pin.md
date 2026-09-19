# Ubicacion, imagenes, envios y PIN

## Alcance

Configuracion y pedidos nuevos del POS. Se conserva el lenguaje visual operativo
existente. No se modifican Admins, n8n, gateway QR ni checkout del menu digital.
Las reglas de producto canonicas estan en el AGENTS.md del workspace.

- Ubicacion es un borrador hasta Guardar. Google Maps se carga al abrir el selector;
  geolocalizacion solamente al pulsar Llevar a ubicacion actual. Sin SDK se permite
  reintentar e ingresar coordenadas manuales. El centro inicial no confirma un punto.
- Logotipo cuadrado y portada 16:9 se recortan antes de subir; cancelar conserva la
  imagen previa. Se validan tipo y limite de 8 MB tanto en cliente como en servidor.
- Costos de envio conserva cinco modalidades, compra minima, envio gratis por monto,
  colonias y niveles. La tarifa lineal anterior permanece hasta un cambio explicito.
- Domicilio muestra costo editable y vacio para Por cotizar, y precio fijo de solo
  lectura. Guarda calle, numero, entre calles, colonia y referencia, ademas de la
  direccion completa compatible. La tarifa se valida antes de abrir el cobro y de
  crear el pedido; una respuesta pendiente nunca equivale a costo cero.
- La confirmacion manual, el destino exacto, subtotal antes de descuentos, version y
  vencimiento son validados por la API. Cambiar el carrito o destino invalida la
  cotizacion; volver desde Cobro sin cambios reutiliza la cotizacion vigente.
- El PIN de cuatro digitos permanece en memoria del formulario y solo se envia al
  guardar el miembro. Editar sin nuevo PIN conserva el existente; no se habilita
  acceso a dispositivos por PIN.

## Activacion Pendiente

1. En el entorno autorizado, respaldar la base y aplicar Alembic hasta la revision
   `20260912_0021`. Esta entrega no ejecuta migraciones sobre la base de uso.
2. Configurar `VITE_GOOGLE_MAPS_BROWSER_KEY` para el frontend, restringida a sus
   sitios autorizados y Maps JavaScript API. No reutilizar la clave del servidor.
   Reiniciar Vite o reconstruir el frontend despues de configurar esta variable.
3. Configurar Google Routes en el servidor para calcular distancias reales y
   conservar la configuracion de Places usada por el autocompletado existente.
4. Verificar el mapa real con las restricciones del sitio. Los recorridos aislados
   cubren SDK simulado y fallo del mapa, no certifican una clave Google operativa.

Referencia oficial: https://developers.google.com/maps/api-security-best-practices

## Evidencia

- Vitest cubre mapas, recorte, PIN, formularios, errores, reintentos, respuestas tardias
  y el flujo de cotizacion manual del pedido.
- Pytest usa bases temporales para aislamiento, permisos, instantaneas, umbrales,
  niveles, cotizaciones, idempotencia, rollback y migracion. PostgreSQL real requiere
  una base aislada configurada y no se reemplaza por la base operativa.
- `e2e/settings-enhancements.spec.ts` recorre Configuracion en los tres tamanos y
  guarda capturas `e2e/test-output/settings-enhancements-*.png`.
- `e2e/new-order-delivery.spec.ts` recorre tarifas fija/manual, errores, teclado,
  regreso del cobro, invalidacion del destino y confirmacion a cocina. Capturas en
  `e2e/test-output/settings-delivery/`.
- Todos los endpoints de estas pruebas de navegador son fixtures aisladas con
  bloqueo de red por defecto. No se crean pedidos ni se cambia configuracion real.
- Comparacion visual agrupada: se corrigio el solapamiento del zoom en el recortador
  de escritorio con poca altura y el espacio del prefijo S/ del importe manual.
  No se cambio la identidad visual de otras pantallas.

## Resultado de Verificacion (2026-09-12)

- Lint y build correctos. Vitest: 58 archivos, 469 pruebas aprobadas.
- Pytest: 449 aprobadas y 1 omitida por falta de PostgreSQL aislado configurado.
- Playwright: 57 recorridos aprobados entre pedidos existentes, nuevos envios y
  Configuracion, en escritorio, tablet y movil. Tras los ultimos ajustes se
  repitieron los 6 de envios y 3 de Configuracion, todos aprobados. El ultimo
  recorrido de imagen simula una respuesta perdida despues de confirmar la subida
  y verifica repeticion exacta de la clave, version y bytes del archivo.
- Detector Impeccable ejecutado una unica vez al final. Informe:
  `.impeccable/review/settings-delivery-detector.json`. Cuatro avisos advisory de
  colores semanticos fuera de la paleta documentada (error, marcador y enlace).
  Sin hallazgos de mayor severidad en los archivos analizados. La ruta solicitada
  `pin-editor.css` no existe: el detector omitio ese archivo; `PinEditor.tsx` si
  fue analizado y el CSS real `PinEditor.css` se verifico en navegador, no con una
  segunda ejecucion del detector. No se presenta el informe como cobertura total.

Sin despliegue, push ni activacion de servicios externos.
