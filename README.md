# Escalar AI POS - CLIENTES

Aplicación operativa multiempresa para restaurantes, construida con React, Vite y TypeScript. Reúne POS, mesas, cocina, delivery, reservas, inventario, caja, ventas y configuración en una interfaz táctil para escritorio y tablet.

## Módulos

- POS de tres zonas con salón, mostrador, para llevar, delivery, tienda y futura fuente WhatsApp.
- Pedidos, modificadores, observaciones, descuentos autorizados, pagos parciales y división de cuenta.
- Mapa de mesas y KDS con estados y temporizadores.
- Caja, inventario por receta, delivery, reservas y ventas del día.
- Tienda pública en `/tienda/:slug` y reservas públicas en `/reservar/:slug`.
- Acceso directo del propietario con el usuario y contraseña creados desde Admins.
- Aceptación de invitaciones en `/invitacion` para empleados adicionales.

Cuando Escalar AI crea un restaurante desde Admins, la API prepara su negocio y sucursal, crea el usuario propietario en Supabase Auth y vincula de inmediato su membresía. El restaurante entra directamente con el **Usuario y contraseña** entregados por Escalar AI; no se despliega una copia distinta de la aplicación por restaurante. Las invitaciones se conservan para incorporar empleados posteriormente.

Cada ruta operativa usa el negocio y la sucursal de la membresía autenticada. Los módulos deshabilitados por el superadmin no aparecen en navegación.

## Desarrollo

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Variables necesarias:

- `VITE_API_BASE_URL`: base `/api/v1` de FastAPI.
- `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`: autenticación pública de Supabase.
- `VITE_DEV_*`: solo desarrollo local; no configurarlas en Vercel.

## Verificación y despliegue

```powershell
npm run lint
npm run test
npm run build
npm run test:e2e
```

Vercel usa `vercel.json` para servir la SPA y conservar rutas profundas. Configure las variables de producción en Vercel y autorice el dominio en CORS y en los redirect URLs de Supabase.

La impresión actual usa el navegador. La impresión ESC/POS automática requerirá posteriormente un agente local en cada restaurante.
