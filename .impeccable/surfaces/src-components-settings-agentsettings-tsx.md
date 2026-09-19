---
version: 1
slug: "src-components-settings-agentsettings-tsx"
primary_target: "src/components/settings/AgentSettings.tsx"
related_targets: ["src/components/settings/DeviceSettings.tsx", "src/components/settings/LocationPicker.tsx", "src/pages/DeviceAccess.tsx"]
---

# Perfil del agente y acceso por dispositivo

## Mode
Operate. Configuracion breve, cambios confirmados y acceso de personal por sucursal.

## THESIS
Extender Configuracion sin cambiar su lenguaje visual ni mezclar guardar datos
del agente con modificar su comportamiento conectado.

## OWN-WORLD
Conservar DESIGN.md y los componentes actuales del POS: superficies blancas,
canvas gris, seleccion verde, controles compactos y foco visible. Las capturas
del usuario son referencia funcional, no autorizacion para copiar Maspedidos.

## STORY
Perfil: nombre opcional, carta ordenada y QR completo. Miembros: enlace/QR temporal,
activacion, seleccion de miembro y PIN. El mapa conserva el dialogo y el borrador.

## FIRST VIEWPORT
Configuracion conserva contexto, navegacion y encabezado de seccion. El acceso
publico por dispositivo identifica Escalar AI POS y la sucursal antes de solicitar
el nombre o el PIN; no incluye navegacion operativa ni publicidad.

## FORM
Extension code-led del sistema fijado por el usuario; sin cambio de identidad,
concept seed retrospectivo ni comp generado. La pantalla publica de dispositivo
conserva el caracter claro de la referencia: tarjeta blanca, fondo verde palido,
teclado numerico y encabezados compactos. No redefine el login por correo.

## Implementation Record
La carta conserva su proporcion original en el recortador y usa object-fit contain
en miniaturas con fila de grid limitada; la primera imagen es principal. El QR
de Yape mantiene todo el archivo y sus margenes. La galeria pasa a una columna en
movil; Configuracion usa el selector de seccion existente en tablet y movil.
Los dialogos usan el portal y gestion de foco existentes. Los botones de teclado
son controles reales con nombre accesible, no caracteres usados como iconos.

La pagina publica PIN tiene medidas y profundidad locales en device-access.css.
No se promovieron sus valores puntuales a tokens globales ni se regeneraron
DESIGN.md o su sidecar, pues el usuario pidio conservar el sistema establecido.

## Verification
Capturas sinteticas de escritorio, tablet y movil bajo
.impeccable/review/agent-device, con enlaces/QR de vinculacion enmascarados.
La verificacion automatizada no certifica Google Maps real, HTTPS en telefonos
ni PostgreSQL sin un entorno aislado configurado. Detalle de activacion en
docs/agent-device-activation.md y decisiones de producto en ../AGENTS.md.
