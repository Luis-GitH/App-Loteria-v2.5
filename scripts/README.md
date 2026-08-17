# 
Este README documenta el uso de los scripts en este directorio

## Scripts disponibles#

## ACTUALIZAR LAS IPS DE LOS DNS

- Comando base: `node node scripts/update-dns.mjs`
- Alias NPM:
  - `npm run dns-update` →  "node scripts/update-dns.mjs"
Que hace: actualizar los dns de visiona.pro 

## CAMBIAR EL DOMINIO EN DYNAMIC DNS

1. Editar `.env_dns`:
   - `DYN_DOMAIN`: dominio base nuevo, sin `https://` (por ejemplo, `ejemplo.com`).
   - `DYN_PASSWORD`: contraseña de Dynamic DNS correspondiente a ese dominio.
   - `DYN_HOSTS`: hosts separados por comas (por ejemplo, `@,www,api`).
2. Ejecutar:
   - `npm run dns-change`

El script `scripts/Update-cambio.dns.mjs` fuerza la actualización de todos los
hosts en Namecheap con la IP pública actual, guarda el dominio y la IP en
`data/public-ip.json` y comprueba cuáles ya se han propagado por DNS.

## VERIFICAR QUE NO HAY SORTEOS DUPLICADOS

- Comando base: `node scripts/node scripts/find-duplicate-sorteos.mjs`
- Alias NPM:
  - `npm run find-duplicates` →  "node scripts/find-duplicate-sorteos.mjs"
Que hace: VERIFICADA QUE NO HAY SORTEOS DUPLICADOS EN LA BASE DE DATOS


## Notas

- en el router estas definidas las ip docker-server y jellyfin-server 
