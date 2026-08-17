import dotenv from 'dotenv';
dotenv.config({ path: process.env.ENV_FILE || '.env' });
import mariadb from 'mariadb';

const pool = mariadb.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  connectionLimit: 1,
});

function splitCombination(value) {
  if (!value && value !== 0) return [];
  const str = String(value).trim();
  if (!str) return [];
  let parts = str.split(/[^0-9]+/).filter(Boolean);
  if (parts.length > 1) {
    return parts.map((segment) => segment.padStart(2, '0'));
  }
  if (/^\d+$/.test(str)) {
    const chunkSize = str.length % 2 === 0 ? 2 : 1;
    const chunks = [];
    for (let i = 0; i < str.length; i += chunkSize) {
      chunks.push(str.slice(i, i + chunkSize));
    }
    return chunks.filter(Boolean).map((segment) => segment.padStart(2, '0'));
  }
  return [str];
}

function toNumberTokens(value) {
  return (value || '')
    .toString()
    .split(/[^0-9]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.padStart(2, '0'));
}

async function main(){
  const conn = await pool.getConnection();
  try{
    const boletoRows = await conn.query('SELECT * FROM primitiva WHERE identificador=?', ['TEST-PR-2026-06-15-1']);
    const boleto = boletoRows[0];
    const rRows = await conn.query('SELECT * FROM r_primitiva WHERE fecha=?', ['2026-06-15']);
    const resultado = rRows[0];
    console.log('Boleto:', boleto);
    console.log('Resultado:', resultado);
    const numerosB = splitCombination(boleto.combinacion);
    const numerosR = toNumberTokens(resultado.numeros);
    const aciertosNumeros = numerosB.filter((n) => numerosR.includes(n)).length;
    console.log('splitCombination boleto:', numerosB);
    console.log('numerosR:', numerosR);
    console.log('aciertosNumeros:', aciertosNumeros);

    // comprobar Joker match
    const jokerB = (boleto.joker || '').toString().replace(/\D+/g, '');
    const jokerR = (resultado.joker || '').toString().replace(/\D+/g, '');
    console.log('jokerB', jokerB, 'jokerR', jokerR, 'equal?', jokerB && jokerR && jokerB===jokerR);

    const { cmpPrimitiva, buscarPremioPrimitiva } = await import('../src/helpers/premios.js');
    const cmp = cmpPrimitiva(boleto, resultado);
    console.log('cmpPrimitiva:', cmp);
    const sNNN='072';
    // construir hits tal y como lo haría server.js
    const hits = [];
    // hit por números (si corresponde)
    if (cmp.aciertosNumeros || cmp.aciertoComplementario || cmp.aciertoReintegro) {
      const hitNums = {
        identificador: boleto.identificador,
        sorteo: sNNN,
        fecha: resultado.fecha,
        detalle: `${cmp.aciertosNumeros} número${cmp.aciertosNumeros!==1?'s':''}${cmp.aciertoComplementario? ' + complementario':''}${cmp.aciertoReintegro? ' + reintegro':''}`,
        resumen: cmp.aciertosNumeros>0? `${cmp.aciertosNumeros}${cmp.aciertoComplementario?'+C':''}${cmp.aciertoReintegro?'+R':''}` : 'R',
        aciertosClave: (function(){ if (cmp.aciertosNumeros===6 && cmp.aciertoReintegro) return '6+R'; if (cmp.aciertosNumeros===6) return '6'; if (cmp.aciertosNumeros===5 && cmp.aciertoComplementario) return '5+C'; if (cmp.aciertosNumeros===5) return '5'; if (cmp.aciertosNumeros===4) return '4'; if (cmp.aciertosNumeros===3) return '3'; if (cmp.aciertoReintegro) return 'R'; return null; })(),
      };
      const premioNums = await buscarPremioPrimitiva(conn, sNNN, {...cmp, aciertoJoker:0}, { sorteoTieneCategorias: ()=> true, fechaISO: resultado.fecha});
      if (premioNums) {
        hitNums.categoria = premioNums.categoria;
        hitNums.premio = Number.isFinite(premioNums.premio)?premioNums.premio:null;
        hitNums.premio_text = premioNums.premio_text || null;
      }
      hits.push(hitNums);
    }
    // hit por Joker
    if (cmp.aciertoJoker) {
      const hitJ = {
        identificador: boleto.identificador,
        sorteo: sNNN,
        fecha: resultado.fecha,
        detalle: 'Joker',
        resumen: 'J',
        aciertosClave: 'J',
      };
      const premioJoker = await buscarPremioPrimitiva(conn, sNNN, cmp, { fechaISO: resultado.fecha});
      if (premioJoker) {
        hitJ.categoria = premioJoker.categoria;
        hitJ.premio = Number.isFinite(premioJoker.premio)?premioJoker.premio:null;
        hitJ.premio_text = premioJoker.premio_text || null;
      }
      hits.push(hitJ);
    }
    console.log('hits to render:', hits);

  }catch(e){
    console.error(e);
  }finally{
    try{ conn.release(); await pool.end(); }catch(e){}
  }
}

main();
