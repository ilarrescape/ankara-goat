# AnkaraGOAT · Federaciones V1 + tablero 3D

**Estado de esta entrega:** implementación integrada en el código, pruebas unitarias y verificador geométrico ejecutados. **No aplicada a producción.** La migración MySQL y la prueba integral remota requieren una base de datos de staging con datos equivalentes a los reales y, de ser posible, dos navegadores o usuarios distintos. No se afirma que esa validación ya haya ocurrido.

## Resumen de la integración

- Federaciones con categorías (1–5), imagen de escudo y banner, ingreso libre o aprobado, privadas por código y límite de 2.000 miembros.
- Presidente, Secretarios con cinco permisos configurables y federados; directorio, solicitudes, perfiles y estadísticas de comunidad.
- Materiales de estudio por enlaces generales y por torneo; preguntas federativas con importación JSON y validación, borradores, aprobación presidencial, prompts para IA y revisiones inmutables.
- Torneos de los cuatro formatos nativos con temática única, propuestas de miembros, configuraciones de 30–70 casilleros y 2–8 fichas, inscripción y convocatoria/W.O.
- Feed, notificaciones, ranking y palmarés individuales, récords básicos, tres familias de logros globales y federativos, Top 10, estadísticas e historial público.
- Desafíos y clásicos entre Federaciones, banco temático de estudio de ambas comunidades, ranking institucional general y por categoría mediante coeficiente de resultados.
- Manifiesto, estado de inactividad 30/60 días y protección server-side de pertenencia, permisos, visibilidad y bancos de preguntas.
- Tablero 3D integrado como **renderizador** de partidas Socket.IO: el servidor conserva la autoridad sobre turnos, dado, preguntas, casilleros especiales, ruleta, puntajes, sonidos y videos. Fichas grandes con escudo o colores del equipo. El tablero 2D permanece conmutables desde la partida para compatibilidad.
- Texturas 3D convertidas a WebP, sin añadir dependencias WebGL/Three.js; los originales PNG se pueden omitir del ZIP de despliegue para minimizar peso.

## Migración preparada (NO ejecutada)

Archivo: `migrations/202610270001-federations-v1.js`.

| Entidades nuevas                                    | Objetivo                              |
| --------------------------------------------------- | ------------------------------------- |
| `federations`, `federation_members`                 | Identidad y roles                     |
| `federation_knowledges`, `federation_revisions`     | Banco y snapshots                     |
| `federation_proposals`, `federation_challenges`     | Torneos propuestos e interfederativos |
| `federation_events`, `federation_notifications`     | Feed y avisos                         |
| `federation_attendances`, `federation_achievements` | Convocatorias, W.O. y logros          |

Columnas agregadas: `tournaments.federation_id`, `tournaments.federation_category`, `tournaments.federation_scope`, `questions.federation_id`, `questions.federation_author_id`, `game_questions.question_snapshot`. Las preguntas que ya existen quedan con `federation_id = NULL` y continúan en el banco global.

**Precaución:** MySQL puede confirmar operaciones DDL aunque una migración falle después. El script `down` borra entidades federativas: no es un mecanismo seguro de recuperación con datos reales. Respaldar antes de correr `up`.

## Secuencia segura para Railway/MySQL

1. No modificar ni reiniciar la aplicación productiva durante la validación. Mantener este ZIP fuera del despliegue activo.
2. Crear una **copia de staging** de la base de producción, sin compartir credenciales en archivos de entrega. Obtener un backup verificable (idealmente restaurarlo en otra instancia).
3. Con las variables de entorno de staging y `AUTO_MIGRATE=false`, ejecutar:

   ```bash
   npm ci
   npm test
   node public/board3d/verificar_superficies.js
   npm run migrate
   ```

4. Revisar tabla `SequelizeMeta` y comprobar las diez tablas, seis columnas añadidas e índices. Confirmar que los torneos y usuarios previos siguen visibles.
5. Iniciar la aplicación **apuntando sólo a staging** y validar `/api/health`. Registrar una cuenta de prueba y otra de otra comunidad; no usar usuarios productivos para mutar datos.
6. Ejecutar la matriz funcional de abajo, incluida la partida remota. Comparar que 2D y 3D muestran iguales posiciones y casilleros especiales. Revisar logs de Socket.IO, servidor, MySQL y Redis. Probar el despliegue con al menos dos sesiones simultáneas, una de móvil si se dispone.
7. Sólo después de la aprobación del responsable, programar una ventana de producción, respaldar nuevamente, aplicar migración una única vez y desplegar el código sincronizado. `railway.json` **no** dispara migraciones automáticamente y `AUTO_MIGRATE` debe mantenerse en `false` salvo instrucción explícita.

