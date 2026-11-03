# LIMATCO · Control de Acopios — contexto para Claude Code

App de control de pallets para los acopios 1 y 2 de Limatco, un distribuidor de cerámica y porcelanato. El requerimiento original del cliente (transcripción de un audio) está en `docs/requerimiento.md`.

**Estado:** v1.0.0 construida y probada con backend simulado. **Todavía no está desplegada**: no se ha ejecutado `setup()`, `migrarDatosIniciales()` ni la implementación web.

## Cómo trabajar con Seba
- Responde en español de Chile, tuteando y sin relleno. Términos técnicos en inglés sin traducir (stock, backend, deploy, WMS, SKU).
- Entrega siempre archivos completos, nunca parches sueltos de líneas.
- Ajústate a lo pedido. Si ves un problema de diseño o un riesgo operativo, avísalo **antes** de construir. No inventes datos: si falta uno, pregunta.
- Al tocar `Code.gs`, recuérdale siempre el despliegue: **Implementar → Administrar implementaciones → lápiz → Nueva versión → Implementar**. Guardar no basta.

## Stack (no cambiar sin que lo pida)
- **Frontend:** `index.html` único con HTML, CSS y JS vanilla. Sin frameworks ni build step. Se publica en GitHub Pages como PWA.
- **Archivos de raíz:** `manifest.json`, `sw.js` y los íconos van en la raíz del repo, nunca en subcarpetas.
- **Backend:** `Code.gs` (Apps Script con runtime V8) desplegado como Web App, con `appsscript.json` en zona America/Santiago.
- **Base de datos:** planilla "Acopios 1 y 2 / 2026" (ID `1CYiBZNVR28hzCVucHLw_6hoRg_B6q6xNM_6uo6psqYU`).
- **Librerías CDN (jsdelivr):** Chart.js 4.4.1 + chartjs-plugin-datalabels 2.2.0 (todos los gráficos llevan etiquetas de datos visibles), qrcode-generator 1.4.4, html5-qrcode 2.3.8 (escáner) y xlsx 0.18.5.
- **Estilo visual:** tema oscuro, Space Grotesk, Inter y JetBrains Mono. Verde #41C68E derivado del encabezado verde (#356854) de la planilla.
- **Código:** comentarios en español, secciones comentadas y constantes de configuración arriba (`CONFIG` en el HTML, `CFG` en el GS).
- **Escritura en la planilla:** correlativos automáticos y control de duplicados en todo lo que registra movimientos.

## Planilla: hojas de origen (solo lectura)
| Hoja | Fila de cabecera | Uso |
|---|---|---|
| `acopio 1` | 5 (col A) | 1 fila = 1 pallet. Solo se usa en la migración |
| `acopio 2` | 6 (col A) | Igual que acopio 1 |
| `SALIDAS` | 7 (col C) | Historial manual, con fecha y sin hora. Solo migración |
| `PEGAMENTOS` | 9 (col C) | Conteo de pallets por acopio × UND X PALTS. Solo migración |
| `TABLA DE CODIGOS ` (con espacio final) | 3 (col B) | Maestro de productos: código, descripción, m² por caja |
| `fisico` | 4 (col B) | Export del ERP. Disp → DIS, Bod → Físico, Ubicacion → picking. Se toma la primera coincidencia, igual que el BUSCADOR |

Las cabeceras se buscan por texto (`cabecera_()`), así que no dependen de la posición exacta. Los códigos se comparan siempre en MAYÚSCULA: `fisico` trae códigos como `48782Gr`.

