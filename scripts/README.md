# Verificador de boletos (CLI)

Este README documenta el uso del verificador directo para cada tipo de apuesta: Euromillones, Primitiva y El Gordo. Requiere que la base de datos tenga cargados los resultados del día indicado.

## Scripts disponibles

- Comando base: `node scripts/verify-ticket.mjs`
- Alias NPM:
  - `npm run verify:eurom` → Euromillones
  - `npm run verify:primi` → Primitiva
  - `npm run verify:gordo` → El Gordo

Ver ayuda rápida:

```
node scripts/verify-ticket.mjs --help
```

## Formatos de entrada

- `--fecha`: ISO `YYYY-MM-DD` (debe existir resultado en BD para ese día).
- `--comb`: combinación del boleto.
  - Acepta: `0522363950`, `05 22 36 39 50`, `05,22,36,39,50`.
- `--sorteo`: opcional; si no se indica, se deduce por fecha.

Campos según juego:

- Euromillones: `--est` (estrellas), formatos como `0207`, `02 07`, `02,07`.
- Primitiva: `--r` o `--reintegro`, y `--c` o `--complementario`.
- Gordo: `--clave` (número clave). Nota: la clave se considera “C”; si coincide y hay <2 aciertos numéricos, se trata como “Reintegro”.

## Ejemplos

### El Gordo

Alias NPM (recomendado):

```
npm run verify:gordo -- --fecha=2025-10-12 --comb=0522363950 --clave=09
```

Comando base:

```
node scripts/verify-ticket.mjs --tipo=gordo --fecha=2025-10-12 --comb=0522363950 --clave=09
```

Salida ejemplo:

```
{
  "tipo": "gordo",
  "fecha": "2025-10-12",
  "sorteo": "041",
  "aciertosNumeros": 4,
  "aciertoClave": 1,
  "categoria": "3ª",
  "premio": "10.285,00 €"
}
```

### Primitiva

Alias NPM:

```
npm run verify:primi -- --fecha=2025-11-06 --comb=010203040506 --r=7 --c=11
```

Comando base:

```
node scripts/verify-ticket.mjs --tipo=primitiva --fecha=2025-11-06 --comb=010203040506 --r=7 --c=11
```

Salida (ejemplo genérico):

```
{
  "tipo": "primitiva",
  "fecha": "2025-11-06",
  "sorteo": "2025/123",
  "aciertosNumeros": 3,
  "aciertoComplementario": 0,
  "aciertoReintegro": 1,
  "categoria": "6ª",
  "premio": "3,00 €"
}
```

### Euromillones

Alias NPM:

```
npm run verify:eurom -- --fecha=2025-11-07 --comb=0102030411 --est=0207
```

Comando base:

```
node scripts/verify-ticket.mjs --tipo=euromillones --fecha=2025-11-07 --comb=0102030411 --est=0207
```

Salida (ejemplo genérico):

```
{
  "tipo": "euromillones",
  "fecha": "2025-11-07",
  "sorteo": "123",
  "aciertosNumeros": 2,
  "aciertosEstrellas": 1,
  "categoria": "12ª",
  "presmio": "5,01 €"
}
```

## Notas

- El script busca el premio en `premios_sorteos` por `tipoApuesta`, `sorteo` y `aciertos`.
- Si no hay premio para esa combinación, `premio` será `null` (o el script omitirá la categoría si no aplica).
- Asegúrate de tener cargados los resultados/premios del día (usa tus comandos de actualización semanales si hace falta).

