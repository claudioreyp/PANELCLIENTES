# Activacion de impresion local con QZ Tray

Las decisiones canonicas estan en [AGENTS.md](../../AGENTS.md), seccion
`Impresion local del POS`. Esta guia describe la activacion y recuperacion;
el contrato completo esta en
[Apis: impresion automatica](../../Apis/docs/pos-automatic-printing-contract.md).

## Estado y pendientes

Actualizacion de personalizacion y ahorro de papel: el usuario confirma que hay
texto visible, pero algunos documentos dejan demasiado papel blanco al final.
QZ 2.3.0 registro rasterizaciones de 576 x 5856 y 576 x 3692 para documentos cortos.
La correccion mide el HTML termico aislado y envia altura RAW explicita; no utiliza
altura de pantalla ni estima por productos. El usuario ya confirmo el resultado
fisico de la muestra corta y del par ticket/comanda; ver Comprobacion fisica confirmada.

Diagnostico local del 12 de septiembre de 2026: los trabajos anteriores de
Pizza House se enviaron como `pixel/html` al controlador `Generic / Text Only`,
sin comandos de corte. QZ registro paginas graficas tipo carta. La configuracion
ESC/POS de otro negocio no corregia los trabajos de Pizza House: los ajustes
y cada instantanea pertenecen a una sucursal concreta.

Lectura nueva de la API y del POS: **Pizza House / Sucursal principal, sucursal 2,
version 4**, `Printer POS-80`, `escpos`, 80 mm, una copia, ambos automaticos.
No se modificaron otras sucursales ni trabajos historicos. QZ real detecto
`Generic / Text Only` y acepto una prueba corta sintetica a las 19:44 de Lima;
el registro confirma `PrintRaw`, raster de 576 dots e inicializacion y corte
`0A1D564100`. El resultado fisico fue confirmado posteriormente por el usuario.
La aceptacion por QZ no prueba texto visible ni corte. No se crearon pedidos,
pagos ni comandas reales para probar.

## Activar en el equipo que imprime

1. Tener instalada la impresora en el sistema operativo y QZ Tray en ese mismo
   equipo. Si falta QZ, usar `Instalar QZ Tray` en Configuracion > Impresion;
   instalarlo no basta, debe permanecer abierto. No se detecta hardware del
   telefono ni del servidor remoto.
2. Abrir Configuracion > Impresion en la sucursal correcta. Completar la activacion
   unica de confianza descrita debajo. El permiso de red local del navegador es
   independiente: autorizar solo el POS. Si se bloqueo, revisar los permisos del
   sitio y pulsar `Reintentar` o `Actualizar impresoras`.
3. Activar `Impresion avanzada` y seleccionar el nombre exacto de la impresora.
   Cada cambio se guarda y verifica con la API; esperar la confirmacion. Si queda
   pendiente, usar `Verificar guardado` antes de otro cambio. Activar no sustituye
   preferencias previas de documentos ni cambia silenciosamente el modo.
4. Abrir `Configurar impresion`. Elegir ancho real 58/80 mm, maestro automatico y
   los documentos de cliente y cocina. En opciones avanzadas elegir explicitamente
   lenguaje y copias 1..5. Apagar automatica conserva las selecciones. `Imprimir N
   veces` refleja las copias reales globales, no una cantidad distinta por documento.
5. Guardar el modal y esperar confirmacion. Cancelar descarta solo ese borrador;
   un fallo lo conserva para reintentar. Reabrir para comprobar los valores. El
   POS nunca sustituye una impresora ausente por otra ni deduce lenguaje del nombre.
6. En `Conexion y prueba de impresion`, revisar el diagnostico de negocio, sucursal,
   version leida,
   impresora, driver y modo efectivo. Usar `Imprimir prueba corta` y comprobar
   texto visible y corte. Despues usar `Imprimir prueba` para un ticket seguido
   de una comanda, cada uno con una copia, claramente marcados como prueba.
   La prueba se bloquea ante un borrador sin guardar, fallo de verificacion,
   falta de conexion o driver incompatible. `Verificar de nuevo` solo relee la
   configuracion; no guarda ni imprime.

Para ambos documentos, los valores guardados son `advanced_printing=true`,
`printer_config.printer_name` no vacio, `auto_print_kitchen=true` y
`manual_customer_receipt=false`, con `automatic_printing=true`. Cargar ajustes respeta valores desactivados;
no se imprimen automaticamente pedidos historicos al activar esta funcion.