## Modelo APP_* (lo crea `setup()`)
- **APP_PALLETS:** stock vivo. ID `PL######`; el QR del pallet codifica ese mismo ID.
- **APP_PALLETS_HIST:** pallets cerrados, con FECHA_CIERRE y MOTIVO_CIERRE.
- **APP_MOVIMIENTOS:** log inmutable. TIPO puede ser ENTRADA, SALIDA, SALIDA_PARCIAL, TRASLADO, AJUSTE o SALDO_INICIAL. El `OP_ID` da idempotencia; `MIG-SALIDAS` marca el histórico sin hora y `MIG-INICIAL` el saldo inicial.
- **APP_UBICACIONES:** acopio, ubicación, pasillo, número, capacidad (vacía = sin definir), tipo POSICION/PISO/ZONA y activa. El QR de ubicación codifica `UB|<acopio>|<ubic>`.
- **Resto:** APP_USUARIOS (hash SHA-256 de `usuario|clave|limatco-acopios`), APP_PRODUCTOS (creados desde la app), APP_SALIDAS (vista QUERY) y APP_LOG_MIGRACION.

## API (`doPost`, body JSON en text/plain para evitar el preflight de CORS)
- **Lectura:** `login`, `bootstrap`, `productos`, `erp`, `pallet`, `movimientos`, `historial`.
- **Escritura** (con LockService): `entrada`, `salida`, `traslado`, `ajuste` (estas cuatro con `opId`), `crearProducto`, `guardarUbicacion`, `capacidadMasiva`, `crearRango`, `guardarUsuario`, `cambiarClave`.
- **Códigos de error que maneja la UI:** `AUTH`, `PERMISO`, `CAPACIDAD` (se reintenta con `forzar`), `UBIC_NO_EXISTE` (un SUPERVISOR puede reintentar con `crearUbicacion`), `PRODUCTO_NUEVO`, `VALIDACION`.
- **Roles:** CONSULTA < OPERADOR < SUPERVISOR < ADMIN.
- **Token:** payload en base64 web-safe más firma HMAC con `TOKEN_SECRET` (propiedad del script), con vigencia de 14 h.

## Invariantes que hay que mantener
1. **Normalización idéntica en cliente y servidor:** `normUbic` (por ejemplo `a8` → `A-08`, `A-34,2` → `A-34.2`), códigos en mayúscula, y tono o calibre `no`/`NO`/`-` → vacío.
2. **El modo demo replica el servidor.** El objeto `Demo` dentro de `index.html` imita las respuestas de `Code.gs`. Si cambias una acción o un formato de respuesta en el GS, actualiza también `Demo`. El modo demo se activa con `CONFIG.API_URL` vacío o con `?demo` en la URL.
3. **El stock de acopio no es el stock del ERP.** La app nunca escribe en `fisico`.
4. **Cola sin conexión:** las operaciones entrada, salida y traslado se encolan en localStorage (`lim_outbox`) y se reintentan con el mismo `opId`. El servidor ignora los duplicados.
5. **localStorage siempre dentro de try/catch** (el objeto `store`), por el comportamiento de Safari en iPhone.

## Pruebas (`npm i` y `npx playwright install chromium` la primera vez)
- `npm run test:backend`: 74 pruebas de `Code.gs` sobre un simulador de Apps Script (`test/gas_mock.js`) con una planilla de prueba que copia la estructura real (`test/fixtures.js`).
- `npm run test:e2e`: el `index.html` real contra el `Code.gs` real (33 pruebas). Las llamadas a la API se interceptan con Playwright.
- `npm run test:demo`: el mismo recorrido en modo demo (30 pruebas).
- `npm run test:stress`: inserción de filas y salidas de 80 pallets.
- Las pruebas reemplazan las librerías CDN por stubs (`test/stubs/`) porque el entorno donde se construyó no tenía acceso a los CDN. **Falta verificar en un dispositivo real** que los gráficos se dibujen, que el QR escanee y que el escáner abra la cámara del iPhone.

## Pendiente
- **Antes de salir en vivo:** la lista está en `LEEME.md` → "Pendiente con Limatco". Lo principal: capacidades reales (A-35, A-44 y A-45 de acopio 1, y E-10 de acopio 2, parecen bloques en piso), layout completo, pasada inicial de etiquetado (unos 790 pallets) e impresora.
- **Después de migrar:** revisar APP_LOG_MIGRACION con el cliente.
