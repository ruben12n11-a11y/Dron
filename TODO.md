# TODO — Drone Radar

## Radar táctico y geolocalización
- [x] Pantalla de radar circular centrada en la posición propia, con anillos de alcance, puntos cardinales N/E/S/O, barrido animado y blips ubicados por rumbo y distancia.
  - Evidencia: scope SVG en `components/radar/RadarScope.tsx`; capturas a 390×844 con anillos 1.3/2.5/3.8/5.0 km, cardinales y barrido cian.
- [x] La orientación «Norte arriba» conserva el norte geográfico en la parte superior. Al activar «Rumbo arriba», la dirección real de desplazamiento apunta arriba: al caminar hacia el sur, la S queda arriba y la N abajo, y las marcas cardinales y los contactos rotan en consonancia. El rumbo se obtiene del movimiento GPS con permiso foreground, solo mientras la app está activa; se indica que espera movimiento cuando no hay curso fiable, se detiene al desactivar el modo o pasar la app al fondo, y no usa permiso ni seguimiento de fondo.
  - Evidencia: el test de `toScreenBearing` verifica sur→arriba y norte→abajo a rumbo 180°; las pruebas cubren heading, desplazamiento sur, muestras cortas, jitter y suavizado 359°/0°. El watcher `watchPositionAsync` se activa solo tras la elección y permiso, y AppState lo detiene en segundo plano; tras 12 s sin curso nuevo, se borra el rumbo y la vista vuelve a norte-arriba/«esperando movimiento». Expo resuelve permisos Android foreground coarse/fine sin `ACCESS_BACKGROUND_LOCATION`. `pnpm check`, `pnpm lint`, pruebas y exportación Expo pasan; la captura móvil conserva Norte arriba por defecto. No se probó un GPS real ni el diálogo del SO en un teléfono físico.
- [x] Cálculo geoespacial de distancia mediante haversine y de rumbo (bearing) de cada contacto respecto a la posición propia.
  - Evidencia: `lib/radar/geo.ts`; la ficha calcula distancia, rumbo y coordenadas directamente desde cada contacto OpenSky recibido.
- [x] Clasificación visual por cercanía usando un umbral configurable: contactos cercanos en rojo y contactos lejanos en verde.
  - Evidencia: el scope colorea los contactos OpenSky reales según la distancia y el umbral configurado; el pipeline ya no introduce contactos sintéticos.
- [x] Interacción táctil con los blips para consultar latitud, longitud, distancia y estado del contacto seleccionado.
  - Evidencia: tocar una marca de contacto abre la ficha con ICAO, distancia, rumbo, altitud, velocidad y coordenadas de la respuesta ADS-B.

## Métricas y contactos
- [x] Panel de métricas con posición actual, umbral activo, total de contactos detectados y cantidad de drones cercanos.
  - Evidencia: las métricas se derivan exclusivamente de contactos validados por OpenSky; una respuesta vacía se representa como cero, sin blips añadidos.
- [x] Lista de contactos ordenada por distancia, sincronizada con los contactos visibles en el radar.
  - Evidencia: la lista se construye y ordena desde los mismos contactos OpenSky usados por el radar, sin registros prefabricados.

## Alertas y filtros
- [x] Registro de alertas por proximidad, reversión de trayectoria con giro superior a 150°, posibles UAS según indicios ADS-B, altitud y velocidad.
  - Evidencia: las alertas se calculan a partir de sucesivas muestras ADS-B reales del mismo contacto; los giros >150° y velocidad ≥30 kt se evalúan en `lib/radar/store.tsx`.
- [x] Filtros configurables de altitud mínima y velocidad para controlar qué contactos se muestran y analizan.
  - Evidencia: los filtros se aplican a los contactos OpenSky validados antes de mostrarlos y generar alertas.

## Ajustes y datos
- [x] Ajustes para definir la posición propia, el radio o alcance visual del radar y el umbral de distancia de proximidad, persistidos en el dispositivo. OpenSky es la única fuente; no hay selector ni opción de simulación.
  - Evidencia: estación, alcance, umbral y filtros continúan en AsyncStorage; Ajustes muestra el estado y el control de actualización de OpenSky sin selector de fuentes. El valor heredado de `source` se descarta al sanear y guardar la configuración; un `source="sim"` previo no activa ningún modo.
- [x] La aplicación solicita permiso de ubicación en primer plano cuando el usuario elige «Usar mi ubicación actual»; si se concede, obtiene latitud/longitud actuales y las aplica como estación del radar. Si se deniega o no puede obtener la posición, conserva la estación anterior y explica cómo reintentar. No realiza seguimiento en segundo plano.
  - Evidencia: botón y aviso de uso visibles en Preview; `expo-location` con prompt iOS en español y permisos Android coarse/fine; helper solo solicita permiso foreground y actualiza tras validar coordenadas. 3 pruebas unitarias pasan (concedido, denegado, fuera de rango), además de `pnpm check` y `pnpm lint`. No se dispone de un teléfono/build nativo para verificar el diálogo del SO o leer un GPS real; el config del build está preparado.
