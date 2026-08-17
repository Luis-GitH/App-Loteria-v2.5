import dotenv from 'dotenv';
dotenv.config({ path: process.env.ENV_FILE || '.env' });
import mariadb from 'mariadb';

// Import modules dynamically AFTER loading env to ensure DB creds present
const { guardarBoletoProcesado } = await import('../src/modules/boletosToDB.js');
const { cmpPrimitiva } = await import('../src/helpers/premios.js');

async function main(){
  // boleto de prueba: 3 aciertos (25,28,29) y joker exacto
  const boleto = {
    tipo: 'primitiva',
    identificador: 'TEST-PR-2026-06-15-1',
    sorteoCodigo: '072',
    fechaLunes: '2026-06-15',
    combinacion: '25,28,29,01,02,03',
    reintegro: '0',
    semanas: 1,
    terminal: 'TEST',
    joker: '0334540',
    imagen: null,
    sorteos: [
      {
        sorteo: 72,
        fecha: '2026-06-15',
        dia: 'lunes',
        lunesSemana: '2026-06-15'
      }
    ]
  };

  await guardarBoletoProcesado(boleto);

  // comprobar en BD
  const pool = mariadb.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    connectionLimit: 1,
  });
  const conn = await pool.getConnection();
  try{
    const bp = await conn.query("SELECT * FROM primitiva WHERE identificador = ?", [boleto.identificador]);
    console.log('Boleto insertado:', bp);
    const res = await conn.query("SELECT * FROM r_primitiva WHERE fecha = ?", [boleto.fechaLunes]);
    console.log('Resultado sorteo:', res);
    if (bp.length && res.length) {
      const b = bp[0];
      const r = res[0];
      const cmp = cmpPrimitiva(b, r);
      console.log('cmpPrimitiva:', cmp);
    }
  }catch(e){
    console.error('ERROR comprobando BD', e);
  }finally{
    try{ conn.release(); await pool.end(); }catch(e){}
  }
}

main().catch(e=>{ console.error(e); process.exit(1); });
