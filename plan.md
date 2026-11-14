# Drone Radar — Plan de implementación

## 1. Producto

Drone Radar es una app móvil Expo/React Native que convierte el radar ADS-B del proyecto adjunto en una estación táctica de bolsillo. El centro del radar es la posición propia; cada contacto se ubica por rumbo y distancia, se clasifica por cercanía y se puede inspeccionar con un toque.

El alcance funcional es:

- Radar circular con anillos de alcance, cardinales N/E/S/O, barrido animado, umbral de proximidad y blips.
- Distancia por haversine y rumbo geográfico para cada contacto.
- Contactos cercanos en rojo y lejanos en verde, con umbral configurable.
- Panel de métricas: contactos visibles, cercanos, umbral y alcance; la posición de la estación se muestra en una banda fija.
- Lista de contactos ordenada por distancia, con búsqueda, filtros y detalle modal.
- Alertas de proximidad, reversión de trayectoria (>150° con ≥30 kt), posibles UAS por indicios ADS-B y eventos de sistema.
- Filtros de altitud mínima y velocidad mínima.
- Ajustes persistentes de estación, alcance, umbral, filtros, orientación y alertas; OpenSky es la única fuente de contactos.
- No existe opción de simulación ni fallback: una respuesta válida sin aeronaves deja el radar vacío y una conexión fallida no muestra contactos inventados.

## 2. Arquitectura

```
Expo Router (app/)
  (tabs)/index      Radar táctico
  (tabs)/contacts   Lista y búsqueda
  (tabs)/alerts     Registro de alertas
  (tabs)/settings   Estación, fuente, alcance, filtros

RadarProvider (lib/radar/store.tsx)
  settings + AsyncStorage
  polling OpenSky (60 s, actualización manual y reintento)
  historial de posiciones y detección
  alertas y cooldown

Servidor Express (server/)
  GET /api/radar/states  proxy OpenSky + caché 30 s
  GET /api/radar/health
```

### Flujo de datos

1. `RadarProvider` arranca en modo `connecting` y consulta únicamente OpenSky.
2. El cliente consulta `GET /api/radar/states` con latitud, longitud y radio en km.
3. El servidor consulta OpenSky, normaliza el vector de estado y devuelve aeronaves con altitud, velocidad y rumbo; cachea la respuesta 30 s.
4. El servidor exige una marca de tiempo OpenSky reciente (máx. 5 min), ICAO24 hexadecimal de 6 caracteres y coordenadas válidas; el cliente vuelve a comprobar fuente y frescura antes de marcar la respuesta como real.
5. Cada respuesta fresca, incluso con cero aeronaves, confirma `live`; la UI muestra la fuente OpenSky, la hora UTC/edad y la cantidad real recibida. Un resultado vacío se presenta con cero contactos y ningún blip.
6. Si falla la red, la validación o OpenSky, se limpian los contactos, se presenta el error y se permite reintentar. Nunca se activan contactos sintéticos; el polling continúa cada 60 s.
7. Cada contacto ADS-B validado se enriquece con distancia, rumbo, visibilidad, cercanía y giro; se evalúan alertas y se actualiza la UI.

### Orientación geográfica

El scope ofrece dos orientaciones. «Norte arriba» conserva la proyección geográfica actual: 0° arriba, 90° este, 180° sur y 270° oeste. «Rumbo arriba» apunta la dirección de marcha hacia arriba; las marcas cardinales y todos los blips se recolocan según el rumbo GPS (al ir al sur, S queda arriba y N abajo), manteniendo las letras cardinales legibles. Si aún no hay desplazamiento/curso fiable, el radar queda temporalmente en norte arriba y muestra que espera movimiento; un rumbo fiable caduca tras 12 s sin actualización. El barrido visual sigue siendo independiente.

### Ubicación del dispositivo

En Ajustes, «USAR MI UBICACIÓN ACTUAL» solicita permiso foreground solo cuando se pulsa y realiza una lectura puntual. Activar «Rumbo arriba» solicita el mismo permiso de forma explícita, toma una posición inicial y abre un `watchPositionAsync` mientras la app esté activa; la app deriva el curso de la heading GPS o de posiciones sucesivas, filtra jitter y actualiza el centro como máximo cada 60 s. Al desactivar el modo o enviar la app al fondo se cancela la suscripción; no existe permiso ni tarea de fondo. Si el permiso está bloqueado o no se obtiene posición, no se activa el modo y Ajustes explica cómo reintentar. El config plugin aporta la descripción de uso en iOS y los permisos Android necesarios.

### OpenSky

- Sin credenciales por defecto: API anónima de OpenSky, cuota limitada.
- Credenciales opcionales por variables `OPENSKY_CLIENT_ID` y `OPENSKY_CLIENT_SECRET` para OAuth.
- Caché del servidor: 30 s, indexada por caja geográfica (bbox) para compartir consultas cercanas y reducir la cuota. En error 429 se aplica un cooldown.
- Los datos ADS-B pueden estar incompletos; la app lo advierte en Ajustes. Una respuesta vacía sigue siendo una respuesta real, no un motivo para inventar contactos.

## 3. Estructura del proyecto