- [x] Monitoreo ADS-B en tiempo real exclusivamente con OpenSky. Cada respuesta debe acreditar `source=opensky`, una muestra de no más de 5 minutos, ICAO24 hexadecimal de 6 caracteres y coordenadas válidas antes de mostrar contactos. Una respuesta válida sin aeronaves debe mostrar cero contactos y radar vacío. Si hay error de red, upstream o validación, se limpian los contactos, se muestra el error y se permite reintentar; nunca se generan ni se presentan contactos simulados.
  - Evidencia: el endpoint público respondió HTTP 200 con `source=opensky`, muestra fresca y 10 aeronaves en 50 km; el Preview mostró estado `ADS-B REAL` y contactos actuales de OpenSky. En 5 km la respuesta real válida tuvo `count=0`; el cliente deja el radar vacío. El motor local y el selector fueron retirados, y los errores ahora limpian contactos y muestran el mensaje recibido.

## Identidad y entrega
- [x] Interfaz táctil en español, tema oscuro de radar táctico, con icono de lanzador propio y assets de marca (icon, splash, favicon, adaptive icon).
  - Evidencia: icono 1024×1024 generado, splash, favicon, capas adaptativas Android, `logoUrl` público y tema cian/rojo sobre #04070B.
- [x] Typecheck sin errores, Metro en 8081 y API en 3000 operativos, y checkpoint guardado.
  - Evidencia: `pnpm check`, `pnpm lint` y exportación web estática pasan; Metro 8081 y API 3000 escuchan; checkpoint de cierre en `main`.

## Precisión de orientación y procedencia de datos
- [x] El radar mantiene el norte geográfico arriba, con E a la derecha, S abajo y O a la izquierda; la rotación del barrido no rota la cuadrícula ni los contactos.
  - Evidencia: proyección azimutal norte-arriba en `RadarScope.tsx`, flecha N fija y cabecera “NORTE ↑ FIJO”; pruebas geográficas dieron 0° N, 90° E, 180° S y 270° O.
- [x] La app valida origen OpenSky, edad máxima de 5 minutos, ICAO24 hexadecimal y coordenadas válidas antes de mostrar la fuente como ADS-B real; la pantalla muestra la hora UTC y antigüedad de la muestra. No ofrece ni muestra datos sintéticos.
  - Evidencia: controles independientes en proxy y cliente; endpoint de salud indicó `fresh=true`, respuesta fresca con ICAO válidos y HTTP 400 para coordenadas fuera de rango. Preview mostró OpenSky activo, 10 contactos y antigüedad de muestra; en radio vacío devuelve 0. Ajustes no ofrece fuentes alternativas y los fallos se representan como `SIN ENLACE` sin blips.

## Complemento NASA (EONET y DONKI)
- [x] Capa de eventos naturales geolocalizados de NASA EONET (incendios, tormentas, volcanes) superpuesta en el radar y disponible como pestaña propia, filtrada por el rectángulo del radar y ordenada por distancia.
  - Evidencia: `server/nasa.ts` (proxy con caché de 10 min y `bbox`) y `lib/nasa/*`; el radar dibuja triángulos por rumbo/distancia y la pestaña NASA lista 9 incendios reales de Portugal a 20 m–76 km con rumbo y distancia. EONET no requiere clave.
- [x] Clima espacial de NASA DONKI: índice Kp máximo de los últimos 7 días, aviso de degradación GNSS cuando Kp ≥ 5 y barra de muestras.
  - Evidencia: `GET /api/nasa/space-weather` devolvió HTTP 200 con `source=nasa-donki`; la consulta directa a `DONKI/GST` con la clave respondió 200 con lista vacía (sin tormentas recientes), mostrado como `SIN DATOS` sin inventar valores. La clave vive solo en `.env` (ignorado por git) y en el proxy servidor.
- [x] Alertas de eventos naturales dentro del umbral, con su propio tipo y filtro en la pantalla de alertas.
  - Evidencia: pestaña Alertas mostró 4 alertas «Evento natural cercano» con título, categoría, distancia y rumbo, y el chip de filtro NASA.
- [x] Typecheck, lint y pruebas en verde tras la integración.
  - Evidencia: `pnpm check` y `pnpm lint` sin errores; `pnpm test` = 45 pasan, 1 omitida (5 archivos), incluida la prueba de etiquetas de severidad Kp.
