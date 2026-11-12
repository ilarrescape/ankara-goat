# AnkaraGOAT · Estadio 3D V7 — números de colores y casilleros transparentes

Esta actualización parte de la V6 del prototipo y **solo modifica el diseño de los casilleros**, tal como solicitó Mauricio. Se mantienen la nueva cancha del ascenso con barro, el selector de 30 a 70, las filas de cinco, el centrado automático, el recorrido en zigzag, el dado y toda la estructura del estadio.

## Qué cambió

| Elemento | Antes (V6) | Ahora (V7) |
| --- | --- | --- |
| Fondo del casillero | Relleno de color semitransparente | **Totalmente transparente** (`background: transparent`) |
| Bordes | Rojos, 2 px | **Gris claro tirando a blanco** (`#d9ded6`), 2 px |
| Esquinas | Rectas | Rectas, sin redondeo |
| Números | Tinta marfil sobre cinco fondos distintos | **Cinco colores alternados en los propios números** |
| Efecto desgastado | Rayas y pequeños espacios vacíos en cada cifra | Conservado |

### Paleta aplicada a los números

1. Rojo: `#f04e48`
2. Verde: `#8de16c`
3. Azul: `#55b9ff`
4. Amarillo: `#ffdf59`
5. Violeta: `#d19afa`

El patrón se repite siguiendo el **número** del casillero, independientemente de que una fila esté dibujada de derecha a izquierda o de izquierda a derecha. Por ejemplo, 1 rojo, 2 verde, 3 azul, 4 amarillo, 5 violeta, 6 rojo, etc.

Los números se siguen dibujando localmente sobre canvas con tipografía Impact/Arial Black y borrados puntuales. Se les agrega un **contorno marfil muy fino** para que los colores permanezcan legibles tanto sobre barro como sobre zonas de césped oscuro, sin introducir un fondo artificial.

Se eliminó también la antigua capa de rayas y texturas que estaba aplicada al fondo de los casilleros mediante `::after`, para que no opaque la nueva cancha.

## Cómo probarlo

1. Descomprimí el ZIP completo.
2. Abrí `index.html` directamente en tu navegador; no requiere conexión ni servidor.
3. Deslizá el selector de 30 a 70 casilleros y comprobá que la cancha se vea a través de todos ellos.
4. Mirá los cinco primeros números: rojo, verde, azul, amarillo y violeta. Se repiten en todo el recorrido.
5. Comenzá una partida: fichas, dado, controles y victoria funcionan igual que en V6.

## Verificación automática

Con Node.js, desde la carpeta extraída:

```bash
node verificar_superficies.js
```

Se comprueban las 41 cantidades posibles de casilleros, las cinco tintas en su orden correcto, el fondo transparente, los bordes gris claro sin esquinas redondeadas, las imágenes, las tribunas y la lógica de juego. Estas pruebas son estructurales; para confirmar la apariencia estética exacta, abrí `index.html` en un navegador real.