- `app/_layout.tsx`: fuentes, proveedor global, tema y stack.
- `app/(tabs)/_layout.tsx`: cuatro pestañas y barra HUD.
- `app/(tabs)/index.tsx`: radar, métricas, ticker y cercanos.
- `app/(tabs)/contacts.tsx`: búsqueda, filtros y detalle.
- `app/(tabs)/alerts.tsx`: timeline y borrado confirmado.
- `app/(tabs)/settings.tsx`: estado/actualización de OpenSky y configuración Norte arriba/Rumbo arriba; solicita permiso foreground explícito para ubicación puntual o seguimiento de curso.
- `lib/radar/location.ts`: flujo de permiso foreground y validación de coordenadas, desacoplado del almacenamiento de estación.
- `lib/radar/course.ts` y `course.test.ts`: curso GPS desde heading o posiciones, filtro de jitter, suavizado angular y conversión a rumbo visible.
- `components/hud.tsx`: paneles, chips, métricas, botones y brackets.
- `components/radar/RadarScope.tsx`: SVG, doble orientación, rosa cardinal, ejes, blips, áreas táctiles y barrido.
- `components/radar/ContactDetail.tsx`: ficha y modal.
- `lib/radar/geo.ts`: haversine, rumbo, destino y formato.
- `lib/radar/detection.ts`: indicios UAS, categorías y giro.
- `lib/radar/enrich.ts`: enriquecimiento de contactos.
- `lib/radar/opensky.ts`: cliente del endpoint.
- `lib/radar/store.tsx`: estado, persistencia, polling, alertas y watcher de curso GPS en primer plano.
- `expo-location`: permiso foreground para ubicación puntual o seguimiento explícito en primer plano; sin tarea de localización en background.
- `server/radar.ts`: proxy OpenSky y caché.
- `assets/images/`: icono maestro, splash, favicon y capas adaptativas.

## 4. Diseño

### Exploración de estilos

1. **Radar táctico nocturno** — consola aeroespacial oscura, cian de instrumentación, rojo de alerta, retículas y telemetría monoespaciada. Probabilidad de cola: 0.08.
2. **Cartografía de misión** — capas topográficas, papel militar y tipografía editorial. Probabilidad de cola: 0.05.
3. **Instrumento minimalista** — casi negro, alto contraste y acentos neón aislados. Probabilidad de cola: 0.03.

**Estilo elegido: Radar táctico nocturno.**

#### Design Movement

Consola de mando aeroespacial y HUD de radar, con referencias a scope de vigilancia, misión control y aviónica.

#### Core Principles

- La geometría radial manda: el radar es el héroe, no una tarjeta más.
- La legibilidad bajo presión: números y unidades siempre alineados, etiquetas cortas.
- Economía del color de señal: cian = sistema y datos ADS-B, rojo = proximidad/crítico, verde = contacto lejano, ámbar = advertencia de enlace.
- Densidad serena: mucha información, pero separada por bandas y retículas.

#### Color Philosophy

Fondo azul-negro (#04070B) para visión nocturna y bajo consumo visual; cian (#22D3EE) para instrumentación y datos; rojo (#FB3B53) para proximidad y UAS; verde (#34D399) para contactos lejanos; ámbar (#F5A524) para advertencias de enlace. No hay colores decorativos fuera de la paleta de señal.

#### Layout Paradigm

Una columna móvil centrada con banda de marca, banda de estación, fila de métricas y un scope circular que domina la pantalla. Debajo, ticker de alertas y lista compacta de cercanos. Las pestañas fijan la navegación. Nada de cuadrícula de tarjetas genérica.

#### Signature Elements

- Barrido radial con estela cian y línea leading.
- Blips: punto para aeronave, rombo para UAS, anillo pulsante para cercano.
- Brackets de esquina, etiquetas monoespaciadas y reglas de 1 px.
- Rombo rojo como acento de marca (icono y logo).

#### Interaction Philosophy

El dedo va directo al blip o a la fila; la selección abre una ficha con latitud, longitud, distancia y estado. Los ajustes usan chips grandes y switches; las acciones destructivas piden confirmación. En móvil, una alerta crítica dispara un pulso háptico.

#### Animation

Barrido lineal de 4.8 s, sin rebote. Anillos de proximidad con pulso de 900 ms. El ticker y las métricas se actualizan sin transiciones llamativas. El radar no usa animaciones decorativas que compitan con la lectura.

#### Typography System

Chakra Petch Bold/SemiBold para títulos, valores y marca; Share Tech Mono para coordenadas, unidades, etiquetas y metadatos. Jerarquía: título 30 px, valor de métrica 20–26 px, etiqueta mono 8–10 px, cuerpo 10–12 px.

#### Brand Essence

Radar táctico de bolsillo para vigilar drones y tráfico ADS-B en tiempo real. Personalidad: vigilante, preciso, sobrio.

#### Brand Voice

Directa, técnica y en español; sin adornos. Ejemplos: “Toca un contacto ADS-B para inspeccionar latitud, longitud, distancia y estado.” / “OpenSky respondió: 0 contactos en este alcance.”

#### Wordmark & Logo

“DRONE RADAR” en Chakra Petch Bold, con “RADAR” en cian. El isotipo es un scope de radar concéntrico con silueta de dron y un rombo rojo como contacto hostil; se usa en el icono de lanzador, splash y favicon.

#### Signature Brand Color

Cian de instrumentación **#22D3EE**.

## 5. Dependencias y restricciones

- Starter Expo/React Native/TypeScript existente; no se sustituye.
- `react-native-svg` para el scope; `expo-font` para Chakra Petch y Share Tech Mono; AsyncStorage para ajustes y alertas; expo-haptics para vibración.
- Metro/Web en 8081 y API en 3000; el móvil usa Expo Go.
- Sin claves obligatorias: OpenSky anónimo funciona con cuota limitada. Las credenciales OAuth son opcionales.
- La app no es un instrumento de navegación ni de seguridad aérea; se advierte en Ajustes.
