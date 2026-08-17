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

const toNumberTokens = (value) =>
  (value || '')
    .toString()
    .split(/[^0-9]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.padStart(2, '0'));

function normalizeSorteo(valor) {
  if (typeof valor === 'number') return valor.toString().padStart(3, '0');
  const s = (valor || '').toString().trim();
  if (!s) return '';
  if (s.includes('/')) {
    const tail = s.split('/').pop() || '';
    return tail.padStart(3, '0');
  }
  const m = s.match(/\d{1,3}$/);
  return m ? m[0].padStart(3, '0') : s;
}

(async ()=>{
  const conn = await pool.getConnection();
  try{
    const lunes = '2026-06-15';
    const domingo = '2026-06-21';
    const boletos = await conn.query(
      `SELECT s.*, b.imagen, b.combinacion, b.estrellas, b.reintegro, b.clave, b.joker
       FROM sorteos s
       JOIN (
         SELECT identificador AS identificadorBoleto, imagen, combinacion, NULL AS estrellas, reintegro, NULL AS clave, joker
         FROM primitiva
         UNION ALL
         SELECT identificador, imagen, combinacion, estrellas, NULL AS reintegro, NULL AS clave, NULL AS joker
         FROM euromillones
         UNION ALL
         SELECT identificador, imagen, combinacion, NULL AS estrellas, NULL AS reintegro, clave, NULL AS joker
         FROM gordo
       ) b ON b.identificadorBoleto = s.identificadorBoleto
       WHERE s.fecha BETWEEN ? AND ?
       ORDER BY s.tipoApuesta, s.fecha, s.sorteo`,
      [lunes, domingo]
    );
    const r_pr = await conn.query(`SELECT * FROM r_primitiva WHERE fecha BETWEEN ? AND ? ORDER BY fecha`, [lunes, domingo]);

    const groupMaps = new Map();
    const tipoOf = (t) => (t || '').toString().toLowerCase();
    for (const row of boletos) {
      const tipo = tipoOf(row.tipoApuesta);
      if (!groupMaps.has(tipo)) groupMaps.set(tipo, new Map());
      const map = groupMaps.get(tipo);
      const key = row.identificadorBoleto;
      const imagenUrl = row.imagen ? `/historico/${row.imagen}` : null;
      if (!map.has(key)) {
        map.set(key, {
          identificadorBoleto: key,
          tipoApuesta: tipo,
          imagenUrl,
          sorteosCount: 1,
          combinacion: row.combinacion || null,
          estrellas: row.estrellas || null,
          reintegro: row.reintegro || null,
          clave: row.clave || null,
          joker: row.joker || null,
        });
      } else {
        const it = map.get(key);
        it.sorteosCount += 1;
        if (!it.combinacion && row.combinacion) it.combinacion = row.combinacion;
        if (!it.estrellas && row.estrellas) it.estrellas = row.estrellas;
        if (!it.reintegro && row.reintegro) it.reintegro = row.reintegro;
        if (!it.clave && row.clave) it.clave = row.clave;
        if (!it.imagenUrl && imagenUrl) it.imagenUrl = imagenUrl;
      }
    }
    const grupos = {
      primitiva: Array.from((groupMaps.get('primitiva') || new Map()).values()),
    };
    console.log('grupos.primitiva:', grupos.primitiva);

    const resultMaps = new Map(r_pr.map(r=>[`${normalizeSorteo(r.sorteo)}|${r.fecha}`, r]));
    const hits = [];
    for (const b of grupos.primitiva) {
      const sorteoKey = '072';
      const fechaKey = '2026-06-15';
      const resultado = resultMaps.get(`${sorteoKey}|${fechaKey}`);
      const numerosB = splitCombination(b.combinacion);
      const numerosR = toNumberTokens(resultado.numeros);
      const aciertosNumeros = numerosB.filter(n=>numerosR.includes(n)).length;
      console.log('boleto', b.identificadorBoleto, 'combinacion parts', numerosB, 'aciertosNumeros', aciertosNumeros);
      // build hit as server
      const partes = [];
      if (aciertosNumeros) partes.push(`${aciertosNumeros} número${aciertosNumeros>1?'s':''}`);
      const hit = { identificador: b.identificadorBoleto, sorteo: sorteoKey, fecha: fechaKey, detalle: partes.join(' + ') };
      hits.push(hit);
      // check joker and add separate hit
      const jokerB = (b.joker||'').toString().replace(/\D+/g,'');
      const jokerR = (resultado.joker||'').toString().replace(/\D+/g,'');
      console.log('jokerB', jokerB, 'jokerR', jokerR);
      if (jokerB && jokerR && jokerB === jokerR) {
        hits.push({ identificador: b.identificadorBoleto, sorteo: sorteoKey, fecha: fechaKey, detalle: 'J', aciertosClave: 'J' });
      }
    }
    // Enriquecer hits con premios
    const { buscarPremioPrimitiva } = await import('../src/helpers/premios.js');
    const enriched = [];
    for (const h of hits) {
      const sNNN = h.sorteo;
      const cmp = { aciertosNumeros: parseInt(h.detalle,10) || 0, aciertoComplementario: 0, aciertoReintegro: 0, aciertoJoker: h.detalle==='J' ? 1 : 0 };
      const premio = await buscarPremioPrimitiva(conn, sNNN, cmp, { fechaISO: '2026-06-15', sorteoTieneCategorias: ()=> true });
      if (premio && premio.categoria) {
        h.categoria = premio.categoria;
        h.premio = premio.premio;
        h.premio_text = premio.premio_text;
        enriched.push(h);
      }
    }
    console.log('hits after enriching/filtering:', enriched);

  }catch(e){ console.error(e); }finally{ try{ await conn.end(); }catch(e){} }
})();
