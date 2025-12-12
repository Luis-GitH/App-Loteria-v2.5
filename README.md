# App Loteria

Repositorio renovado como `App-Loteria` — punto de inicio nuevo.

- Autor: Luis-GitH
- Descripción: Aplicación para gestionar boletos de lotería.

Instrucciones rápidas:

1. Instalar dependencias:
```powershell
npm install
```
2. Ejecutar en desarrollo:
```powershell
npm start
```

## Actualizar DNS con IP pública

Script para detectar cambios de IP pública y registrar el nuevo valor en múltiples hosts de DynamicDNS (Namecheap).

- Variables de entorno requeridas (puedes ponerlas en `.env`):
  - `DYN_DOMAIN` (dominio en Namecheap)
  - `DYN_PASSWORD` (Dynamic DNS Password)
  - `DYN_HOSTS` lista separada por coma de hosts a actualizar (ej. `@,www,api1,api2,monitor`); si se omite, usa `@`.
- Ejecutar:
```bash
npm run dns:update
```
Guarda la IP previa en `data/public-ip.json` y solo envía actualizaciones si detecta cambios.
