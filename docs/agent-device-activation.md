# Activacion: perfil del agente y acceso por dispositivo

## Estado de entrega

Implementado en CLIENTES y Apis, sin despliegue y sin modificar Admins, n8n,
el agente conectado ni el gateway QR. Las decisiones de producto se mantienen
en el AGENTS.md canonico del workspace.

La verificacion automatizada usa SQLite temporal, archivos temporales y dos
contextos de navegador independientes. La entrega inicial no migro la base de uso.
Posteriormente, el 2026-09-12, el responsable autorizo la activacion local: se
respaldo SQLite en Apis/backups y se aplicaron 0021 y 0022. Se verificaron la
integridad y todos los valores anteriores de 49 tablas, incluidos pedidos y pagos.
El nombre y las imagenes disponibles en la API no cambian por si solos n8n.

La clave de navegador ya esta configurada en CLIENTES/.env.local, excluido de Git.
El POS y la API funcionan en 5173 y 8000, respectivamente. Tras el error inicial
`ApiNotActivatedMapError`, el 2026-09-12 se verifico en Edge que Maps JavaScript API
ya estaba habilitada y que la clave existente coincidia con la configuracion local.
El mapa real cargo dentro del dialogo de ubicacion del POS, sin errores. La vista
inicial permanecio sin confirmar; no se solicito geolocalizacion ni se guardaron
ubicaciones. No se modificaron Google Cloud, credenciales, restricciones ni
facturacion. La revision de restricciones y facturacion sigue pendiente.

## Pasos pendientes, por entorno

1. Respaldar la base del entorno autorizado y revisar la revision Alembic actual.
   Aplicar `alembic upgrade head` desde Apis solo con autorizacion del responsable
   de esa base. La nueva revision es `20260912_0022_agent_devices`, posterior a
   `20260912_0021_delivery_policy`. Agrega campos, no tablas; conserva la carta
   existente como principal y los dispositivos de impresion previos. Configurar
   `AUTO_CREATE_SCHEMA=false` fuera de pruebas y no sustituir Alembic por create_all.
2. Establecer `DEVICE_AUTH_SECRET` en el servidor: secreto aleatorio independiente
   de al menos 32 caracteres. No incluirlo en Vite, git ni en el navegador. Cifra
   recuperaciones idempotentes y firma CSRF. Rotarlo invalida recuperaciones
   pendientes y exige obtener un nuevo CSRF; no reemplaza la revocacion explicita
   de dispositivos o sesiones comprometidas.
3. Establecer `POS_PUBLIC_BASE_URL` con la URL real del POS, sin token, consulta ni
   fragmento. Un telefono no puede abrir el localhost de otra computadora. Usar
   HTTPS y POS/API bajo el mismo sitio mediante dominios propios o proxy aprobado;
   las cookies son HttpOnly, SameSite=Lax y Secure fuera de desarrollo. Los dominios
   independientes de Vercel y Render no satisfacen automaticamente ese requisito.
   Ajustar `VITE_API_BASE_URL`, `PUBLIC_API_BASE_URL` y `CORS_ORIGINS` a esa topologia;
   CORS debe enumerar origenes exactos y permitir credenciales y `X-CSRF-Token`.
   No publicar DEV_AUTH_TOKEN ni habilitar ENVIRONMENT=development en una URL publica.
4. Configurar `VITE_GOOGLE_MAPS_BROWSER_KEY` en CLIENTES y reiniciar/recompilar
   Vite. Es una clave de navegador distinta de `GOOGLE_MAPS_API_KEY` del servidor;
   restringirla a los sitios autorizados y Maps JavaScript API. Configurar el
   proyecto de Google Cloud y facturacion segun la guia oficial. No reutilizar
   claves privadas de rutas/geocodificacion en el cliente. El mapa real ya se
   verifico en el POS local. Quedan pendientes la verificacion en otros entornos,
   la revision de restricciones por sitio y la geolocalizacion en telefono.

