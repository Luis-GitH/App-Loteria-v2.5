
import mariadb from 'mariadb';

import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(process.cwd(), '.env'), override: false });
dotenv.config({ path: path.join(process.cwd(), '.env_cre'), override: true });

(async () => {
  const pool = mariadb.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    port: Number(process.env.DB_PORT || 3306),
    authPlugins: { auth_gssapi_client: () => Buffer.alloc(0) }, // evita el error de plugin
  });
  const conn = await pool.getConnection();
  const [row] = await conn.query("SELECT COUNT(*) AS n FROM premios_sorteos WHERE tipoApuesta='primitiva'");
  const rows = await conn.query("SELECT sorteo, fecha FROM premios_sorteos WHERE tipoApuesta='primitiva' ORDER BY fecha DESC LIMIT 5");
  console.log('premios_primitiva:', row?.n, rows);
  conn.release(); await pool.end();
})();
