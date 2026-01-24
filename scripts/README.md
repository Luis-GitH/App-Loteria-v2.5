# 
Este README documenta el uso de los scripts en este directorio

## Scripts disponibles#

## ACTUALIZAR LAS IPS DE LOS DNS

- Comando base: `node node scripts/update-dns.mjs`
- Alias NPM:
  - `npm run dns-update` →  "node scripts/update-dns.mjs"
Que hace: actualizar los dns de visiona.pro 

## VERIFICAR QUE NO HAY SORTEOS DUPLICADOS

- Comando base: `node scripts/node scripts/find-duplicate-sorteos.mjs`
- Alias NPM:
  - `npm run find-duplicates` →  "node scripts/find-duplicate-sorteos.mjs"
Que hace: VERIFICADA QUE NO HAY SORTEOS DUPLICADOS EN LA BASE DE DATOS


## Notas

- en el router estas definidas las ip docker-server y jellyfin-server 
