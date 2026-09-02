# AsyncScope

AsyncScope es un laboratorio local para escribir JavaScript o TypeScript moderno y observar, paso a paso, cómo interactúan el call stack, las Web APIs simuladas, la cola de microtareas, la cola de tareas y el event loop.

El objetivo no es imitar DevTools ni ejecutar cualquier API del navegador. El proyecto ofrece un entorno educativo determinista y aislado para experimentar con funciones, Promises, `async`/`await`, `setTimeout`, `setInterval` y `queueMicrotask`.

## Stack

- Node.js 24.11 o superior y pnpm 12.2.1.
- Astro 7, React 19, TypeScript 5.9 y Tailwind CSS 4.
- Babel 8 para analizar, transformar e instrumentar JavaScript/TypeScript.
- CodeMirror 6 para edición y resaltado.
- Vitest para pruebas unitarias y de componentes; Playwright para recorridos reales en Chromium.

## Arquitectura

El flujo principal es: editor React → Web Worker aislado → compilador Babel → event loop virtual → traza inmutable → reproducción visual.

TypeScript se analiza y sus tipos se eliminan antes de instrumentar el programa. No se realiza comprobación estática de tipos dentro del navegador: una anotación inválida puede desaparecer y producir JavaScript válido. Esta separación es intencional; el visualizador enseña comportamiento en tiempo de ejecución, mientras `pnpm typecheck` valida el código fuente del propio proyecto.

El código del usuario no sale del navegador. El sandbox bloquea red, DOM, almacenamiento, workers anidados, evaluación dinámica e importaciones dinámicas. Los límites de CPU, eventos, timers, tareas, microtareas y profundidad de stack protegen el laboratorio de ejecuciones sin fin.

## Desarrollo local

1. Instala Node.js 24.11 o posterior.
2. Activa Corepack: `corepack enable`.
3. Instala exactamente las dependencias bloqueadas: `pnpm install --frozen-lockfile`.
4. Inicia Astro: `pnpm dev`.

Antes de integrar una rama ejecuta `pnpm validate:full`. Este control revisa formato, lint, tipos, cobertura con umbrales, build de producción y pruebas E2E.

## Flujo Git

- `main`: producción y versiones etiquetadas; no se trabaja directamente aquí.
- `development`: rama de integración para cambios ya verificados.
- `feat/*`, `fix/*`, `test/*` y `docs/*`: ramas cortas creadas desde `development`.

Integra ramas mediante merge explícito (`--no-ff`) para conservar la frontera de cada trabajo. Usa commits pequeños con intención única y no promociones `development` a `main` hasta que `pnpm validate:full` termine correctamente. Al conectar GitHub, protege ambas ramas y exige el workflow de CI antes de permitir merges.

## Límites actuales

- No admite módulos ESM, JSX/TSX, generadores, `for await...of`, DOM, red ni APIs de renderizado.
- TypeScript se transpila, pero no se comprueba semánticamente en el editor.
- La temporización es virtual y determinista; no pretende medir rendimiento real.

Las notas detalladas de arquitectura y hoja de ruta se mantienen localmente en `/docs`, carpeta ignorada por Git conforme a la política actual del repositorio.
