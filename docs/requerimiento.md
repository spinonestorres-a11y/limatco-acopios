# Requerimiento original — audio del cliente (Limatco)

Transcripción corregida entregada por Seba:

> [Saludo poco claro]. Más o menos, lo que necesito que tenga esa aplicación es poder consultar los productos con un botón, para que me entregue la ubicación, la cantidad de stock, los sectores y los acopios —como aparece ahí—, pero de una manera más resumida.
> Que pueda registrar las entradas y las salidas, y que el stock se rebaje automáticamente al registrar una salida.
> También necesito un gráfico que muestre la frecuencia y el historial de los movimientos.
> Al retirar un producto, el espacio debería quedar libre. Cuando llegue otro producto, debería mostrar si existe algún espacio ocupado o desocupado.
> También debería permitir agregar productos nuevos a la tabla y, mediante un botón o ingresando el código, rebajar automáticamente el stock.
> Finalmente, necesito que quede una planilla de salida de mercadería, con la fecha y hora en que salió cada producto. Más o menos, algo así.

La palabra “acopios” y una frase intermedia se escuchan con poca claridad; el resto del requerimiento se entiende bien.

## Decisiones tomadas con Seba (02-11-2026)
- Espacio libre/ocupado: **maestro de ubicaciones editable** con capacidad por posición (vacía = solo libre/ocupada).
- Base de datos: **pestañas APP_ nuevas** en la misma planilla; las hojas originales quedan de respaldo.
- Salida: **total o parcial**.
- Extras fase 1: **ID + QR por pallet, traslados, pegamentos, login por usuario** y "profundizar / alto impacto".
