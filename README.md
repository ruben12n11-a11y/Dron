# Drone Radar

Estación táctica de bolsillo para vigilar el tráfico aéreo cercano. La app
convierte los datos ADS-B abiertos de **OpenSky Network** en un radar circular
centrado en tu posición, y los complementa con dos fuentes de datos abiertos de
la **NASA**: eventos naturales geolocalizados (EONET) y clima espacial (DONKI).

No hay simulación, ni datos sintéticos, ni valores de relleno: si una fuente no
responde, la app lo dice y no inventa contactos.

## Qué hace

- **Radar táctico** con anillos de alcance, rosa de los vientos, barrido animado y
  blips ubicados por rumbo y distancia respecto a tu estación.
- **Contactos ADS-B reales** de OpenSky, con ICAO24, altitud, velocidad, rumbo y
  distancia; lista ordenada por cercanía y ficha al tocar un blip.
- **Alertas** de proximidad, reversión de trayectoria (>150° con ≥30 kt), posibles
  UAS según indicios ADS-B y eventos de sistema.
- **Eventos naturales** (NASA EONET): incendios, tormentas y volcanes cercanos,
  superpuestos en el radar y listados por distancia.
- **Clima espacial** (NASA DONKI): índice Kp máximo reciente y aviso de posible
  degradación GNSS.
- **Orientación** Norte arriba o Rumbo arriba (con GPS en primer plano).
- **Ajustes persistentes**: estación, alcance, umbral de proximidad, filtros y
  orientación.

## Arquitectura

```
Expo Router (app/)
  (tabs)/index      Radar táctico + eventos NASA
  (tabs)/contacts   Lista y búsqueda de contactos
  (tabs)/alerts     Registro de alertas
  (tabs)/nasa       EONET + DONKI
  (tabs)/settings   Estación, alcance, filtros, orientación

RadarProvider (lib/radar/store.tsx)
  ajustes + AsyncStorage
  polling OpenSky (60 s), actualización manual y reintento
  feed NASA independiente (EONET + DONKI)

Servidor Express (server/)
  GET /api/radar/states          proxy OpenSky + caché 30 s
  GET /api/radar/health
  GET /api/nasa/hazards          proxy EONET + caché 10 min
  GET /api/nasa/space-weather    proxy DONKI + caché 30 min
  GET /api/nasa/health
  GET /api/health
```

### Producción en Cloudflare

El mismo API corre en **Cloudflare Workers** con los endpoints idénticos, y el
frontend web se sirve como estáticos en **Cloudflare Pages**. La lógica no está
duplicada: vive en `server/core/` y ambos entornos la consumen a través de
adaptadores finos.

```
                      ┌──────────────────────────────┐
  Expo web (Pages) ──►│  Worker  worker/index.ts     │
  Expo nativo ───────►│  (router + CORS + JSON)      │
                      └──────────────┬───────────────┘
                                     │ usa
                      ┌──────────────▼───────────────┐
                      │  Núcleo  server/core/*       │
                      │  radar-service  nasa-service │
                      │  geo            cache        │
                      └──────────────┬───────────────┘
              ┌──────────────────────┼──────────────────────┐
              ▼                      ▼                      ▼
          OpenSky               NASA EONET             NASA DONKI

  Express (server/radar.ts, server/nasa.ts) usa el MISMO núcleo
  con MemoryCacheStore en lugar de la Cache API.
```

La única diferencia real entre ambos entornos es la caché:

| Entorno | Implementación de `CacheStore` | Motivo |
| --- | --- | --- |
| Express local | `MemoryCacheStore` (`Map`) | Un solo proceso persistente |
| Cloudflare Worker | `CloudflareCacheStore` (`caches.default`) | Un `Map` no sobrevive entre invocaciones |

### Flujo de datos

1. `RadarProvider` arranca en `connecting` y consulta únicamente OpenSky.
2. El cliente pide `GET /api/radar/states` con latitud, longitud y radio.
3. El servidor consulta OpenSky, normaliza cada vector de estado y cachea 30 s por
   caja geográfica (bbox).
4. El servidor exige muestra reciente (máx. 5 min), ICAO24 hexadecimal de 6
   caracteres y coordenadas válidas; el cliente vuelve a comprobar fuente y
   frescura antes de marcar la respuesta como real.
5. Una respuesta fresca, incluso con cero aeronaves, confirma `live`. Un resultado
   vacío se muestra con cero contactos y ningún blip.
6. Si falla la red, la validación u OpenSky, se limpian los contactos, se muestra
   el error y se permite reintentar. Nunca se generan contactos simulados.
7. Los eventos NASA (EONET/DONKI) van por un feed **independiente**: una caída de
   NASA no borra los contactos ADS-B, y una caída de OpenSky no borra los eventos
   NASA.

### Requisitos previos

- **Node.js 22+** y **pnpm** (wrangler 4 exige Node 22.12 o superior).
- No se necesita ninguna clave para funcionar en modo básico: OpenSky tiene
  acceso anónimo (cuota reducida) y EONET es de dominio público.

## Puesta en marcha

```bash
pnpm install

# Variables de entorno (todas opcionales en local)
cp .env.example .env
# NASA_API_KEY=...            # solo para DONKI (clima espacial)
# OPENSKY_CLIENT_ID=...       # opcional, sube la cuota de OpenSky
# OPENSKY_CLIENT_SECRET=...

pnpm dev            # API (3000) + Metro web (8081)
```

Para trabajar por separado:

```bash
pnpm dev:server     # API en http://localhost:3000
pnpm dev:metro      # Metro web en http://localhost:8081
```

