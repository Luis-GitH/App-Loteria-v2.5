
import mariadb from 'mariadb';

import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(process.cwd(), '.env'), override: false });
dotenv.config({ path: path.join(process.cwd(), '.env_cre'), override: true });

console.log('variables:', process.env.DB_HOST,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    process.env.DB_DATABASE,
    process.env.DB_PORT);
    
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
  console.log('premios_sorteos primitiva:', row?.n);
  conn.release();
  await pool.end();
})();