Google explica la [configuracion de Maps JavaScript API](https://developers.google.com/maps/documentation/javascript/get-api-key)
y las [restricciones de seguridad](https://developers.google.com/maps/api-security-best-practices).

## Contratos y recuperacion

Todas las rutas siguientes son relativas a `/api/v1`.

- GET/PATCH `/settings/branches/{id}/agent`: nombre, version, imagenes ordenadas y
  URL privada del QR. PATCH admite `name` e `image_order` con todos los IDs actuales.
- POST `/settings/branches/{id}/agent/images`, POST/DELETE `.../images/{image_id}`
  y POST/DELETE `.../yape-qr`: carga/reemplazo/eliminacion. Multipart usa `file` y
  `expected_version`; DELETE usa JSON con `expected_version`. Cada escritura exige
  `Idempotency-Key`. Los archivos anteriores se retiran tras confirmar la transaccion.
- GET `/integrations/context`: `branch.agent_name` y `branch.menu_images`.
  GET `/integrations/context/menu-cards/{image_id}` requiere `menu:read` y el mismo
  negocio/sucursal. `.../menu-card` sigue entregando solo la principal.
- POST `/settings/devices/pairing-links`: `branch_id`, Idempotency-Key, enlace
  temporal y vencimiento. GET `/settings/devices/{id}` consulta la activacion.
  DELETE `.../{id}/pairing-link` cancela con version e idempotencia. Regenerar
  cancela primero; si la activacion gano la carrera, se ofrece desvincular.
- POST `/auth/devices/preview` y `/activate`: token de enlace en el cuerpo, nunca
  en la consulta de la API. El POS lo recibe en el fragmento y lo retira de la URL.
  Activate agrega nombre e idempotencia; entrega credencial exclusivamente en cookie.
- GET `/auth/devices/session` y `/members`: estado/CSRF y miembros elegibles.
  POST `/auth/devices/login`: `member_id`, PIN, Idempotency-Key y X-CSRF-Token.
  POST `/auth/devices/logout` elimina la sesion sin perder la vinculacion.
- GET/POST privados usan `credentials: include`; las escrituras por cookie
  requieren origen permitido y CSRF. Las credenciales no se guardan en localStorage.
  Respuestas perdidas se reintentan con el mismo cuerpo y clave en memoria. Ante
  un rechazo definitivo se permite corregir; una version obsoleta exige recargar.
  Una API anterior que no dispone de estos contratos no se presenta como guardado.

## Verificacion reproducible y segura

Resultado final local (2026-09-12): lint y build correctos; 479 pruebas Vitest,
460 Pytest correctas y una omitida por faltar PostgreSQL aislado; seis recorridos
Playwright correctos en escritorio, tablet y movil. El detector de Impeccable
se ejecuto una vez y produjo siete avisos advisory de valores visuales locales
en la pantalla publica PIN, documentados en el informe visual. La revision visual
se hizo en esta misma tarea, sin revisor independiente. Los servidores temporales
5176/8009 y el navegador de pruebas se cerraron al finalizar.

Desde CLIENTES: `npm run lint`, `npm test`, `npm run build`.
Desde Apis: `python -m pytest -q` (conftest usa una base aislada).
Desde CLIENTES: `npx playwright test --config playwright.agent.config.ts`.

El config dedicado inicia API temporal en 8009 y Vite en 5176; no reutiliza
servidores salvo `AGENT_E2E_REUSE=1`, reservado a esos mismos procesos de prueba.
No apuntarlo a la API de uso. Los QR de vinculacion se enmascaran en capturas y
no se generan trazas que puedan conservar tokens. Las imagenes y miembros del
recorrido son sinteticos. Los resultados visuales finales se guardan en
`.impeccable/review/agent-device/`.

La suite PostgreSQL opcional necesita `POS_TEST_POSTGRES_URL` con un esquema
aislado; sin ella se omite esa comprobacion, no se utiliza una base real como
alternativa. Advertencias actuales: deprecaciones de Starlette/Alembic y bundle
principal de Vite superior a 500 kB. No se hicieron actualizaciones masivas de
dependencias ni cambios de infraestructura como parte de esta entrega.
