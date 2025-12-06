/* configuración cron de pm2

Formato de cron:
┌───────── Minuto (0–59)
│ ┌─────── Hora (0–23)
│ │ ┌───── Día del mes (1–31)
│ │ │ ┌─── Mes (1–12)
│ │ │ │ ┌─ Día de la semana (0–7)
* * * * *
Día de la semana: 0 y 7 son domingo.
1 = lunes, 2 = martes, etc.

| Símbolo | Significado                      |
| ------- | -------------------------------- |
| `*`     | “cualquiera” (todos los valores) |
| `,`     | Separador de valores (`1,5,10`)  |
| `-`     | Rango (`1-5`)                    |
| `/`     | Paso (`* /2` = cada 2)            |
autorestart: false
Evita que el script siga corriendo continuamente:
Solo se ejecuta cuando el cron se dispara.
Si quieres dejar un script residente, pon true.
*/
module.exports = {
  apps: [
   /*  {
      name: "update-today",
      script: "update-today.js",
      args: "--all",
      cwd: './',
      cron_restart: "30 22 * * *", // todos los disa  a las 22:30
      autorestart: false
    }, */
   {  name: "verify-week",
      script: "verify-week.js",
      args: "--week --all",
      cwd: './',
      time: true,
      error_file: "./logs/verify-week-errores.log",
      out_file:   "./logs/verify-week-out.log",
      cron_restart: "18 19 * * *", // a "40 22 * * 7" // las 10:45 los domingos
      autorestart: false
    },
    
  ]
}