## Matriz de pruebas manuales para staging

- **Acceso:** login, rol global y presidencial, crear Federación privada/pública, invitación válida e inválida, aprobación/rechazo de solicitud, federado en dos Federaciones, límite de 2.000.
- **Roles:** un miembro no puede crear preguntas ni leer respuestas; Secretario sólo las acciones habilitadas; sólo el Presidente puede aprobar preguntas, nombrar Secretarios y editar imagen/manifiesto.
- **Preguntas:** generar y copiar prompt, importar lote válido e inválido, aprobar/rechazar, corregir pregunta y comprobar que vuelve a revisión, estudiar sin respuesta correcta, jugar con el snapshot aun si cambia la pregunta.
- **Conocimiento:** enlace general, enlace de torneo, edición y versión; URL no HTTP/HTTPS rechazada.
- **Torneos:** propuesta de socio, aprobación, creación de Liga 1v1 / Liga compartida / Copa / Copa con liguilla; 30, 31, 40, 69 y 70 casilleros; cupos de 2 y 8 por tablero; intento de inscribirse desde otra Federación rechazado.
- **3D en remoto:** dos navegadores, sincronización del dado, turnos, posiciones, reconexión, preguntas normales, casillero especial, video, ruleta, audio de dado y pasos, ganador, escudos/colores. Cambiar a 2D y volver durante una partida, sin alterar estado ni temporizadores.
- **Convocatoria:** envío, check-in dentro y fuera de ventana, empate exacto del 50 % (W.O.), mayoría estricta (se juega), límite de tres reprogramaciones, puntuación administrativa (ausentes cero), avance a siguiente ronda sin estadísticas personales inventadas.
- **Interfederativo:** Presidentes de dos Federaciones con temática común, desafío y aceptación, inscripciones desde ambas, banco de estudio combinado sin respuestas, campeonato, liquidación del coeficiente y ranking por temática; comprobar clásica 1v1.
- **Comunidad:** feed y notificaciones, marcado de lectura, ranking individual, palmarés, logros, récords, Top 10, estadísticas, página pública, histórico compartible, manifiesto; verificar suspensión al día 30 y archivo al 60 con fechas de staging.
- **Rendimiento:** medir carga del estadio en equipos modestos y móviles, consola JS sin errores, tráfico de WebP, latencia de dados/preguntas, consumo de memoria tras 5 partidas y reconexiones, 3D→2D ante dispositivos no compatibles.

## Limitaciones y decisiones de V1

- Los accesos, permisos y versionado son de servidor. No se implementaron la sucesión presidencial complicada, auditoría pública completa, sanciones complejas ni decenas de récords pospuestos para V2.
- La revisión de W.O. está deliberadamente acotada. Una eliminatoria no avanza sin un ganador presente definido: ante asistencia nula/empate sin ganador, reprogramar o resolver esa excepción organizativa antes de cerrarla; no inventar un campeón.
- El **conteo de logros** es conservador y se obtiene de partidas registradas; los W.O. no inflan los logros individuales.
- Los íconos se cargan desde el CDN Uicons/Flaticon ya utilizado. Revisar licencia/atribución correspondiente a la cuenta del proyecto antes de publicar.
- La migración y la aplicación no se conectaron con Railway productivo durante esta preparación.

## Comprobaciones locales ejecutables

```bash
node --check src/routes/federationRoutes.js
node --check public/js/federations.js
node --check public/js/app.js
node --check public/board3d/app.js
npm test
node public/board3d/verificar_superficies.js
```

Los tests de políticas federativas recorren los **41 tamaños enteros**, los permisos, los límites de categorías, la mayoría estricta y el coeficiente. El verificador del estadio prueba geometría, distribución en cinco columnas, partidas simuladas y dado. Los tests no reemplazan una prueba real con MySQL/Socket.IO/browser.