En web local, Metro no puede deducir la URL del API a partir del host, así que
exporta la base antes de arrancar Metro:

```bash
EXPO_PUBLIC_API_BASE_URL=http://localhost:3000 pnpm dev:metro --clear
```

## Scripts

| Script | Qué hace |
| --- | --- |
| `pnpm dev` | API + Metro web a la vez |
| `pnpm dev:server` | Servidor Express en 3000 |
| `pnpm dev:metro` | Metro web en 8081 |
| `pnpm check` | Typecheck (`tsc --noEmit`) |
| `pnpm lint` | ESLint (`expo lint`) |
| `pnpm test` | Pruebas unitarias (vitest) |
| `pnpm format` | Prettier |
| `pnpm build` | Empaqueta el servidor con esbuild |
| `pnpm start` | Arranca el servidor empaquetado |
| `pnpm worker:dev` | Worker en local (`wrangler dev`, puerto 8787) |
| `pnpm worker:deploy` | Despliega el Worker en Cloudflare |
| `pnpm worker:types` | Genera tipos de bindings de Cloudflare |

## Despliegue en Cloudflare

El backend es un Worker sin estado: no guarda nada y no necesita D1, R2 ni KV.
Las instantáneas viven en la Cache API de Cloudflare.

### 1. Token de API

Crea un token en el panel de Cloudflare con la plantilla **Edit Cloudflare
Workers** (permisos `Workers Scripts: Edit` y `Account Settings: Read`).
Comprueba que es válido antes de desplegar:

```bash
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  https://api.cloudflare.com/client/v4/user/tokens/verify
```

### 2. Secretos (nunca en el repositorio)

```bash
pnpm exec wrangler secret put NASA_API_KEY
pnpm exec wrangler secret put OPENSKY_CLIENT_ID        # opcional
pnpm exec wrangler secret put OPENSKY_CLIENT_SECRET    # opcional
```

En local, los secretos van en `.dev.vars` (ya ignorado por git):

```
NASA_API_KEY=...
```

### 3. Desplegar

```bash
pnpm worker:deploy
```

La API queda en `https://drone-radar-api.<tu-subdominio>.workers.dev`.

### 4. Frontend web en Pages

```bash
EXPO_PUBLIC_API_BASE_URL="https://drone-radar-api.<tu-subdominio>.workers.dev" \
  npx expo export --platform web --output-dir dist-web
```

Sube `dist-web/` como proyecto de Pages (o conecta el repositorio y usa ese
comando como build). La variable `EXPO_PUBLIC_API_BASE_URL` se incrusta en el
bundle en tiempo de compilación, así que debe estar definida al exportar.

### 5. Integración continua

`.github/workflows/ci.yml` verifica tipos, lint, pruebas y un `wrangler deploy
--dry-run` en cada push y pull request. El job de despliegue solo se ejecuta en
`main` y **solo si existe el secreto `CLOUDFLARE_API_TOKEN`**; sin él, se omite
y la pipeline sigue verde.

## Estructura del proyecto

- `app/_layout.tsx`: fuentes, proveedor global, tema y stack.
- `app/(tabs)/`: las cinco pestañas (radar, contactos, alertas, NASA, ajustes).
- `lib/radar/`: estado, persistencia, polling, alertas y geolocalización.
  - `geo.ts` haversine, rumbo, destino y formato.
  - `store.tsx` estado, polling OpenSky, feed NASA y watcher de curso GPS.
- `lib/nasa/`: cliente, parseo y vista de EONET/DONKI.
- `components/radar/RadarScope.tsx`: SVG del radar, rosa, blips y eventos.
- `components/hud.tsx`: paneles, chips, métricas y botones del HUD.
- `server/core/`: lógica compartida (radar, NASA, geo, caché); no depende de Express ni de Cloudflare.
- `server/`: adaptador Express (OpenSky, NASA) sobre `server/core/`.
- `worker/`: adaptador Cloudflare Workers (`index.ts` enrutador, `cache.ts` Cache API).
- `wrangler.toml`: configuración del Worker.
- `tests/` y `lib/**/*.test.ts`: pruebas unitarias.

## Fuentes de datos

| Fuente | Qué aporta | Clave | Caché servidor |
| --- | --- | --- | --- |
| [OpenSky Network](https://openskynetwork.github.io/opensky-api/) | Tráfico ADS-B en tiempo real | Opcional (OAuth2) | 30 s |
| [NASA EONET](https://eonet.gsfc.nasa.gov/) | Eventos naturales geolocalizados | No | 10 min |
| [NASA DONKI](https://api.nasa.gov/) | Clima espacial (Kp) | Sí (`NASA_API_KEY`) | 30 min |

## Límites honestos

- **Los drones pequeños no emiten ADS-B.** La mayoría de sUAS civiles no
  transmiten por ADS-B, así que un radar basado en OpenSky ve sobre todo
  aeronaves grandes y comerciales. Un radar de drones de baja altitud requeriría
  Remote ID o telemetría directa, que este proyecto no cubre.
- **Los datos ADS-B pueden estar incompletos** o llegar con retraso. La app lo
  advierte y nunca rellena huecos con datos inventados.
- **El clima espacial (DONKI)** puede no reportar actividad reciente; en ese caso
  la app muestra «sin datos» en lugar de un valor por defecto.
- **Los eventos de EONET** pueden estar a cientos de kilómetros; con un alcance
  reducido es normal que no aparezca ninguno cerca.
- **No usar para navegación ni seguridad aérea.**

## Licencia

MIT. Ver [LICENSE](LICENSE).
