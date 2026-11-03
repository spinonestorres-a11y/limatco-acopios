# LIMATCO · Control de Acopios — v1.0.0

PWA de archivo único (GitHub Pages) + Google Apps Script + la planilla actual "Acopios 1 y 2 / 2026".

## Archivos

| Archivo | Dónde va |
|---|---|
| `index.html` | Raíz del repo de GitHub Pages |
| `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` | **Raíz** del repo (nunca en subcarpetas) |
| `Code.gs`, `appsscript.json` | Proyecto Apps Script de la planilla |

## Despliegue (en este orden)

1. En la planilla, abre **Extensiones → Apps Script** y pega `Code.gs`. En la configuración del proyecto, activa "Mostrar el archivo de manifiesto appsscript.json" y pega `appsscript.json` (deja la zona horaria en America/Santiago).
2. Cambia `CFG.ADMIN_CLAVE_INICIAL` en `Code.gs`.
3. Ejecuta `setup()` y autoriza. Crea las pestañas APP_* y el usuario `admin`. Se puede volver a ejecutar sin problema.
4. Ejecuta `migrarDatosIniciales()` **una sola vez**. Copia acopio 1, acopio 2, PEGAMENTOS y el historial de SALIDAS. Después revisa **APP_LOG_MIGRACION**.
5. Ve a **Implementar → Nueva implementación → Aplicación web**, con "Ejecutar como: Yo" y "Acceso: Cualquier usuario". Copia la URL que termina en `/exec`.
6. En `index.html`, pega esa URL en `CONFIG.API_URL` y sube los archivos a GitHub Pages.
7. Entra con `admin`, cambia tu clave (menú del avatar) y crea los usuarios en Administración. Usa como **nombre** el mismo con que aparece el gruero (DANILO, ALBERTO…), así sus movimientos históricos y los nuevos quedan juntos.
8. ⚠️ **Cada vez que cambies Code.gs:** Implementar → Administrar implementaciones → lápiz → Versión: **Nueva versión** → Implementar. Guardar no basta.

**Modo demo:** si `CONFIG.API_URL` está vacía, o la URL lleva `?demo`, la app funciona con datos de prueba guardados en el equipo. Usuarios: `admin/admin`, `gruero/1234`, `supervisor/1234`, `ventas/1234`.

## Requerimientos del audio

| Lo que pidió | Dónde está |
|---|---|
| Consultar un producto con un botón y ver ubicación, stock, sectores y acopios de forma resumida | **Buscar** (o escaneo) → ficha con m²/cajas/pallets por acopio, Físico y DIS del ERP, stock fuera de acopio, ubicación de picking, desglose por tono y calibre y lista de ubicaciones |
| Registrar entradas y salidas, y que la salida rebaje el stock | **Entrada** y **Salida**. La salida puede ser total o parcial y rebaja las cajas al tiro |
| Gráfico de frecuencia e historial de movimientos | **Dashboard**: entradas vs salidas por día, salidas por hora, top productos, movimientos por gruero, ocupación y antigüedad. Cada ficha trae además su historial de 13 semanas |
| Que al retirar un producto el espacio quede libre y que al llegar otro se vea qué hay ocupado o desocupado | La salida total cierra el pallet y avisa qué posiciones quedaron libres. Entrada y **Mapa** muestran ocupación y capacidad, y sugieren dónde dejar el pallet |
| Agregar productos nuevos y rebajar stock con un botón o ingresando el código | Si el código no existe, Entrada lo crea en APP_PRODUCTOS. La salida se hace escaneando el QR o ingresando el ID o el código |
| Planilla de salida de mercadería con fecha y hora | **Movimientos** filtrado por Salidas: se imprime o se exporta a Excel. La pestaña **APP_SALIDAS** de la planilla se actualiza sola. Cada salida genera además un comprobante |

**Extras de la fase 1:** ID y QR por pallet, etiquetas de ubicación, traslados, pegamentos medidos en unidades, login por rol (CONSULTA / OPERADOR / SUPERVISOR / ADMIN), ajustes de inventario con motivo, cola sin conexión con reintento sin duplicados y alerta de descuadre entre acopio y ERP.

## Modelo de datos

- **APP_PALLETS**: stock vivo. Cada fila es un pallet con ID `PL000123`.
- **APP_PALLETS_HIST**: pallets que ya salieron. Si alguien escanea un QR viejo, la app le dice cuándo y por qué salió ese pallet.
- **APP_MOVIMIENTOS**: log inmutable de todos los movimientos, con fecha y hora, gruero y usuario. El campo `OP_ID` evita duplicados cuando se reintenta una operación.
- **APP_UBICACIONES**: maestro de posiciones con capacidad (en pallets) y tipo POSICION / PISO / ZONA.
- **APP_USUARIOS**, **APP_PRODUCTOS**, **APP_SALIDAS** (vista QUERY) y **APP_LOG_MIGRACION**.
- La app **solo lee** `fisico` (export del ERP) y `TABLA DE CODIGOS`, y nunca modifica las hojas originales.

## Decisiones de diseño

- **El stock de acopio y el del ERP son cosas distintas.** La app rebaja el stock de acopio. El Físico y el DIS siguen viniendo del export que se pega en `fisico`. Si el acopio registra más m² que el físico del ERP, la ficha muestra una alerta de descuadre.
- **Una sola fuente de verdad.** Desde la puesta en marcha, nadie debe seguir editando `acopio 1` / `acopio 2` a mano: quedan como respaldo. El BUSCADOR antiguo deja de reflejar los movimientos nuevos.
- **Historial de SALIDAS.** Se migró con la fecha y sin hora (queda marcado "sin hora"), y no entra en el gráfico de salidas por hora.
- **Ubicaciones.** Se crearon las que tienen pallets y además los huecos de cada secuencia (por ejemplo A-48). La capacidad queda vacía hasta que se defina.

## Pendiente con Limatco antes de salir en vivo

1. **Capacidad por posición.** Hay que definirla por pasillo en Mapa → Capacidades. Ojo: A-35 (13 pallets), A-44 (12) y A-45 (20) en acopio 1, y E-10 (54) en acopio 2, no se comportan como posiciones de rack: probablemente son bloques en piso y conviene marcarlas como tipo **PISO**.
2. **Layout completo.** Hay que confirmar qué posiciones existen y no aparecen en la planilla (por ejemplo D-01 a D-03 en acopio 1). Se crean en Mapa → + Ubicaciones.
3. **Pasada inicial de etiquetado.** Son unos 790 pallets (unos 720 de cerámica más unos 73 de pegamentos) y unas 200 ubicaciones. Se recomienda una térmica de 100×150 mm; la alternativa es A4 con 6 por hoja en papel adhesivo. Conviene imprimir por pasillo con el filtro de Etiquetas.
4. **Pegamentos.** Quedan en la zona transitoria "PEGAMENTOS" porque la planilla no tiene su ubicación. Se reubican con un traslado.
5. **Frecuencia del export `fisico`.** Si se actualiza poco, el "fuera de acopio" y la alerta de descuadre van a mostrar datos viejos.
6. **Datos a corregir que vienen del ERP:** `SCDO3U19NA` (tiene la letra O en lugar de cero) y los códigos con "NO REGISTRA" en `fisico` (por ejemplo 1145, 18897, 19122). Todos quedan listados en APP_LOG_MIGRACION.