## Elegir el tipo de impresora

| Opcion del POS | Valor | Uso |
| --- | --- | --- |
| Controlador grafico (HTML) | `pixel` | Impresora con controlador grafico compatible; valor predeterminado para clientes anteriores. |
| Termica ESC/POS (controlador generico) | `escpos` | Termica compatible con ESC/POS, por ejemplo instalada con `Generic / Text Only`. |

Con un controlador solo de texto no usar el flujo grafico `pixel`. Para el equipo
descrito, seleccionar explicitamente `escpos` si la impresora es compatible; el
controlador generico por si solo no demuestra compatibilidad de todos los modelos.
QZ rasteriza el HTML a ESC/POS. El POS no instala ni cambia el controlador de Windows.
Si los detalles locales de QZ indican `Generic / Text Only` y el trabajo esta en
modo grafico, el POS lo detiene antes de reclamarlo. Corregir explicitamente el
modo de la sucursal y solicitar una nueva impresion manual; no reenviar a ciegas
el trabajo antiguo, cuya instantanea sigue siendo grafica.
Los ajustes de modo, ancho, copias y plantilla quedan fijados en cada documento
preparado; cambiarlos despues no transforma trabajos anteriores.

El perfil ESC/POS ajusta el documento completo a un raster conservador de 384 dots
para papel de 58 mm y 576 dots para 80 mm. El ancho RAW se expresa en dots;
el ancho HTML grafico sigue `units: mm`. La densidad de rasterizacion se expresa
en dots/mm, no en DPI. `pageHeight` RAW tambien usa dots: se mide el alto CSS del
documento aislado al ancho real y se convierte proporcionalmente a 384/576 dots.
Una medida invalida detiene la operacion antes de reclamarla. El ancho imprimible
real y el corte dependen del modelo y deben comprobarse en papel. Referencia:
[PrintHTML de QZ 2.3.0](https://github.com/qzind/tray/blob/v2.3.0/src/qz/printer/action/PrintHTML.java).

Cada trabajo RAW contiene `1B40`, HTML rasterizado y `0A1D564100`: salto de linea
y GS V 65 0 para avanzar hasta la cuchilla y pedir corte completo. No concatena
ticket y comanda en una unica tira; termina uno antes de despachar el siguiente.
Las copias repiten el documento completo con su corte. La capacidad fisica de
la cuchilla sigue dependiendo del modelo. Referencia:
[ESC/POS GS V](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/gs_cv.html).

## Permisos y firma

Sin certificado/firma configurados, la API indica `manual-approval` y QZ solicita
autorizacion nativa. No simular ese dialogo ni deshabilitar sus controles. Si se
requiere operar sin avisos repetidos, el administrador debe configurar un
certificado de confianza y su firma en el servidor, ademas de autorizar el sitio.
Un certificado de firma no sustituye los permisos del navegador o del sistema.

La API utiliza `QZ_TRAY_CERTIFICATE` y `QZ_TRAY_PRIVATE_KEY` (PEM, compatible con
saltos escapados `\n`), o `QZ_TRAY_CERTIFICATE_FILE` y `QZ_TRAY_PRIVATE_KEY_FILE`
(rutas de archivos PEM accesibles solo al servidor). Se cargan del entorno y de
`.env`/`.env.local`, igual que la configuracion de la API. No configurar un valor
inline y un archivo para la misma pieza. Nunca colocar la clave privada en
variables `VITE_*`, uploads, CLIENTES/public, el navegador, Git o esta guia.
La API valida formato, RSA >=2048, correspondencia de claves y vigencia antes de
conectar. Una configuracion incompleta, incompatible, vencida o ilegible responde
503 sin divulgar claves/rutas ni degradar a sin firma. Esta validacion no prueba
que la instalacion local de QZ confie en el emisor.
El PEM publico se valida y serializa de nuevo; certificado y clave concatenados
se rechazan antes de cualquier respuesta o descarga. El ZIP solo admite la
identidad propia unica, no sustituye cadenas comerciales ni otras raices.

### Activacion unica de confianza

El usuario eligio **certificado propio, activacion unica por equipo**. No hace
falta autorizar sitios anonimos ni comprar un certificado comercial para este flujo.

1. En el host de la API, un administrador genera UNA identidad con
   `python scripts/create_qz_identity.py <directorio-privado-fuera-del-workspace>`.
   El generador no sobrescribe archivos, restringe permisos antes de escribir y
   genera RSA 3072 con vigencia de 730 dias. Conservar respaldo privado seguro y
   planificar renovacion antes del vencimiento. No ejecutar el generador en cada
   terminal. No usar `certgen`: genera HTTPS, no la identidad de firma del POS.
2. Mantener la clave fuera del directorio web y del repositorio. Configurar en
   `Apis/.env.local` las rutas de `digital-certificate.txt` y `private-key.pem`
   mediante las dos variables `_FILE`. Las rutas relativas parten del directorio
   de ejecucion de la API; preferir rutas absolutas y restringir lectura al usuario
   del servidor. No enviar la clave por chat ni subirla desde el POS.
3. Cargar la version actualizada de la API y del POS. Ambos GET de conexion QZ
   (ajustes de sucursal y pedido) deben devolver `mode=signed`, el mismo certificado
   publico y nunca la clave. Al activar o rotar la identidad, el POS renueva el
   handshake; las siguientes consultas y documentos reutilizan esa conexion.
4. En cada equipo de impresion, instalar QZ Tray 2.2 o superior y abrir
   Configuracion > Impresion > Conexion y prueba > **Descargar activacion de QZ**.
   Extraer TODO el ZIP. En Windows ejecutar `ACTIVAR-WINDOWS.cmd`, leer el aviso
   y continuar cuando no haya impresiones en curso. Verifica la huella/vigencia,
   configura `QZ_OPTS` solo para el usuario, registra el certificado con `--allow`
   y reinicia QZ con `--steal`. Guarda respaldo local del valor anterior y se
   detiene si hay raices personalizadas incompatibles o impresiones en cola.
   No cambia la politica global de PowerShell ni autoriza otros sitios. En
   macOS/Linux seguir LEEME: requiere permiso de administrador y no reemplaza un
   `override.crt` distinto. Reabrir QZ cuando este libre. Esos sistemas no se han
   probado fisicamente en este entorno Windows.
5. Volver al POS y pulsar Actualizar impresoras. Si aparece `Anonymous`,
   `Untrusted website` o `Invalid Certificate`, detenerse y revisar la activacion,
   sin recordar permisos anonimos. La descarga no confirma que el equipo ya este
   activado. Con certificado comercial reconocido, la alternativa es recordar
   `Allow` una sola vez; no es el mecanismo elegido para el certificado propio.
6. Comprobar dos consultas consecutivas de impresoras sin avisos y despues una
   prueba sintetica corta. Cerrar y reabrir web/PWA y repetir una consulta para
   verificar que la confianza persiste. No reimprimir pedidos historicos como prueba.

El ZIP sale de `GET /api/v1/settings/branches/{branch_id}/printing/qz/activation`,
con autenticacion, permiso operativo de impresion, alcance de sucursal y no-store.
Solo contiene certificado PUBLICO, scripts y LEEME. No contiene claves privadas,
credenciales de desarrollo ni datos del restaurante. Otros equipos deben acceder
a la misma API por HTTPS y con autenticacion normal; 127.0.0.1 solo sirve en el
propio equipo. QZ no se instala en iPhone/Android: la PWA movil no hereda una
impresora USB del PC. El certificado no concede permisos nuevos en el POS/API.

Referencia oficial: [firma de QZ](https://qz.io/docs/signing) y
[QZ_OPTS, --allow y --steal](https://qz.io/docs/command-line). La renovacion del
certificado o permisos del navegador puede requerir nueva activacion humana.

Diagnostico del aviso repetido, 2026-09-12: API local sin certificado/clave, modo
`manual-approval`, lista local de sitios permitidos vacia. Seleccionar Printer
POS-80 no cambia esa identidad. Se implementaron carga/validacion compartidas y
renovacion del socket. Tras autorizacion del usuario, se genero/configuro la
identidad propia fuera del workspace y se activo QZ 2.3.0 para este usuario de
Windows. Las consultas reales de propietario, cajero y cocina (dos conexiones
nuevas por rol) funcionaron firmadas sin responder avisos de QZ. Se envio una
muestra corta con rol cajero a Printer POS-80, 80 mm, ESC/POS y una copia; QZ la
acepto. El usuario confirmo que salio completa, con corte correcto y sin pedir
Allow en QZ. Esta comprobacion corresponde al equipo Windows activado, no implica
que otros equipos ya tengan registrada la confianza.
No se modificaron pedidos, pagos, ajustes de impresora ni otras sucursales.

Tambien se corrigio un fallo del protocolo real: qz-tray 2.2.6 entrega SHA256
hexadecimal al callback de firma. El POS ahora vincula el hash al JSON exacto
mediante el hook publico del conector; la API comprueba la vinculacion antes de
autorizar el contenido y firmar con RSA/SHA512. Cajero, mesero y cocina conservan
su lista limitada de operaciones. No se aceptan hashes opacos de esos roles.
El cache temporal se limpia al terminar/cancelar, sin firmas anonimas de respaldo.
Para esos roles, el destino debe ser exactamente `printer: {name}`: una cola
instalada en el sistema, incluida una cola de impresora de red. Se rechazan
destinos `host`, `port` y `file`, incluso junto a `name`. El contrato administrativo
anterior se conserva; este cambio no concede nuevas operaciones a ningun rol.

Verificacion de activacion propia (2026-09-12): 727 Vitest, 661 Pytest y una
omision por PostgreSQL no configurado; lint, build y 33 Playwright aprobados.
Los recorridos de escritorio/tablet/movil verifican descarga explicita, ausencia
de cambios o papel al descargar, opciones actuales y ambos botones de impresion.
Tests del conector qz-tray real usan WebSocket simulado para comprobar hash/JSON,
roles, errores y ausencia de respaldo anonimo. Las pruebas de activacion verifican
ZIP publico, permisos, alcance, huella, material invalido y no sobrescritura de
claves. Sintaxis macOS/Linux comprobada, sin ejecucion fisica en esos sistemas.
La API real entrego el ZIP y las consultas reales a QZ se repitieron con exito.
Revision visual agrupada sin desbordamiento y detector Impeccable sin hallazgos.
Permanece el aviso previo de chunk mayor a 500 kB; no se cambiaron dependencias
por esa advertencia, ni se hicieron despliegues o migraciones de la base de uso.

Verificacion de la correccion de firma: 702 pruebas Vitest, lint y build aprobados;
607 Pytest aprobados y uno omitido por PostgreSQL no configurado, con datos aislados;
30 Playwright aprobados en escritorio, tablet y movil con API/QZ simulados. Incluyen
avisos diferenciados, ambos botones y documentos automaticos sin duplicados. Las
pruebas criptograficas verifican SHA512/RSA, PEM inline/archivos/.env.local,
rotacion, vigencia, claves incompatibles y aislamiento de sucursal. Revision visual
agrupada y detector Impeccable sin hallazgos nuevos. Esto no sustituye la prueba
local de confianza; la salida fisica antes confirmada sigue vigente. Las cifras
anteriores corresponden a la correccion previa a activar el certificado propio.

Cajero/mesero pueden operar la cola sin obtener permiso de editar configuracion.
La consulta QZ y firma operativa incluyen el rol de cocina, con alcance de negocio
y sucursal. El firmador operativo admite HTML termico y solo los comandos ESC/POS
exactos de inicializacion y avance/corte previstos; no comandos arbitrarios,
apertura de cajon, lectura de archivos, USB o sockets. Los endpoints QZ antiguos
sin sucursal conservan sus permisos administrativos.

## Impresion automatica y botones manuales

La impresion automatica parte del exito de la API al confirmar y enviar a cocina,
tambien si se cobra despues. El pedido conserva su confirmacion si QZ esta cerrado
o falla la impresion; no registrar otro pedido para recuperar un documento.
Las instantaneas contienen pedido/comanda reales, importes, modificadores, autor
cuando fue registrado, plantilla y configuracion de impresora, no el catalogo actual.

En mesas, abrir una mesa vacia no imprime. El primer envio y cada adicion de
productos imprimen solo su comanda nueva, con fecha original, numero, autor y su
propio contenido. `Cerrar mesa` prepara una cuenta con todos los productos vigentes
y totales; pagar o hacer pagos parciales no la repite. Reabrir y cerrar otra vez
crea otra cuenta actualizada. La insercion de esa cuenta y el cierre son atomicos:
si falla la cola, reintentar el mismo cierre sin crear otro pedido. Mesa y zona
se conservan desde sus instantaneas, sin inventar datos antiguos.

## Personalizar sin imprimir

En la tarjeta `Personalizacion de ticket`, abrir cliente o cocina. Elegir letra
Chica, Normal o Grande y conservar campos existentes en opciones avanzadas.
Cliente permite encabezado y pie de hasta 500 caracteres cada uno; desactivarlos
oculta su impresion sin borrar su texto. El ejemplo usa el mismo generador que
QZ, pero no crea pedidos ni envia papel. En movil alternar Editar/Vista previa.
Guardar confirma solo esa plantilla. Salir o Escape con cambios ofrece conservar
o descartar el borrador. Un fallo de API permite reintentar sin perderlo.
El router actual conserva su limitacion con Atras/Adelante del navegador; no se
promete un bloqueo fiable de esos botones. La navegacion interna esta protegida.
`Contactar soporte` permanece deshabilitado intencionalmente.

Los botones `Imprimir pedido` e `Imprimir comanda` solicitan un solo trabajo mediante
`POST /api/v1/orders/{id}/printing` con `Idempotency-Key`, `job_type` y
`expected_order_version`. Para comanda se incluyen `kitchen_ticket_id` y
`expected_ticket_version`; el ticket de cliente no los incluye. La respuesta 201
es el trabajo, no confirmacion de impresion. Solo se despacha ese identificador.

Repetir clave y cuerpo recupera el mismo trabajo; otra clave solicita una nueva
reimpresion intencional. Version obsoleta, comanda cancelada, impresion avanzada
apagada o impresora sin seleccionar devuelven 409: revisar/refrescar antes de continuar.
El historial de pedidos cancelados permite solicitar solo el ticket de cliente,
identificado como `PEDIDO CANCELADO`, con sus importes, pagos y saldo registrados.
No genera comanda ni envia a cocina; el pedido cancelado no permite imprimir cocina.
Un ticket pendiente preparado antes de cancelar no se reutiliza como recibo del
historial. Imprimir historial no modifica el pedido ni sus pagos. Los contratos
antiguos de dispositivos e impresion siguen separados de esta cola local.

## Recuperar sin duplicar

- Si QZ esta cerrado o falta la impresora exacta, corregirlo antes de reclamar el
  trabajo. Consultar `GET /api/v1/orders/{id}/printing` recupera trabajos durables,
  pero no crea documentos ficticios ni confirma papel.
- Reclamar con `/printing/{job_id}/claim` permite una sola llamada a QZ. Otra
  terminal no obtiene permiso para despachar el mismo documento.
- Tras exito de QZ, `/printing/{job_id}/complete` registra `printed`, que significa
  aceptacion por la cola de impresion. Si falla esta confirmacion, reintentar solo
  el ACK conservado en memoria, nunca volver a llamar a QZ.
- `not_sent` permite reintento explicito solo si se garantiza que no se llamo a QZ.
  Una cancelacion o revision posterior impide despachar contenido obsoleto.
- `claimed` sin resultado o `unknown` requieren revision humana del equipo/cola:
  no reenviar, no resetear ni crear otra clave automaticamente. Un trabajo reclamado
  acepta ACK tardio aunque el pedido cambie; esto no concede un segundo envio.

## Comprobacion fisica confirmada

El 2026-09-12 se verifico en la API Pizza House / Sucursal principal, sucursal 2,
version 4, Printer POS-80, Generic / Text Only, ESC/POS, 80 mm y una copia de prueba.
Con el motor de altura explicita se envio primero una muestra corta. El usuario
confirmo texto completo y corte correcto, sin tira larga en blanco. Despues se
enviaron el ticket y la comanda como dos trabajos separados; el usuario confirmo
ambos completos, separados por corte y sin exceso de papel, con totales solo en
el ticket. Las muestras no crearon pedidos, pagos ni comandas reales.

Esta confirmacion corresponde a ese equipo, ancho y muestras. Los formatos 58 mm,
las copias multiples y todos los pedidos posibles se cubren por software, no por
esa observacion fisica. Una nueva impresora requiere su propia comprobacion.

Tras activar el certificado propio, tambien se envio una unica muestra corta
firmada con rol cajero, sin registrar una venta. El 2026-09-12 el usuario confirmo
texto completo, corte y ausencia del aviso Allow de QZ. Se conservaron la impresora,
el formato y las reglas de despacho; no se reimprimieron pedidos historicos.

## Verificacion de personalizacion y altura

- CLIENTES: lint y build aprobados; 647 pruebas de Vitest aprobadas. Permanece
  el aviso existente de bundle mayor de 500 kB, sin error de compilacion.
- Apis: 589 pruebas aprobadas y una omitida por PostgreSQL no configurado.
  Pruebas y migraciones de regresion exclusivamente con bases aisladas; sin
  migracion nueva, despliegue ni escrituras de prueba sobre la base de uso.
- Playwright: 110 aprobadas (107 del recorrido agrupado y tres de navegacion al
  agente) y una prueba de arrastre omitida intencionalmente
  en movil. Cubre escritorio, tablet y movil; configuracion, borradores, foco,
  botones manuales, primera comanda, adicion, cierre, reapertura y ausencia de
  impresion duplicada al pagar. El enlace Agente de Whatsapp abre la configuracion
  en la misma pestana y permite volver a Pedidos. QZ y API simulados en estos
  recorridos. Seis comprobaciones adicionales confirmaron el ajuste final de tema.
- Revision visual agrupada de configuracion, modal, editores y los 12 formatos
  (58/80 mm, cliente/cocina, Chica/Normal/Grande), sin desbordamientos observados.
- Un unico detector final de Impeccable senalo seis colores. Los dos colores
  locales de overlay/sombra se sustituyeron por variables del tema compartido.
  Los cuatro avisos de negro puro en el documento termico son intencionales para
  papel monocromo; no se ocultaron reglas ni se repitio el detector.
- JavaFX real de QZ 2.3.0: 48/48 muestras comprobadas, 24 con heap 512 MB y 24
  con 1024 MB, alternando documentos largos/cortos, anchos y fuentes. Compara
  altura automatica, altura explicita y referencia ampliada con igual escala;
  verifica contenido, repetibilidad y ausencia de texto recortado. Las muestras
  cortas dejaron 26..37 filas raster finales y las largas 44..130, frente a la
  altura automatica excesiva reproducida. No se abrieron sockets ni impresoras.

Para repetir solo el renderer instalado, desde CLIENTES:

```powershell
$env:QZ_HEIGHT_HEAP_MB = '512'
npx playwright test --config scripts/thermal-height.playwright.config.ts
$env:QZ_HEIGHT_HEAP_MB = '1024'
npx playwright test --config scripts/thermal-height.playwright.config.ts
```

`QZ_INSTALL_DIR` permite indicar otra instalacion oficial de QZ. El harness usa
datos sinteticos y guarda evidencias en `node_modules/.cache/qz-height`, nunca
en las carpetas de configuracion del usuario. No ejecuta la app ni el spooler.

## Verificacion anterior a la personalizacion

- Lint y build de CLIENTES aprobados. Build conserva el aviso existente de un
  bundle mayor de 500 kB, sin error de compilacion.
- Vitest completo: 583 pruebas aprobadas; cobertura de driver incompatible antes
  del claim, muestras, lectura posterior al guardado, respuestas tardias,
  orden ticket/comanda, dos sucursales, versiones, ACK y resultado incierto.
- Pytest aislado: 529 aprobadas, una omitida por PostgreSQL no configurado.
  No se ejecutaron migraciones ni pruebas de escritura sobre la base de uso.
- Playwright aislado: 15 recorridos de impresion y 12 de formatos, aprobados en
  escritorio, tablet y movil, con QZ/API simulados. Comparacion visual de ambos
  formatos 58/80 mm y panel de diagnostico: sin desbordamientos observados.
- Una ejecucion final de Impeccable detecto cuatro avisos de color `#000` fuera
  de la paleta de pantalla. Se conserva deliberadamente negro puro en el HTML
  termico, como requiere la salida monocroma en papel; no se cambio la paleta
  del POS ni se ocultaron reglas del detector.
- En esa verificacion inicial la prueba corta solo estaba aceptada por QZ. La
  confirmacion fisica posterior del usuario se registra en Comprobacion fisica confirmada.
