# Pedidos de WhatsApp: envio y comprobantes

La tarifa Por cotizar permite registrar productos desde WhatsApp con envio aun
pendiente. El detalle muestra Importe conocido (sin envio) y un bloque inferior
para confirmar costo y metodo. No es un envio gratuito ni un total definitivo.

Propietario, gerente, cajero y encargado de reparto pueden definir el envio.
Efectivo al recibir permite despacho con ese saldo; Yape exige su comprobante y
aprobacion independiente. Las adiciones pendientes tambien bloquean la salida.

Cada comprobante conserva operacion, codigo de seguridad y revision. Aprobar el
original antes de la adicion. Rechazar un extra no elimina productos ni pagos del
original. Un fallo conserva la misma clave de reintento, sin repetir cobros.

Marcar recogido / Marcar servido confirma cumplimiento de un pedido de WhatsApp;
no cobra ni vuelve a introducir Cerrar operacion. El aspecto y flujos previos del
POS se conservan; no se modifica Admins.

Verificacion local: lint, build y 763 Vitest aprobados; 66 Playwright de Pedidos
en escritorio, tablet y movil. Reintentos, respuestas tardias, permisos, impresion
simulada, cocina, cobros y navegacion incluidos. Impeccable sin hallazgos en las
tarjetas nuevas. No equivale a impresion fisica ni a pago bancario.

Contrato y activacion: Apis/docs/agent-checkout-release.md en el workspace.
