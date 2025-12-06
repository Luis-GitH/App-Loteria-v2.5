#!/usr/bin/env node
import dotenv from 'dotenv';
// Carga común y luego específica según variante/app de PM2
dotenv.config({ path: '.env', override: false });
// Carga directa: si PM2 define `ENV_FILE` lo usamos; si no, se usa
// `.env_<APP_VARIANT>` (por ejemplo `.env_cre` o `.env_family`).
// No hacemos comprobaciones adicionales: si el fichero no existe,
// dotenv lo reportará como "injecting env (0)".
const specificEnvPath = process.env.ENV_FILE || (process.env.APP_VARIANT ? `.env_${process.env.APP_VARIANT}` : `.env_cre`);
dotenv.config({ path: specificEnvPath, override: true });

const APP_VARIANT =
  (process.env.APP_VARIANT ||
    (process.env.PM2_APP_NAME && process.env.PM2_APP_NAME.startsWith('app-') ? process.env.PM2_APP_NAME.slice(4) : process.env.PM2_APP_NAME) ||
    'cre').toLowerCase();
// Propagar la variante activa al entorno para módulos importados dinámicamente
if (!process.env.APP_VARIANT) process.env.APP_VARIANT = APP_VARIANT;
const UI_VARIANTS = {
  cre: {
    title: 'Los ricos de espíritu',
    headerBanner: '/public/img/CREHorizontal.png',
    brandName: 'El Club de los ricos de Espíritu',
  },
  family: {
    title: 'El club de la familia',
    headerBanner: '/public/img/familyHorizontal.png',
    brandName: 'El Club de la Familia',
  },
};

console.log('Estamos en : ', process.env.NODE_ENV);

const activeUI = UI_VARIANTS[APP_VARIANT] || UI_VARIANTS.cre;

import express from 'express';
import session from 'express-session';
import mysqlSession from 'express-mysql-session';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import ejsLayouts from 'express-ejs-layouts';
import mariadb from 'mariadb';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import xlsx from 'xlsx';
import nodemailer from 'nodemailer';
import { procesarSemana as vwProcesarSemana } from './verify-week.js';
import { ensureAppTimezone, todayISO, fechaISO, parseISODateLocal, mondayOf, addDays } from './src/helpers/fechas.js';
import { parseNumberOrNull, formatEuroText, sorteoNumeroNNN } from './src/helpers/funciones.js';
import { cmpEuromillones, cmpPrimitiva, cmpGordo, buscarPremioPrimitiva, buscarPremioEurom, buscarPremioGordo } from './src/helpers/premios.js';
import { parseTicketQR } from './src/modules/parse_ticket_qr.js';
import { getBotesActuales } from './src/modules/botes.js';
import { format as formatDate } from 'date-fns';
import { CLIENT_RENEG_LIMIT } from 'tls';
ensureAppTimezone();
const __root = path.resolve();
const app = express();

//  ***********************************

//chequeo de variables de entorno obligatorias
console.log('Comprobando variables de entorno obligatorias...');
console.log('APP_VARIANT:', APP_VARIANT);
console.log('host:', process.env.DB_HOST);
console.log('database:', process.env.DB_DATABASE);
console.log('port:', process.env.PORT);
// 
// Manejo global de errores para ayudar al debugging local
process.on('unhandledRejection', (reason, p) => {
  console.error('Error Unhandled Rejection at:', p, '\nReason:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Error Uncaught Exception:', err);
  process.exit(1);
});
const HISTORICO_DIRNAME = `historico-${APP_VARIANT}`;
const HISTORICO_DIR = path.join(__root, 'data', HISTORICO_DIRNAME).replace(/\\/g, '/');
const HISTORICO_DIRS = Array.from(
  new Set([
    HISTORICO_DIR,
    ...['cre', 'family'].map((v) => path.join(__root, 'data', `historico-${v}`)),
    path.join(__root, 'data', 'historico'),
  ])
);
const upload = multer({ dest: path.join(__root, 'scr', 'uploads') });
// Trust proxy to capture real IPs when behind reverse proxies (e.g., Caddy)
app.set('trust proxy', true);

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__root, 'views'));
app.use(ejsLayouts);

// Static
app.use('/public', express.static(path.join(__root, 'public')));
// Exponer imágenes históricas de boletos
app.use('/historico', express.static(HISTORICO_DIR));

// Body parsing
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '1mb' }));

// Sessions
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';


const DB_PORT = process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306;
const mysqlSessionOptions = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  port: DB_PORT,
  createDatabaseTable: true,
  clearExpired: true,
  expiration: 1000 * 60 * 60 * 24, // 1 día
  connectionLimit: 5,
};
const MySQLStore = mysqlSession(session);
const sessionStore = new MySQLStore(mysqlSessionOptions);
app.use(
  session({
    name: 'sessid',
    store: sessionStore,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax' },
  })
);

// DB pool
const pool = mariadb.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  connectionLimit: 5,
});

function toWebHistorico(p) {
  if (!p) return null;
  const norm = p.toString().replace(/\\/g, '/');
  if (/^https?:/i.test(norm) || norm.startsWith('/public/')) return norm;
  if (norm.startsWith('/historico/')) return norm;
  const dir = HISTORICO_DIRS.find((d) => norm.indexOf(d) !== -1);
  if (dir) {
    const rel = norm.slice(norm.indexOf(dir) + dir.length).replace(/^\//, '');
    return `/historico/${rel}`;
  }
  const base = norm.split('/').pop();
  return base ? `/historico/${base}` : null;
}

function resolveHistoricoPath(img) {
  if (!img) return null;
  const s = img.toString();
  if (/^https?:/i.test(s)) return null;
  if (path.isAbsolute(s) && !s.startsWith('/historico/')) return s;
  const rel = s.startsWith('/historico/') ? s.replace(/^\/historico\//, '') : path.basename(s);
  for (const dir of HISTORICO_DIRS) {
    const candidate = path.join(dir, rel);
    if (existsSync(candidate)) return candidate;
  }
  return path.join(HISTORICO_DIR, rel);
}

function formatDateYYYYMMDD(value) {
  if (value === null || typeof value === 'undefined') return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? '' : formatDate(parsed, 'yyyy-MM-dd');
  }
  const dateObj = value instanceof Date ? value : new Date(value);
  return Number.isNaN(dateObj.getTime()) ? '' : formatDate(dateObj, 'yyyy-MM-dd');
}

const WEEKDAY_SHORT_ES = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
function formatDateDDMMM(value) {
  if (!value && value !== 0) return '';
  const dateObj = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dateObj.getTime())) return '';
  const dd = String(dateObj.getDate()).padStart(2, '0');
  const weekday = WEEKDAY_SHORT_ES[dateObj.getDay()] || '';
  return `${dd} ${weekday}`;
}

function formatDateTimeYYYYMMDDHHmm(value) {
  if (!value && value !== 0) return '';
  const dateObj = value instanceof Date ? value : new Date(value);
  return Number.isNaN(dateObj.getTime()) ? '' : formatDate(dateObj, 'yyyy-MM-dd HH:mm');
}

function formatCombinationLine(value) {
  return splitCombination(value).join(' ');
}

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

const RESULT_META = {
  euromillones: {
    table: 'r_euromillones',
    compare: cmpEuromillones,
    prize: buscarPremioEurom,
  },
  primitiva: {
    table: 'r_primitiva',
    compare: cmpPrimitiva,
    prize: buscarPremioPrimitiva,
  },
  gordo: {
    table: 'r_gordo',
    compare: cmpGordo,
    prize: buscarPremioGordo,
  },
};

async function obtenerResultadoPorTipo(conn, tipo, sorteoNNN, fechaISO) {
  const meta = RESULT_META[tipo];
  if (!meta) return null;
  let rows = [];
  if (sorteoNNN) {
    rows = await conn.query(`SELECT * FROM ${meta.table} WHERE sorteo=? LIMIT 1`, [Number(sorteoNNN)]);
  }
  if ((!rows || !rows.length) && fechaISO) {
    rows = await conn.query(`SELECT * FROM ${meta.table} WHERE fecha=? LIMIT 1`, [fechaISO]);
  }
  return rows && rows.length ? rows[0] : null;
}

async function evaluarBoletoContraResultados(conn, boleto) {
  const tipo = (boleto?.tipo || '').toLowerCase();
  const meta = RESULT_META[tipo];
  if (!meta) return [];
  const sorteos = Array.isArray(boleto.sorteos) ? boleto.sorteos : [];
  const detalles = [];
  for (const sInfo of sorteos) {
    const sorteoNNN = sorteoNumeroNNN(sInfo.sorteo);
    const resultado = await obtenerResultadoPorTipo(conn, tipo, sorteoNNN, sInfo.fecha);
    if (!resultado) {
      detalles.push({ sorteo: sInfo, status: 'sin_resultado' });
      continue;
    }
    const cmp = meta.compare(boleto, resultado);
    const premio = await meta.prize(conn, sorteoNNN || sorteoNumeroNNN(resultado.sorteo), cmp);
    detalles.push({
      sorteo: sInfo,
      status: premio ? (premio.pendiente ? 'pendiente' : 'evaluado') : 'sin_premio',
      comparativa: cmp,
      premio,
      resultado,
    });
  }
  return detalles;
}

async function guardarBoletoEnDB(boleto) {
  const tipo = (boleto?.tipo || '').toLowerCase();
  if (!['euromillones', 'primitiva', 'gordo'].includes(tipo)) {
    const err = new Error('Tipo de boleto no soportado');
    err.statusCode = 400;
    throw err;
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (tipo === 'primitiva') {
      await conn.query(
        `REPLACE INTO primitiva (identificador, sorteoCodigo, fechaLunes, combinacion, reintegro, semanas, terminal, joker, imagen)
          VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          boleto.identificador,
          boleto.sorteoCodigo,
          boleto.fechaLunes,
          boleto.combinacion,
          boleto.reintegro || null,
          boleto.semanas || 1,
          boleto.terminal || null,
          boleto.joker || null,
          boleto.imagen || null,
        ]
      );
    } else if (tipo === 'euromillones') {
      await conn.query(
        `REPLACE INTO euromillones (identificador, sorteoCodigo, fechaLunes, combinacion, estrellas, millon, semanas, terminal, imagen)
          VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          boleto.identificador,
          boleto.sorteoCodigo,
          boleto.fechaLunes,
          boleto.combinacion,
          boleto.estrellas || null,
          boleto.millon || null,
          boleto.semanas || 1,
          boleto.terminal || null,
          boleto.imagen || null,
        ]
      );
    } else if (tipo === 'gordo') {
      await conn.query(
        `REPLACE INTO gordo (identificador, sorteoCodigo, fechaLunes, combinacion, clave, semanas, terminal, imagen)
          VALUES (?,?,?,?,?,?,?,?)`,
        [
          boleto.identificador,
          boleto.sorteoCodigo,
          boleto.fechaLunes,
          boleto.combinacion,
          boleto.clave || null,
          boleto.semanas || 1,
          boleto.terminal || null,
          boleto.imagen || null,
        ]
      );
    }

    if (Array.isArray(boleto.sorteos)) {
      for (const s of boleto.sorteos) {
        if (!s || !s.sorteo) continue;
        await conn.query(
          `INSERT INTO sorteos (identificadorBoleto, tipoApuesta, sorteo, fecha, dia, lunesSemana)
           VALUES (?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE
             tipoApuesta=VALUES(tipoApuesta),
             sorteo=VALUES(sorteo),
             fecha=VALUES(fecha),
             dia=VALUES(dia),
             lunesSemana=VALUES(lunesSemana)`,
          [
            boleto.identificador,
            boleto.tipo,
            s.sorteo,
            s.fecha,
            s.dia,
            s.lunesSemana,
          ]
        );
      }
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function procesarQRyEvaluar(qrRaw) {
  const qrData = (qrRaw ?? '').toString().trim();
  if (!qrData) {
    const err = new Error('No se recibiÃ³ contenido del QR');
    err.statusCode = 400;
    throw err;
  }
  const boleto = parseTicketQR(qrData);
  if (!boleto || !boleto.tipo) {
    const err = new Error('El QR no corresponde a un boleto soportado');
    err.statusCode = 400;
    throw err;
  }
  const basePayload = {
    identificador: boleto.identificador,
    tipo: boleto.tipo,
    combinacion: boleto.combinacion,
    estrellas: boleto.estrellas,
    reintegro: boleto.reintegro,
    clave: boleto.clave,
    millon: boleto.millon,
    semanas: boleto.semanas,
    sorteos: boleto.sorteos,
    fechaLunes: boleto.fechaLunes,
  };
  if (!Array.isArray(boleto.sorteos) || boleto.sorteos.length === 0) {
    return { boleto: basePayload, evaluaciones: [], message: 'El QR no contiene sorteos para comprobar' };
  }
  const conn = await pool.getConnection();
  try {
    const evaluaciones = await evaluarBoletoContraResultados(conn, boleto);
    const normalized = evaluaciones.map((detalle) => ({
      sorteo: detalle.sorteo,
      status: detalle.status,
      comparativa: detalle.comparativa,
      premio: detalle.premio,
      resultado: detalle.resultado
        ? {
            sorteo: detalle.resultado.sorteo,
            fecha: fechaISO(detalle.resultado.fecha) || detalle.resultado.fecha,
            numeros: detalle.resultado.numeros,
            estrellas: detalle.resultado.estrellas,
            complementario: detalle.resultado.complementario,
            reintegro: detalle.resultado.reintegro,
            numeroClave: detalle.resultado.numeroClave ?? detalle.resultado.clave,
          }
        : null,
    }));
    return { boleto: basePayload, evaluaciones: normalized };
  } finally {
    conn.release();
  }
}

async function ensureUsersTable() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(50) NOT NULL UNIQUE,
        email VARCHAR(120) NOT NULL,
        tipo ENUM('user','admin') NOT NULL DEFAULT 'user',
        clave VARCHAR(64) NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Seed admin if none exists
    const rows = await conn.query(`SELECT COUNT(*) as n FROM users`);
    if ((rows[0]?.n || 0) === 0) {
      const adminPass = process.env.ADMIN_PASSWORD || 'admin1234';
      const hash = await bcrypt.hash(adminPass, 10);
      await conn.query(
        `INSERT INTO users (nombre, email, tipo, clave, password_hash) VALUES (?,?,?,?,?)`,
        ['admin', 'admin@example.com', 'admin', 'admin', hash]
      );
      console.log('Seeded default admin user: admin / (env ADMIN_PASSWORD or admin1234)');
    }
  } finally {
    conn.release();
  }
}

async function ensureMovimientosTable() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS movimientos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        fecha DATE NOT NULL,
        concepto VARCHAR(255) NOT NULL,
        importe DECIMAL(12,2) NOT NULL,
        tipo VARCHAR(20) NOT NULL,
        saldo DECIMAL(12,2) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_fecha (fecha)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    // Asegurar columna comentarios si no existe
    try {
      await conn.query(`ALTER TABLE movimientos ADD COLUMN comentarios VARCHAR(255) NULL`);
    } catch (e) {
      // ignorar si ya existe
    }
  } finally {
    conn.release();
  }
}

async function ensureEnviosBoletosTable() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS envios_boletos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        fecha_envio TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        enviado_por INT NULL,
        fecha_lunes DATE NOT NULL,
        destinatarios TEXT NULL,
        adjuntos_count INT DEFAULT 0,
        adjuntos TEXT NULL,
        estado ENUM('ok','error') NOT NULL DEFAULT 'ok',
        error_message VARCHAR(255) NULL,
        INDEX idx_fecha_lunes (fecha_lunes),
        CONSTRAINT fk_envio_user FOREIGN KEY (enviado_por) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } finally {
    conn.release();
  }
}

async function ensureAccessLogTables() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS logins (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NULL,
        nombre VARCHAR(50) NOT NULL,
        ip VARCHAR(45) NULL,
        user_agent VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_created (created_at),
        CONSTRAINT fk_logins_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS intentosAcceso (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(50) NOT NULL,
        password_intento VARCHAR(255) NOT NULL,
        ip VARCHAR(45) NULL,
        user_agent VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_intentos_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } finally {
    conn.release();
  }
}

const truncateValue = (value, max) => {
  if (value === null || typeof value === 'undefined') return null;
  const str = value.toString();
  return str.length > max ? str.slice(0, max) : str;
};

async function recordIntentoAcceso(conn, nombre, password, ip, userAgent) {
  try {
    await conn.query(
      `INSERT INTO intentosAcceso (nombre, password_intento, ip, user_agent) VALUES (?,?,?,?)`,
      [truncateValue(nombre, 50) || '', truncateValue(password, 255) || '', truncateValue(ip, 45), truncateValue(userAgent, 255)]
    );
  } catch (e) {
    console.error('No se pudo registrar intento de acceso:', e.message);
  }
}

async function recordLogin(conn, user, ip, userAgent) {
  try {
    await conn.query(
      `INSERT INTO logins (user_id, nombre, ip, user_agent) VALUES (?,?,?,?)`,
      [user?.id || null, truncateValue(user?.nombre || '', 50), truncateValue(ip, 45), truncateValue(userAgent, 255)]
    );
  } catch (e) {
    console.error('No se pudo registrar login:', e.message);
  }
}

// Auth helpers
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  res.redirect('/login');
}
function requireRole(role) {
  return (req, res, next) => {
    if (req.session?.user?.tipo === role) return next();
    return res.status(403).render('403', { layout: 'layout', user: req.session.user });
  };
}

// Locals
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  res.locals.ui = activeUI;
  res.locals.appVariant = APP_VARIANT;
  res.locals.appTitle = activeUI.title;
  res.locals.headerBanner = activeUI.headerBanner;
  res.locals.brandName = activeUI.brandName;
  // Formateador monetario EUR (99,99 â‚¬)
  res.locals.fmtEUR = (v) => {
    const n = Number(v || 0);
    const str = n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${str} \u20ac`;
  };
  res.locals.fmtBote = (v) => {
    const n = Number(v || 0);
    if (n >= 1_000_000) {
      const millions = Math.round(n / 100000)/10; //antes 1_000_000
      return `${millions.toLocaleString('es-ES')} MILLONES`;
    }
    return `${n.toLocaleString('es-ES')} â‚¬`;
  };
  res.locals.fmtDate = formatDateYYYYMMDD;
  res.locals.fmtDateTime = formatDateTimeYYYYMMDDHHmm;
  res.locals.fmtDateShort = formatDateDDMMM;
  res.locals.fechaISO = fechaISO;
  res.locals.fmtCombo = formatCombinationLine;
  res.locals.comboParts = splitCombination;
  delete req.session.flash;
  next();
});

// Routes
app.get('/login', (req, res) => {
  res.render('login', { layout: 'layout' });
});

app.post('/login', async (req, res) => {
  const nombreInput = (req.body?.nombre || '').toString().trim();
  const claveInput = (req.body?.clave || '').toString();
  const clientIp = req.ip || req.connection?.remoteAddress || null;
  const userAgent = req.headers['user-agent'] || null;
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query(`SELECT * FROM users WHERE nombre=? LIMIT 1`, [nombreInput]);
    if (!rows.length) {
      await recordIntentoAcceso(conn, nombreInput, claveInput, clientIp, userAgent);
      req.session.flash = { type: 'error', msg: 'Usuario o clave incorrectos' };
      return res.redirect('/login');
    }
    const user = rows[0];
    const ok = await bcrypt.compare(claveInput, user.password_hash);
    if (!ok) {
      await recordIntentoAcceso(conn, nombreInput, claveInput, clientIp, userAgent);
      req.session.flash = { type: 'error', msg: 'Usuario o clave incorrectos' };
      return res.redirect('/login');
    }
    req.session.user = { id: user.id, nombre: user.nombre, email: user.email, tipo: user.tipo };
    await recordLogin(conn, user, clientIp, userAgent);
    res.redirect('/');
  } catch (e) {
    console.error('Login error:', e.message);
    req.session.flash = { type: 'error', msg: 'Error interno' };
    res.redirect('/login');
  } finally {
    conn.release();
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/perfil', requireAuth, (req, res) => {
  res.render('profile', { layout: 'layout' });
});

app.post('/perfil', requireAuth, async (req, res) => {
  const userId = req.session.user?.id;
  if (!userId) {
    req.session.flash = { type: 'error', msg: 'Sesion no valida, vuelve a identificarte' };
    return res.redirect('/login');
  }

  const nombre = (req.body?.nombre || '').trim();
  const email = (req.body?.email || '').trim();
  const passwordActual = (req.body?.password_actual || '').trim();
  const passwordNueva = (req.body?.password_nueva || '').trim();
  const passwordConfirm = (req.body?.password_confirmacion || '').trim();
  const wantsPasswordChange = passwordNueva.length > 0 || passwordConfirm.length > 0 || passwordActual.length > 0;

  if (!nombre || !email) {
    req.session.flash = { type: 'error', msg: 'Nombre y correo son obligatorios' };
    return res.redirect('/perfil');
  }
  if (wantsPasswordChange) {
    if (passwordNueva.length < 8) {
      req.session.flash = { type: 'error', msg: 'La nueva contrasena debe tener al menos 8 caracteres' };
      return res.redirect('/perfil');
    }
    if (passwordNueva !== passwordConfirm) {
      req.session.flash = { type: 'error', msg: 'Las contrasenas nuevas no coinciden' };
      return res.redirect('/perfil');
    }
    if (!passwordActual) {
      req.session.flash = { type: 'error', msg: 'Debes indicar tu contrasena actual para cambiarla' };
      return res.redirect('/perfil');
    }
  }

  let conn;
  try {
    conn = await pool.getConnection();
    if (wantsPasswordChange) {
      const [row] = await conn.query(`SELECT password_hash FROM users WHERE id=?`, [userId]);
      if (!row) {
        req.session.destroy(() => res.redirect('/login'));
        return;
      }
      const matches = await bcrypt.compare(passwordActual, row.password_hash || '');
      if (!matches) {
        req.session.flash = { type: 'error', msg: 'La contrasena actual no es correcta' };
        return res.redirect('/perfil');
      }
      const newHash = await bcrypt.hash(passwordNueva, 10);
      await conn.query(`UPDATE users SET nombre=?, email=?, password_hash=? WHERE id=?`, [nombre, email, newHash, userId]);
    } else {
      await conn.query(`UPDATE users SET nombre=?, email=? WHERE id=?`, [nombre, email, userId]);
    }
    req.session.user = { ...req.session.user, nombre, email };
    req.session.flash = { type: 'info', msg: wantsPasswordChange ? 'Perfil y contrasena actualizados' : 'Perfil actualizado' };
    res.redirect('/perfil');
  } catch (e) {
    console.error('Profile update error:', e.message);
    req.session.flash = { type: 'error', msg: 'No se pudo actualizar el perfil: ' + e.message };
    res.redirect('/perfil');
  } finally {
    if (conn) conn.release();
  }
});

app.get('/', requireAuth, async (req, res) => {
  let saldo = 0;
  let conn;
  try {
    conn = await pool.getConnection();
    const [row] = await conn.query(`SELECT COALESCE(SUM(importe),0) AS saldo FROM movimientos`);
    saldo = row?.saldo || 0;
  } catch (e) {
    console.error('No se pudo calcular el saldo:', e.message);
  } finally {
    if (conn) conn.release();
  }

  let botes = null;
  try {
    botes = await getBotesActuales();
  } catch (e) {
    console.error('No se pudieron obtener botes:', e.message);
  }

  res.render('dashboard', { layout: 'layout', saldo, botes });
});

// Tickets de la semana (usar zona horaria configurada)
function parseISODateOnlyLocal(s) {
  const d = parseISODateLocal(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
function mondayLocal(dateISO) {
  const iso = mondayOf(dateISO);
  return iso || null;
}
function addDaysISO(dateISO, days) {
  return addDays(dateISO, days);
}
function mondayFromParam(param) {
  if (!param) return mondayLocal(todayISO());
  // Soporta 'YYYY-MM-DD' o ISO week 'YYYY-Www'
  const weekMatch = /^([0-9]{4})-W([0-9]{2})$/i.exec(param);
  if (weekMatch) {
    const year = parseInt(weekMatch[1], 10);
    const week = parseInt(weekMatch[2], 10);
    // ISO: lunes de la semana
    const jan4 = new Date(year, 0, 4);
    const day = (jan4.getDay() + 6) % 7; // lunes=0
    const mondayWeek1 = new Date(year, 0, 4 - day);
    const monday = new Date(mondayWeek1);
    monday.setDate(monday.getDate() + (week - 1) * 7);
    return fechaISO(monday);
  }
  return mondayLocal(param);
}
function isoWeekFromMonday(lunesISO) {
  const d = parseISODateOnlyLocal(lunesISO);
  if (!d) return '';
  // d es lunes; calculemos numero de semana ISO
  const target = new Date(d);
  target.setDate(target.getDate() + 3); // Jueves de esa semana
  const jan4 = new Date(target.getFullYear(), 0, 4);
  const weekNo = 1 + Math.round(((target - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return `${target.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

app.get('/tickets', requireAuth, async (req, res) => {
  const lunes = mondayFromParam(req.query.week);
  const domingo = addDaysISO(lunes, 6);
  const conn = await pool.getConnection();
  try {
    // Traer boletos registrados en la semana
    const boletos = await conn.query(
      `SELECT s.*, b.imagen, b.combinacion, b.estrellas, b.reintegro, b.clave
       FROM sorteos s
       JOIN (
         SELECT identificador AS identificadorBoleto, imagen, combinacion, NULL AS estrellas, reintegro, NULL AS clave
         FROM primitiva
         UNION ALL
         SELECT identificador, imagen, combinacion, estrellas, NULL AS reintegro, NULL AS clave
         FROM euromillones
         UNION ALL
         SELECT identificador, imagen, combinacion, NULL AS estrellas, NULL AS reintegro, clave
         FROM gordo
       ) b ON b.identificadorBoleto = s.identificadorBoleto
       WHERE s.fecha BETWEEN ? AND ?
       ORDER BY s.tipoApuesta, s.fecha, s.sorteo`,
      [lunes, domingo]
    );

    // Resultados por tipo durante la semana
    const r_eu = await conn.query(`SELECT * FROM r_euromillones WHERE fecha BETWEEN ? AND ? ORDER BY fecha`, [lunes, domingo]);
    const r_pr = await conn.query(`SELECT * FROM r_primitiva WHERE fecha BETWEEN ? AND ? ORDER BY fecha`, [lunes, domingo]);
    const r_go = await conn.query(`SELECT * FROM r_gordo WHERE fecha BETWEEN ? AND ? ORDER BY fecha`, [lunes, domingo]);

    // Normalizar ruta de imagen a URL pÃºblica bajo /historico
    const toWebImagen = toWebHistorico;
    // Compactar por boleto y agrupar por tipo (3 columnas)
    const groupMaps = new Map();
    const tipoOf = (t) => (t || '').toString().toLowerCase();
    for (const row of boletos) {
      const tipo = tipoOf(row.tipoApuesta);
      if (!groupMaps.has(tipo)) groupMaps.set(tipo, new Map());
      const map = groupMaps.get(tipo);
      const key = row.identificadorBoleto;
      const imagenUrl = toWebImagen(row.imagen);
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
      euromillones: Array.from((groupMaps.get('euromillones') || new Map()).values()),
      primitiva: Array.from((groupMaps.get('primitiva') || new Map()).values()),
      gordo: Array.from((groupMaps.get('gordo') || new Map()).values()),
    };

    const hits = { euromillones: [], primitiva: [], gordo: [] };
    const normalizeSorteo = (valor) => {
      if (typeof valor === 'number') return valor.toString().padStart(3, '0');
      const s = (valor || '').toString().trim();
      if (!s) return '';
      if (s.includes('/')) {
        const tail = s.split('/').pop() || '';
        return tail.padStart(3, '0');
      }
      const m = s.match(/\d{1,3}$/);
      return m ? m[0].padStart(3, '0') : s;
    };
    const toNumberTokens = (value) =>
      (value || '')
        .toString()
        .split(/[^0-9]+/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => p.padStart(2, '0'));
    const toSingleDigit = (value) => {
      if (value === null || typeof value === 'undefined') return '';
      const cleaned = value.toString().replace(/\D+/g, '');
      return cleaned ? cleaned.padStart(2, '0') : '';
    };
    const resultMaps = {
      euromillones: new Map(r_eu.map((r) => [normalizeSorteo(r.sorteo || r.id || r.fecha), r])),
      primitiva: new Map(r_pr.map((r) => [normalizeSorteo(r.sorteo || r.id || r.fecha), r])),
      gordo: new Map(r_go.map((r) => [normalizeSorteo(r.sorteo || r.id || r.fecha), r])),
    };
    const computeHitEu = (boleto, resultado) => {
      const numerosB = splitCombination(boleto.combinacion);
      const estrellasB = splitCombination(boleto.estrellas);
      const numerosR = toNumberTokens(resultado.numeros);
      const estrellasR = toNumberTokens(resultado.estrellas);
      const aciertosNumeros = numerosB.filter((n) => numerosR.includes(n)).length;
      const aciertosEstrellas = estrellasB.filter((e) => estrellasR.includes(e)).length;
      if (!aciertosNumeros && !aciertosEstrellas) return null;
      const partes = [];
      if (aciertosNumeros) partes.push(`${aciertosNumeros} n\u00famero${aciertosNumeros > 1 ? 's' : ''}`);
      if (aciertosEstrellas) partes.push(`${aciertosEstrellas} estrella${aciertosEstrellas > 1 ? 's' : ''}`);
      const aciertosClave = `${aciertosNumeros}+${aciertosEstrellas}`;
      return {
        detalle: partes.join(' y '),
        resumen: aciertosClave,
        aciertosClave,
      };
    };
    const computeHitPr = (boleto, resultado) => {
      const numerosB = splitCombination(boleto.combinacion);
      const numerosR = toNumberTokens(resultado.numeros);
      const aciertosNumeros = numerosB.filter((n) => numerosR.includes(n)).length;
      const compValor = toSingleDigit(resultado.complementario);
      const aciertoComplementario = compValor && numerosB.includes(compValor) ? 1 : 0;
      const reinValorResultado = (resultado.reintegro || '').toString().trim();
      const reinValorBoleto = (boleto.reintegro || '').toString().trim();
      const aciertoReintegro = reinValorResultado && reinValorBoleto && reinValorResultado === reinValorBoleto ? 1 : 0;
      if (!aciertosNumeros && !aciertoComplementario && !aciertoReintegro) return null;
      const partes = [];
      if (aciertosNumeros) partes.push(`${aciertosNumeros} n\u00famero${aciertosNumeros > 1 ? 's' : ''}`);
      if (aciertoComplementario) partes.push('complementario');
      if (aciertoReintegro) partes.push('reintegro');
      let aciertosClave = null;
      if (aciertosNumeros === 6 && aciertoReintegro) aciertosClave = '6+R';
      else if (aciertosNumeros === 6) aciertosClave = '6';
      else if (aciertosNumeros === 5 && aciertoComplementario) aciertosClave = '5+C';
      else if (aciertosNumeros === 5) aciertosClave = '5';
      else if (aciertosNumeros === 4) aciertosClave = '4';
      else if (aciertosNumeros === 3) aciertosClave = '3';
      else if (aciertoReintegro) aciertosClave = 'R';
      return {
        detalle: partes.join(' + '),
        resumen: aciertosNumeros > 0 ? `${aciertosNumeros}${aciertoComplementario ? '+C' : ''}${aciertoReintegro ? '+R' : ''}` : 'R',
        aciertosClave,
      };
    };
    const computeHitGordo = (boleto, resultado) => {
      const numerosB = splitCombination(boleto.combinacion);
      const numerosR = toNumberTokens(resultado.numeros);
      const setR = new Set(numerosR);
      const aciertosNumeros = numerosB.filter((n) => setR.has(n)).length;
      const claveBoleto = toSingleDigit(boleto.clave || boleto.numeroClave);
      const claveResultado = toSingleDigit(resultado.numeroClave || resultado.clave);
      const aciertoClave = claveBoleto && claveResultado && claveBoleto === claveResultado ? 1 : 0;
      if (!aciertosNumeros && !aciertoClave) return null;
      const partes = [];
      if (aciertosNumeros) partes.push(`${aciertosNumeros} n\u00famero${aciertosNumeros > 1 ? 's' : ''}`);
      if (aciertoClave) partes.push('clave');
      const aciertosClave = aciertoClave && aciertosNumeros < 1 ? 'R' : `${aciertosNumeros}${aciertoClave ? '+C' : ''}`;
      return {
        detalle: partes.join(' + '),
        resumen: aciertosClave,
        aciertosClave,
      };
    };
    const hitComputers = {
      euromillones: computeHitEu,
      primitiva: computeHitPr,
      gordo: computeHitGordo,
    };
    for (const row of boletos) {
      const tipo = tipoOf(row.tipoApuesta);
      const resultMap = resultMaps[tipo];
      const compute = hitComputers[tipo];
      if (!resultMap || !compute) continue;
      const sorteoKey = normalizeSorteo(row.sorteo);
      const resultado = resultMap.get(sorteoKey);
      if (!resultado) continue;
      const hit = compute(row, resultado);
      if (!hit) continue;
      hits[tipo].push({
        identificador: row.identificadorBoleto,
        sorteo: sorteoKey,
        fecha: resultado.fecha || row.fecha,
        detalle: hit.detalle,
        resumen: hit.resumen,
        aciertosClave: hit.aciertosClave || null,
      });
    }

    const premioCache = new Map();
    async function fetchPremio(tipo, sorteoKey, aciertosClave) {
      if (!aciertosClave) return null;
      const cacheKey = `${tipo}|${sorteoKey}|${aciertosClave}`;
      if (premioCache.has(cacheKey)) return premioCache.get(cacheKey);
      let rows = await conn.query(
        `SELECT categoria, premio, premio_text FROM premios_sorteos WHERE tipoApuesta=? AND sorteo=? AND aciertos=? LIMIT 1`,
        [tipo, sorteoKey, aciertosClave]
      );
      // Algunos scrapes antiguos de Primitiva guardaron sorteo como "YYYY/NNN".
      // Si no encontramos coincidencia exacta, probamos con la cola "/NNN" para no perder premios.
      if (!rows.length && tipo === 'primitiva' && sorteoKey) {
        const likeKey = `%/${sorteoKey}`;
        rows = await conn.query(
          `SELECT categoria, premio, premio_text FROM premios_sorteos WHERE tipoApuesta=? AND sorteo LIKE ? AND aciertos=? ORDER BY fecha DESC LIMIT 1`,
          [tipo, likeKey, aciertosClave]
        );
      }
      let info = rows.length ? { ...rows[0] } : null;
      if (info) {
        const premioBase = parseNumberOrNull(info.premio);
        info.premio = premioBase;
        info.premio_text = info.premio_text || (Number.isFinite(premioBase) ? formatEuroText(premioBase) : null);
        info.premio_categoria = premioBase;
        info.premio_categoria_text = info.premio_text;
        info.reintegro = null;
        info.reintegro_text = null;
        info.incluyeReintegro = false;
        const requiereReintegro = tipo === 'gordo' && aciertosClave !== 'R' && /\+C$/.test(aciertosClave || '');
        if (requiereReintegro) {
          const reinInfo = await fetchPremio(tipo, sorteoKey, 'R');
          const reintegroValor = reinInfo ? reinInfo.premio_categoria ?? reinInfo.premio ?? null : null;
          const reintegroTexto =
            reinInfo?.premio_categoria_text ||
            reinInfo?.premio_text ||
            (Number.isFinite(reintegroValor) ? formatEuroText(reintegroValor) : null);
          if (Number.isFinite(reintegroValor)) {
            const base = Number.isFinite(premioBase) ? premioBase : 0;
            const total = base + reintegroValor;
            info.premio = total;
            info.premio_text = formatEuroText(total) || info.premio_text;
            info.reintegro = reintegroValor;
            info.reintegro_text = reintegroTexto;
            info.incluyeReintegro = true;
            if (!Number.isFinite(info.premio_categoria)) info.premio_categoria = premioBase;
            if (!info.premio_categoria_text) info.premio_categoria_text = info.premio_text;
          }
        }
      }
      premioCache.set(cacheKey, info);
      return info;
    }
    for (const tipo of ['euromillones', 'primitiva', 'gordo']) {
      for (const hit of hits[tipo]) {
        const info = await fetchPremio(tipo, hit.sorteo, hit.aciertosClave);
        if (info) {
          hit.categoria = info.categoria || null;
          hit.premio = Number.isFinite(info.premio) ? info.premio : parseNumberOrNull(info.premio);
          hit.premio_text = info.premio_text || null;
          if (info.premio_categoria_text || Number.isFinite(info.premio_categoria)) {
            hit.premio_categoria = Number.isFinite(info.premio_categoria) ? info.premio_categoria : null;
            hit.premio_categoria_text = info.premio_categoria_text || null;
          }
          if (info.incluyeReintegro && (Number.isFinite(info.reintegro) || info.reintegro_text)) {
            hit.reintegro = Number.isFinite(info.reintegro) ? info.reintegro : null;
            hit.reintegro_text = info.reintegro_text || null;
          }
        }
      }
    }

    const weekISO = isoWeekFromMonday(lunes);
    const weekISOPrev = isoWeekFromMonday(addDaysISO(lunes, -7));
    const weekISONext = isoWeekFromMonday(addDaysISO(lunes, 7));
    const weekISONow = isoWeekFromMonday(mondayFromParam(undefined));
    res.render('tickets', {
      layout: 'layout',
      lunes,
      domingo,
      weekISO,
      weekISOPrev,
      weekISONext,
      weekISONow,
      grupos,
      r_eu,
      r_pr,
      r_go,
      aciertos: hits,
    });
  } catch (e) {
    console.error('Tickets error:', e.message);
    req.session.flash = { type: 'error', msg: 'No se pudieron cargar los boletos' };
    res.redirect('/');
  } finally {
    conn.release();
  }
});

app.get('/boletos/nuevo', requireAuth, requireRole('admin'), (req, res) => {
  res.render('ticket_add', { layout: 'layout' });
});

app.post('/boletos/nuevo', requireAuth, requireRole('admin'), upload.single('foto'), async (req, res) => {
  let tempPath = req.file?.path || null;
  let finalImagePath = null;
  let finalJsonPath = null;
  try {
    if (!req.file) {
      throw new Error('Debes adjuntar la foto del boleto');
    }
    const mimeOk = (req.file.mimetype || '').startsWith('image/');
    if (!mimeOk) {
      throw new Error('El archivo debe ser una imagen');
    }
    const qrRaw = (req.body?.qrData || '').toString().trim();
    if (!qrRaw) {
      throw new Error('Debes escanear el QR del boleto antes de guardar');
    }
    const parsed = parseTicketQR(qrRaw);
    if (!parsed || !parsed.tipo || !parsed.identificador) {
      throw new Error('El QR proporcionado no es vÃ¡lido para un boleto soportado');
    }
    const baseMonday =
      parsed.fechaLunes ||
      (Array.isArray(parsed.sorteos) && parsed.sorteos.length ? parsed.sorteos[0].lunesSemana : '') ||
      todayISO();
    const tipo = parsed.tipo.toLowerCase();
    const shortId = (parsed.identificador || '').slice(-5) || Date.now().toString().slice(-5);
    const baseName = `Boleto_${baseMonday}_${tipo}_${shortId}`;
    const ext = (() => {
      const original = (req.file.originalname || '').toLowerCase();
      const extName = path.extname(original);
      if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic'].includes(extName)) return extName;
      return '.jpg';
    })();
    await fs.mkdir(HISTORICO_DIR, { recursive: true });
    const imageName = `${baseName}${ext}`;
    finalImagePath = path.join(HISTORICO_DIR, imageName);
    await fs.rename(tempPath, finalImagePath);
    tempPath = null;
    parsed.imagen = imageName;
    const jsonName = `${baseName}.json`;
    finalJsonPath = path.join(HISTORICO_DIR, jsonName);
    await fs.writeFile(finalJsonPath, JSON.stringify(parsed, null, 2), 'utf8');

    await guardarBoletoEnDB(parsed);
    const weekISO = isoWeekFromMonday(baseMonday);
    req.session.flash = { type: 'info', msg: 'Boleto añadido correctamente' };
    return res.redirect(`/tickets/boletos/${tipo}/${encodeURIComponent(parsed.identificador)}?week=${weekISO}`);
  } catch (err) {
    if (!req.session.flash) {
      req.session.flash = { type: 'error', msg: err.message || 'No se pudo guardar el boleto' };
    }
    if (finalImagePath) {
      await fs.rm(finalImagePath, { force: true }).catch(() => {});
    }
    if (finalJsonPath) {
      await fs.rm(finalJsonPath, { force: true }).catch(() => {});
    }
    if (tempPath) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
    }
    res.redirect('/boletos/nuevo');
  }
});

app.get('/tickets/boletos/:tipo/:id', requireAuth, async (req, res) => {
  const tipo = (req.params.tipo || '').toLowerCase();
  const allowed = ['euromillones', 'primitiva', 'gordo'];
  if (!allowed.includes(tipo)) {
    return res.redirect('/tickets');
  }
  const semanaParam = req.query.week;
  const lunes = mondayFromParam(semanaParam);
  const domingo = addDaysISO(lunes, 6);
  const weekISO = isoWeekFromMonday(lunes);
  let boletoId = (req.params.id || '').trim();
  try {
    boletoId = decodeURIComponent(boletoId);
  } catch (e) {
    // leave as-is if decode fails
  }
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query(
      `SELECT s.identificadorBoleto, s.tipoApuesta, s.fecha, s.sorteo, b.imagen, b.combinacion, b.estrellas, b.reintegro, b.clave
       FROM sorteos s
       JOIN (
         SELECT identificador AS identificadorBoleto, imagen, combinacion, NULL AS estrellas, reintegro, NULL AS clave
         FROM primitiva
         UNION ALL
         SELECT identificador, imagen, combinacion, estrellas, NULL AS reintegro, NULL AS clave
         FROM euromillones
         UNION ALL
         SELECT identificador, imagen, combinacion, NULL AS estrellas, NULL AS reintegro, clave
         FROM gordo
       ) b ON b.identificadorBoleto = s.identificadorBoleto
       WHERE s.fecha BETWEEN ? AND ? AND LOWER(s.tipoApuesta)=?
       ORDER BY s.fecha, s.sorteo`,
      [lunes, domingo, tipo]
    );
    const toWebImagen = toWebHistorico;
    const map = new Map();
    for (const row of rows) {
      const key = row.identificadorBoleto;
      if (!key) continue;
      const imagenUrl = toWebImagen(row.imagen);
      if (!map.has(key)) {
        map.set(key, {
          identificadorBoleto: key,
          tipo: tipo,
          imagenUrl,
          combinacion: row.combinacion || null,
          estrellas: row.estrellas || null,
          reintegro: row.reintegro || null,
          clave: row.clave || null,
          sorteosCount: 1,
        });
      } else {
        const it = map.get(key);
        it.sorteosCount += 1;
        if (!it.imagenUrl && imagenUrl) it.imagenUrl = imagenUrl;
        if (!it.combinacion && row.combinacion) it.combinacion = row.combinacion;
        if (!it.estrellas && row.estrellas) it.estrellas = row.estrellas;
        if (!it.reintegro && row.reintegro) it.reintegro = row.reintegro;
        if (!it.clave && row.clave) it.clave = row.clave;
      }
    }
    const lista = Array.from(map.values());
    if (!lista.length) {
      req.session.flash = { type: 'error', msg: 'No se encontraron boletos para la semana seleccionada.' };
      return res.redirect('/tickets?week=' + weekISO);
    }
    const idx = lista.findIndex((b) => b.identificadorBoleto === boletoId);
    if (idx === -1) {
      req.session.flash = { type: 'error', msg: 'No se encontr\u00f3 el boleto solicitado.' };
      return res.redirect('/tickets?week=' + weekISO);
    }
    const current = lista[idx];
    const prev = idx > 0 ? lista[idx - 1] : null;
    const next = idx < lista.length - 1 ? lista[idx + 1] : null;
    res.render('ticket_viewer', {
      layout: 'layout',
      boleto: current,
      prev,
      next,
      tipo,
      weekISO,
    });
  } catch (e) {
    console.error('Ticket viewer error:', e.message);
    req.session.flash = { type: 'error', msg: 'No se pudo abrir el boleto seleccionado.' };
    res.redirect('/tickets?week=' + isoWeekFromMonday(lunes));
  } finally {
    conn.release();
  }
});

// Vista tipo correo para la semana seleccionada
app.get('/tickets/email', requireAuth, async (req, res) => {
  const lunes = mondayFromParam(req.query.week);
  const domingo = addDaysISO(lunes, 6);
  const isCurrentWeek = (lunes === mondayFromParam(undefined));

  // Usar el generador real del correo para asegurar formato idÃ©ntico
  try {
    const { resumenFinal, adjuntosFinal } = await vwProcesarSemana(lunes, { autoUpdate: isCurrentWeek });
    const toWebImagen = toWebHistorico;
    const adjuntos = (adjuntosFinal || []).map(a => toWebImagen(a.path)).filter(Boolean);
    const weekISO = isoWeekFromMonday(lunes);
    res.render('tickets_email', { layout: 'layout', lunes, domingo, weekISO, resumenFinal, adjuntos });
    return;
  } catch (e) {
    console.error('Email-like summary fallback to local build:', e.message);
    // Si falla por cualquier motivo, caemos al generador local de abajo
  }

  const conn = await pool.getConnection();
  try {
    // Normalizador de imagen a URL pÃºblica
    const toWebImagen = toWebHistorico;

    const fmt = res.locals.fmtEUR || ((v) => {
      const n = Number(v || 0);
      const str = n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return `${str} \u20ac`;
    });
    const esPremio = (premio) => premio && !premio.pendiente;
    const esPremioConImporte = (premio) => (
      esPremio(premio) && typeof premio.premio === 'number' && premio.premio > 0
    );

    // Buscar premios por tipo
    // Resultados por tipo durante la semana
    const r_eu = await conn.query(`SELECT * FROM r_euromillones WHERE fecha BETWEEN ? AND ? ORDER BY fecha, sorteo`, [lunes, domingo]);
    const r_pr = await conn.query(`SELECT * FROM r_primitiva WHERE fecha BETWEEN ? AND ? ORDER BY fecha, sorteo`, [lunes, domingo]);
    const r_go = await conn.query(`SELECT * FROM r_gordo WHERE fecha BETWEEN ? AND ? ORDER BY fecha, sorteo`, [lunes, domingo]);

    let partes = [];
    let totalImporte = 0;
    let premiadosEu = 0, premiadosPr = 0, premiadosGo = 0;
    let importeEu = 0, importePr = 0, importeGo = 0;
    const adjPaths = new Set();
    const adjuntos = [];
    const formatFechaR = (value) => fechaISO(value) || value;

    // Euromillones
    if (r_eu.length) {
      let resumen = `Resultados de euromillones (${lunes}):\n`;
      resumen += `${r_eu.length} sorteos esta semana\n`;
      for (const s of r_eu) {
        const nums = (s.numeros || '').split(',').join(' ');
        const est = (s.estrellas || '').split(',').join(' ');
        resumen += `Sorteo ${s.sorteo} (${formatFechaR(s.fecha)}): ${nums} + ${est}\n`;
      }
      const lineas = [];
      for (const s of r_eu) {
        const sNNN = sorteoNumeroNNN(s.sorteo);
        const boletos = await conn.query(`SELECT * FROM sorteos WHERE tipoApuesta='euromillones' AND sorteo=?`, [Number(sNNN)]);
        for (const b of boletos) {
          const [boleto] = await conn.query(`SELECT * FROM euromillones WHERE identificador=?`, [b.identificadorBoleto]);
          if (!boleto) continue;
          const cmp = cmpEuromillones(boleto, s);
          const premio = await buscarPremioEurom(conn, sNNN, cmp);
          if (!premio) continue;
          const boletoId = b.identificadorBoleto.slice(-5);
          let detalle = `${cmp.aciertosNumeros} nÃºmeros y ${cmp.aciertosEstrellas} estrellas`;
          if (premio.categoria) detalle += ` Â· CategorÃ­a ${premio.categoria}`;
          detalle += ` Â· ${fmt(premio.premio)}`;
          lineas.push(`Boleto ${boletoId}`);
          lineas.push(`   ${detalle}`);
          const premioValido = esPremio(premio);
          const tieneImporte = esPremioConImporte(premio);
          if (premioValido) {
            premiadosEu += 1;
            if (tieneImporte) {
              importeEu += premio.premio;
              totalImporte += premio.premio;
            }
          }
          const imgUrl = toWebImagen(boleto.imagen);
          if (premioValido && imgUrl && !adjPaths.has(imgUrl)) { adjPaths.add(imgUrl); adjuntos.push(imgUrl); }
        }
      }
      if (!lineas.length) resumen += `Sin aciertos en euromillones esta semana.\n`;
      else resumen += `\n` + lineas.join('\n') + `\n`;
      partes.push(resumen.trim());
    } else {
      partes.push(`No hay sorteos en euromillones con fecha entre ${lunes} y ${domingo}.`);
    }

    // Primitiva
    if (r_pr.length) {
      let resumen = `Resultados de primitiva (${lunes}):\n`;
      resumen += `${r_pr.length} sorteos esta semana\n`;
      for (const s of r_pr) {
        const nums = (s.numeros || '').split(',').join(' ');
        resumen += `Sorteo ${s.sorteo} (${formatFechaR(s.fecha)}): ${nums} + C:${s.complementario} R:${s.reintegro}\n`;
      }
      const lineas = [];
      for (const s of r_pr) {
        const sNNN = sorteoNumeroNNN(s.sorteo);
        const boletos = await conn.query(`SELECT * FROM sorteos WHERE tipoApuesta='primitiva' AND sorteo=?`, [Number(sNNN)]);
        for (const b of boletos) {
          const [boleto] = await conn.query(`SELECT * FROM primitiva WHERE identificador=?`, [b.identificadorBoleto]);
          if (!boleto) continue;
          const cmp = cmpPrimitiva(boleto, s);
          const premio = await buscarPremioPrimitiva(conn, sNNN, cmp);
          if (!premio) continue;
          const boletoId = b.identificadorBoleto.slice(-5);
          let detalle = `${cmp.aciertosNumeros} nÃºmeros`;
          if (cmp.aciertoComplementario === 1) detalle += ' + complementario';
          if (cmp.aciertoReintegro === 1) detalle += ' + reintegro';
          if (premio.categoria) detalle += ` Â· CategorÃ­a ${premio.categoria}`;
          detalle += ` Â· ${fmt(premio.premio)}`;
          lineas.push(`Boleto ${boletoId}`);
          lineas.push(`   ${detalle}`);
          const premioValido = esPremio(premio);
          const tieneImporte = esPremioConImporte(premio);
          if (premioValido) {
            premiadosPr += 1;
            if (tieneImporte) {
              importePr += premio.premio;
              totalImporte += premio.premio;
            }
          }
          const imgUrl = toWebImagen(boleto.imagen);
          if (premioValido && imgUrl && !adjPaths.has(imgUrl)) { adjPaths.add(imgUrl); adjuntos.push(imgUrl); }
        }
      }
      if (!lineas.length) resumen += `Sin aciertos en primitiva esta semana.\n`;
      else resumen += `\n` + lineas.join('\n') + `\n`;
      partes.push(resumen.trim());
    } else {
      partes.push(`No hay sorteos en primitiva con fecha entre ${lunes} y ${domingo}.`);
    }

    // Gordo
    if (r_go.length) {
      let resumen = `Resultados de gordo (${lunes}):\n`;
      resumen += `${r_go.length} sorteo${r_go.length > 1 ? 's' : ''} esta semana\n`;
      for (const s of r_go) {
        const nums = (s.numeros || '').split(',').join(' ');
        resumen += 'Sorteo ' + s.sorteo + ' (' + formatFechaR(s.fecha) + '): ' + nums + '  NºClave:' + s.numeroClave + '\n';
      }
      const lineas = [];
      for (const s of r_go) {
        const sNNN = sorteoNumeroNNN(s.sorteo);
        const boletos = await conn.query(`SELECT * FROM sorteos WHERE tipoApuesta='gordo' AND sorteo=?`, [Number(sNNN)]);
        for (const b of boletos) {
          const [boleto] = await conn.query(`SELECT * FROM gordo WHERE identificador=?`, [b.identificadorBoleto]);
          if (!boleto) continue;
          const cmp = cmpGordo(boleto, s);
          const premio = await buscarPremioGordo(conn, sNNN, cmp);
          if (!premio) continue;
          const boletoId = b.identificadorBoleto.slice(-5);
          let detalle = '';
          if (premio.aciertos && premio.aciertos.endsWith('+C')) detalle = `${(premio.aciertos || '').replace('+C','')} nÃºmeros + clave`;
          else if (/^\d$/.test(premio.aciertos || '')) detalle = `${premio.aciertos} nÃºmeros`;
          else detalle = `Aciertos ${premio.aciertos}`;
          if (premio.categoria) detalle += ` Â· CategorÃ­a ${premio.categoria}`;
          detalle += ` Â· ${fmt(premio.premio)}`;
          lineas.push(`Boleto ${boletoId}`);
          lineas.push(`   ${detalle}`);
          const premioValido = esPremio(premio);
          const tieneImporte = esPremioConImporte(premio);
          if (premioValido) {
            premiadosGo += 1;
            if (tieneImporte) {
              importeGo += premio.premio;
              totalImporte += premio.premio;
            }
          }
          const imgUrl = toWebImagen(boleto.imagen);
          if (premioValido && imgUrl && !adjPaths.has(imgUrl)) { adjPaths.add(imgUrl); adjuntos.push(imgUrl); }
        }
      }
      if (!lineas.length) resumen += `Sin aciertos en gordo esta semana.\n`;
      else resumen += `\n` + lineas.join('\n') + `\n`;
      partes.push(resumen.trim());
    } else {
      partes.push(`No hay sorteos en gordo con fecha entre ${lunes} y ${domingo}.`);
    }

    // Resumen final
    // Pendientes de publicaciÃ³n (sin auto-scrape)
    const WEEKDAY_ES = ['domingo','lunes','martes','miÃ©rcoles','jueves','viernes','sÃ¡bado'];
    const toDateOnly = (d) => fechaISO(d) || d;
    const weekdayFromISO = (iso) => {
      const parsed = parseISODateOnlyLocal(iso);
      return parsed ? parsed.getDay() : 0;
    };
    const expected = {
      euromillones: [1,4].map(n => addDaysISO(lunes, n)),
      primitiva: [0,3,5].map(n => addDaysISO(lunes, n)),
      gordo: [6].map(n => addDaysISO(lunes, n)),
    };
    const haveByDate = (rows) => new Set(rows.map(r => toDateOnly(r.fecha)));
    const haveEu = haveByDate(r_eu);
    const havePr = haveByDate(r_pr);
    const haveGo = haveByDate(r_go);
    const pendientesLineas = [];
    for (const f of expected.euromillones) if (f && !haveEu.has(f)) pendientesLineas.push(`- euromillones: ${WEEKDAY_ES[weekdayFromISO(f)]} ${f} Â· normalmente tras la medianoche del dÃ­a siguiente`);
    for (const f of expected.primitiva) if (f && !havePr.has(f)) pendientesLineas.push(`- primitiva: ${WEEKDAY_ES[weekdayFromISO(f)]} ${f} Â· normalmente tras la medianoche del dÃ­a siguiente`);
    for (const f of expected.gordo) if (f && !haveGo.has(f)) pendientesLineas.push(`- gordo: ${WEEKDAY_ES[weekdayFromISO(f)]} ${f} Â· normalmente se publican el lunes por la maÃ±ana`);

    const resumenFinal = (
      `VerificaciÃ³n de la semana (lunes: ${lunes}):\n\n` +
      partes.filter(Boolean).join('\n\n') +
      `\n\nResumen de la semana:\n` +
      `- Euromillones: ${premiadosEu} boleto${premiadosEu !== 1 ? 's' : ''} premiado${premiadosEu !== 1 ? 's' : ''} Â· ${fmt(importeEu)}\n` +
      `- Primitiva: ${premiadosPr} boleto${premiadosPr !== 1 ? 's' : ''} premiado${premiadosPr !== 1 ? 's' : ''} Â· ${fmt(importePr)}\n` +
      `- Gordo: ${premiadosGo} boleto${premiadosGo !== 1 ? 's' : ''} premiado${premiadosGo !== 1 ? 's' : ''} Â· ${fmt(importeGo)}\n\n` +
      `TOTAL GANADO ESTA SEMANA: ${fmt(totalImporte)}\n` +
      (pendientesLineas.length ? (`\nSorteos pendientes de publicaciÃ³n:\n` + pendientesLineas.join('\n') + '\n') : '')
    );

    const weekISO = isoWeekFromMonday(lunes);
    res.render('tickets_email', {
      layout: 'layout',
      lunes,
      domingo,
      weekISO,
      resumenFinal,
      adjuntos,
    });
  } catch (e) {
    console.error('Email-like summary error:', e.message);
    req.session.flash = { type: 'error', msg: 'No se pudo generar el resumen tipo correo' };
    res.redirect('/tickets?week=' + isoWeekFromMonday(lunes));
  } finally {
    conn.release();
  }
});

// Movimientos (estado de cuentas)
app.get('/movimientos', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    let rows = [];
    try {
      rows = await conn.query(`SELECT * FROM movimientos ORDER BY fecha ASC, id ASC`);
    } catch (e1) {
      try {
        rows = await conn.query(`SELECT * FROM movimiento ORDER BY fecha ASC, id ASC`);
      } catch (e2) {
        rows = [];
      }
    }
    // Calcular saldo acumulado
    let saldo = 0;
    const withSaldo = rows.map(r => {
      saldo += Number(r.importe || 0);
      return { ...r, saldo };
    }).reverse(); // mostrar mÃ¡s recientes primero
    res.render('movimientos', { layout: 'layout', movimientos: withSaldo });
  } finally {
    conn.release();
  }
});

// =============== Importar movimientos desde Excel (admin) ===============

app.get('/movimientos/import', requireAuth, requireRole('admin'), (req, res) => {
  res.render('movimientos_import', { layout: 'layout' });
});

function parseExcelDate(v) {
  if (!v && v !== 0) return null;
  if (typeof v === 'number') {
    // Excel serial date (days since 1899-12-30)
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + v * 86400000);
    return fechaISO(d);
  }
  const s = String(v).trim();
  // try ISO or dd/mm/yyyy
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const D = m[1].padStart(2,'0');
    const M = m[2].padStart(2,'0');
    const Y = m[3].length === 2 ? ('20' + m[3]) : m[3];
    return `${Y}-${M}-${D}`;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : fechaISO(d);
}

function inferTipo(concepto, importe) {
  const c = (concepto || '').toString().toLowerCase();
  if (c.includes('aport')) return 'aportación';
  if (c.includes('premio') || Number(importe) > 0) return 'ingreso';
  if (c.includes('boleto') || c.includes('gasto') || Number(importe) < 0) return 'gasto';
  return 'otro';
}

app.post('/movimientos/import', requireAuth, requireRole('admin'), upload.single('excel'), async (req, res) => {
  const file = req.file;
  if (!file) {
    req.session.flash = { type: 'error', msg: 'Sube un archivo Excel' };
    return res.redirect('/movimientos/import');
  }
  const conn = await pool.getConnection();
  try {
    const wb = xlsx.readFile(file.path);
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
    let inserted = 0;
    for (const r of rows) {
      const fecha = parseExcelDate(r.Fecha ?? r.fecha ?? r.date);
      const concepto = (r.Concepto ?? r.concepto ?? r.descripcion ?? '').toString().trim();
      const comentarios = (r.Comentarios ?? r.comentarios ?? '').toString().trim();
      let importe = r.Importe ?? r.importe ?? r.monto ?? 0;
      importe = Number(String(importe).replace(',','.'));
      if (!fecha || !concepto || !Number.isFinite(importe)) continue;
      const tipo = inferTipo(concepto, importe);
      await conn.query(
        `INSERT INTO movimientos (fecha, concepto, importe, tipo, comentarios) VALUES (?,?,?,?,?)`,
        [fecha, concepto, importe, tipo, comentarios]
      );
      inserted++;
    }
    req.session.flash = { type: 'info', msg: `Importados ${inserted} movimientos` };
    res.redirect('/movimientos');
  } catch (e) {
    req.session.flash = { type: 'error', msg: 'Error importando: ' + e.message };
    res.redirect('/movimientos/import');
  } finally {
    conn.release();
  }
});

// =============== CRUD manual de movimientos (admin) ===============
const MOV_CONCEPTO_OPTIONS = ['Aportación', 'Premios', 'Compra boletos'];
const MOV_TIPO_OPTIONS = [
  { value: 'ingreso', label: 'Ingreso' },
  { value: 'gasto', label: 'Gasto' },
];
const MOV_TIPO_VALUES = MOV_TIPO_OPTIONS.map(o => o.value);

function normalizeConcepto(value) {
  return MOV_CONCEPTO_OPTIONS.includes(value) ? value : MOV_CONCEPTO_OPTIONS[0];
}

function normalizeTipo(value) {
  return MOV_TIPO_VALUES.includes(value) ? value : MOV_TIPO_VALUES[0];
}

function parseImporteStr(v) {
  if (typeof v === 'number') return v;
  const raw = (v ?? '').toString().trim();
  if (!raw) return 0;
  let s = raw.replace(/\s+/g, '').replace(/'/g, '');
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma) {
    // formato europeo: miles con punto, decimales con coma
    s = s.replace(/\./g, '').replace(/,/g, '.');
  } else if (hasDot) {
    const firstDot = s.indexOf('.');
    const lastDot = s.lastIndexOf('.');
    if (firstDot !== lastDot) {
      // mÃºltiples puntos => seguramente miles
      s = s.replace(/\./g, '');
    } else {
      const decimals = s.length - lastDot - 1;
      if (decimals === 0 || decimals > 3) {
        // sin decimales reales, asumir miles
        s = s.replace(/\./g, '');
      }
    }
  }
  const n = Number(s.replace(/[^0-9\.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function formatDateForInput(value) {
  if (!value) return '';
  if (value instanceof Date) {
    return fechaISO(value);
  }
  return fechaISO(value) || value.toString().slice(0, 10);
}

app.get('/movimientos/new', requireAuth, requireRole('admin'), (req, res) => {
  const mov = {
    fecha: todayISO(),
    concepto: MOV_CONCEPTO_OPTIONS[0],
    importe: 0,
    comentarios: '',
    tipo: MOV_TIPO_VALUES[0],
  };
  res.render('movimientos_form', {
    layout: 'layout',
    mode: 'create',
    mov,
    conceptoOptions: MOV_CONCEPTO_OPTIONS,
    tipoOptions: MOV_TIPO_OPTIONS,
  });
});

app.post('/movimientos/new', requireAuth, requireRole('admin'), async (req, res) => {
  const { fecha, concepto, importe, comentarios, tipo } = req.body;
  if (!fecha || !concepto) {
    req.session.flash = { type: 'error', msg: 'Fecha y concepto son obligatorios' };
    return res.redirect('/movimientos/new');
  }
  const conceptValue = normalizeConcepto(concepto);
  const tipoValue = normalizeTipo(tipo);
  const imp = parseImporteStr(importe);
  const conn = await pool.getConnection();
  try {
    await conn.query(
      `INSERT INTO movimientos (fecha, concepto, importe, tipo, comentarios) VALUES (?,?,?,?,?)`,
      [fecha, conceptValue, imp, tipoValue, (comentarios || '').trim()]
    );
    req.session.flash = { type: 'info', msg: 'Movimiento creado' };
    res.redirect('/movimientos');
  } finally { conn.release(); }
});

app.get('/movimientos/:id/edit', requireAuth, requireRole('admin'), async (req, res) => {
  const id = Number(req.params.id);
  const conn = await pool.getConnection();
  try {
    const [row] = await conn.query(`SELECT * FROM movimientos WHERE id=?`, [id]);
    if (!row) {
      req.session.flash = { type: 'error', msg: 'Movimiento no encontrado' };
      return res.redirect('/movimientos');
    }
    const mov = {
      ...row,
      fecha: formatDateForInput(row.fecha),
      concepto: normalizeConcepto(row.concepto),
      tipo: normalizeTipo(row.tipo),
    };
    res.render('movimientos_form', {
      layout: 'layout',
      mode: 'edit',
      mov,
      conceptoOptions: MOV_CONCEPTO_OPTIONS,
      tipoOptions: MOV_TIPO_OPTIONS,
    });
  } finally { conn.release(); }
});

app.post('/movimientos/:id/edit', requireAuth, requireRole('admin'), async (req, res) => {
  const id = Number(req.params.id);
  const { fecha, concepto, importe, comentarios, tipo } = req.body;
  if (!fecha || !concepto) {
    req.session.flash = { type: 'error', msg: 'Fecha y concepto son obligatorios' };
    return res.redirect(`/movimientos/${id}/edit`);
  }
  const conceptValue = normalizeConcepto(concepto);
  const tipoValue = normalizeTipo(tipo);
  const imp = parseImporteStr(importe);
  const conn = await pool.getConnection();
  try {
    await conn.query(
      `UPDATE movimientos SET fecha=?, concepto=?, importe=?, tipo=?, comentarios=? WHERE id=?`,
      [fecha, conceptValue, imp, tipoValue, (comentarios || '').trim(), id]
    );
    req.session.flash = { type: 'info', msg: 'Movimiento actualizado' };
    res.redirect('/movimientos');
  } finally { conn.release(); }
});

app.post('/movimientos/:id/delete', requireAuth, requireRole('admin'), async (req, res) => {
  const id = Number(req.params.id);
  const conn = await pool.getConnection();
  try {
    await conn.query(`DELETE FROM movimientos WHERE id=?`, [id]);
    req.session.flash = { type: 'info', msg: 'Movimiento eliminado' };
  } finally { conn.release(); }
  res.redirect('/movimientos');
});

// Admin
app.get('/admin', requireAuth, requireRole('admin'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const [{ total: totalUsersRaw } = {}] = await conn.query(`SELECT COUNT(*) AS total FROM users`);
      const [{ total: totalLoginsRaw } = {}] = await conn.query(`SELECT COUNT(*) AS total FROM logins`);
      const [{ total: totalAttemptsRaw } = {}] = await conn.query(`SELECT COUNT(*) AS total FROM intentosAcceso`);
      // El driver puede devolver BigInt; convertir a Number para evitar el sufijo `n` en la vista
      const totalUsers = Number(totalUsersRaw ?? 0);
      const totalLogins = Number(totalLoginsRaw ?? 0);
      const totalAttempts = Number(totalAttemptsRaw ?? 0);
    res.render('admin', {
      layout: 'layout',
      stats: {
        users: totalUsers || 0,
        logins: totalLogins || 0,
        intentos: totalAttempts || 0,
      },
    });
  } finally {
    conn.release();
  }
});

// EnvÃ­o de boletos de la semana actual por correo (admins)
app.post('/admin/send-week-tickets', requireAuth, requireRole('admin'), async (req, res) => {
  const lunes = mondayOf(new Date());
  // Resuelve rutas de imagen a paths FS (acepta /historico/, absolute paths o basename en data/historico)

  try {
    // Recolectar imagenes de las tres tablas para la semana (fechaLunes)
    const conn = await pool.getConnection();
    let rows = [];
    try {
      const q = `SELECT imagen FROM euromillones WHERE fechaLunes = ? AND imagen IS NOT NULL AND imagen <> ''`;
      const eu = await conn.query(q, [lunes]);
      const pr = await conn.query(`SELECT imagen FROM primitiva WHERE fechaLunes = ? AND imagen IS NOT NULL AND imagen <> ''`, [lunes]);
      const go = await conn.query(`SELECT imagen FROM gordo WHERE fechaLunes = ? AND imagen IS NOT NULL AND imagen <> ''`, [lunes]);
      rows = [...(eu || []), ...(pr || []), ...(go || [])];
    } finally {
      conn.release();
    }

    const seen = new Set();
    const attachments = [];
    for (const r of rows) {
      const img = r.imagen || r.imagen_path || r.image || null;
      const fsPath = resolveHistoricoPath(img);
      if (!fsPath) continue;
      const ext = path.extname(fsPath || '').toLowerCase();
   //   if (ext !== '.png') continue; // solo PNG segÃºn requerimiento
      try {
        await fs.stat(fsPath);
      } catch (e) {
        continue; // no existe
      }
      if (seen.has(fsPath)) continue;
      seen.add(fsPath);
      attachments.push({ filename: path.basename(fsPath), path: fsPath });
    }

    if (attachments.length === 0) {
      req.session.flash = { type: 'warning', msg: `No se encontraron imÃ¡genes .png para la semana ${lunes}.` };
      return res.redirect('/admin');
    }

    // Obtener destinatarios administradores
    const conn2 = await pool.getConnection();
    let recipients = [];
    try {
      let sql = `SELECT email FROM users WHERE email IS NOT NULL AND email <> '' `
      if (process.env.MODO_DESARROLLO == '1') sql += ` AND tipo = 'admin' `  
      const rows2 = await conn2.query(sql); // `SELECT email FROM users WHERE email IS NOT NULL AND email <> '' AND tipo='admin'`);
      for (const row of rows2) {
        const e = (row.email || '').toString().trim();
        if (e) recipients.push(e);
      }
    } finally {
      conn2.release();
    }

    if ((!recipients || recipients.length === 0) && process.env.EMAIL_DEV_TO) {
      recipients = [process.env.EMAIL_DEV_TO];
    }

    if (!recipients || recipients.length === 0) {
      req.session.flash = { type: 'warning', msg: 'No hay destinatarios (admins) configurados para enviar el correo.' };
      return res.redirect('/admin');
    }

    const smtp = {
      host: process.env.EMAIL_HOST,
      port: Number(process.env.EMAIL_PORT || 465),
      secure: Number(process.env.EMAIL_PORT || 465) === 465,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    };

    const html = `
      <h2>Imágenes de los boletos de esta semana ${lunes}</h2>
      <p>Enviado: ${new Date().toLocaleString('es-ES')}</p>
      <p>Adjuntas ${attachments.length} imagen(es).</p>
      <ul>${attachments.map(a => `<li>${a.filename}</li>`).join('')}</ul>
    `;

    const transporter = nodemailer.createTransport(smtp);
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: recipients.join(','),
      subject: `Boletos de la semana ${lunes}`,
      html,
      attachments,
    });

    // Registrar envÃ­o en BD (auditorÃ­a)
    try {
      const conn3 = await pool.getConnection();
      try {
        await conn3.query(
          `INSERT INTO envios_boletos (enviado_por, fecha_lunes, destinatarios, adjuntos_count, adjuntos, estado)
           VALUES (?,?,?,?,?,?)`,
          [req.session.user?.id || null, lunes, truncateValue(recipients.join(','), 1000), attachments.length, JSON.stringify(attachments.map(a => a.filename)), 'ok']
        );
      } finally {
        conn3.release();
      }
    } catch (e) {
      console.error('No se pudo registrar envÃ­o en BD:', e.message);
    }

    req.session.flash = { type: 'info', msg: `Correo enviado a ${recipients.length} destinatario(s) con ${attachments.length} imagen(es).` };
    return res.redirect('/admin');
  } catch (err) {
    console.error('Error enviando imÃ¡genes de boletos semana:', err);
    // Intentar registrar el error en BD
    try {
      const connErr = await pool.getConnection();
      try {
        await connErr.query(
          `INSERT INTO envios_boletos (enviado_por, fecha_lunes, destinatarios, adjuntos_count, adjuntos, estado, error_message)
           VALUES (?,?,?,?,?,?,?)`,
          [req.session.user?.id || null, lunes, null, attachments?.length || 0, attachments ? JSON.stringify(attachments.map(a => a.filename)) : null, 'error', truncateValue(err.message || String(err), 255)]
        );
      } finally {
        connErr.release();
      }
    } catch (e) {
      console.error('No se pudo registrar envÃ­o (error) en BD:', e.message);
    }

    req.session.flash = { type: 'danger', msg: 'Error enviando imÃ¡genes: ' + (err.message || err) };
    return res.redirect('/admin');
  }
});

app.get('/admin/accesos', requireAuth, requireRole('admin'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const recentLogins = await conn.query(
      `SELECT l.id, l.nombre, l.ip, l.user_agent, l.created_at, u.email
       FROM logins l
       LEFT JOIN users u ON u.id = l.user_id
       ORDER BY l.created_at DESC
       LIMIT 100`
    );
    res.render('admin_logins', { layout: 'layout', logins: recentLogins });
  } finally {
    conn.release();
  }
});

// AuditorÃ­a: listar envÃ­os de boletos
app.get('/admin/envios-boletos', requireAuth, requireRole('admin'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query(
      `SELECT e.id, e.fecha_envio, e.enviado_por, u.nombre AS enviado_por_nombre, e.fecha_lunes, e.destinatarios, e.adjuntos_count, e.adjuntos, e.estado, e.error_message
       FROM envios_boletos e
       LEFT JOIN users u ON u.id = e.enviado_por
       ORDER BY e.fecha_envio DESC
       LIMIT 200`
    );
    res.render('admin_envios_boletos', { layout: 'layout', envios: rows });
  } finally {
    conn.release();
  }
});

// Detalle de un envÃ­o
app.get('/admin/envios-boletos/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const id = Number(req.params.id);
  const conn = await pool.getConnection();
  try {
    const [row] = await conn.query(
      `SELECT e.id, e.fecha_envio, e.enviado_por, u.nombre AS enviado_por_nombre, e.fecha_lunes, e.destinatarios, e.adjuntos_count, e.adjuntos, e.estado, e.error_message
       FROM envios_boletos e
       LEFT JOIN users u ON u.id = e.enviado_por
       WHERE e.id = ? LIMIT 1`,
      [id]
    );
    if (!row) return res.status(404).render('403', { layout: 'layout' });
    let adjuntos = [];
    try {
      adjuntos = row.adjuntos ? JSON.parse(row.adjuntos) : [];
    } catch (e) {
      adjuntos = [];
    }
    res.render('admin_envio_boletos_detail', { layout: 'layout', envio: row, adjuntos });
  } finally {
    conn.release();
  }
});

app.get('/admin/intentos', requireAuth, requireRole('admin'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const recentAttempts = await conn.query(
      `SELECT id, nombre, password_intento, ip, user_agent, created_at
       FROM intentosAcceso
       ORDER BY created_at DESC
       LIMIT 100`
    );
    res.render('admin_attempts', { layout: 'layout', intentos: recentAttempts });
  } finally {
    conn.release();
  }
});

app.get('/admin/escanear', requireAuth, (req, res) => {
  res.render('admin_scan', { layout: 'layout' });
});

app.post('/admin/escanear/resultado', requireAuth, async (req, res) => {
  try {
    const data = await procesarQRyEvaluar(req.body?.qrData ?? req.body?.qr_text);
    res.render('admin_scan_result', {
      layout: 'layout',
      resultado: data,
      error: null,
    });
  } catch (err) {
    res.render('admin_scan_result', {
      layout: 'layout',
      resultado: null,
      error: err.message || 'No se pudo validar el boleto',
    });
  }
});

app.post('/admin/escanear', requireAuth, async (req, res) => {
  try {
    const data = await procesarQRyEvaluar(req.body?.qrData ?? req.body?.qr_text);
    res.json({ ok: true, ...data });
  } catch (err) {
    console.error('QR scan API error:', err);
    const status = err.statusCode || 500;
    res.status(status).json({ ok: false, error: err.message || 'Error interno comprobando el boleto' });
  }
});

// =============== Admin: GestiÃ³n de usuarios ===============
app.get('/admin/users', requireAuth, requireRole('admin'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query(`SELECT id, nombre, email, tipo, created_at FROM users ORDER BY created_at DESC`);
    res.render('admin_users_list', { layout: 'layout', users: rows });
  } finally {
    conn.release();
  }
});

app.get('/admin/users/new', requireAuth, requireRole('admin'), (req, res) => {
  res.render('admin_user_form', { layout: 'layout', mode: 'create', userData: { nombre: '', email: '', tipo: 'user' } });
});

app.post('/admin/users/new', requireAuth, requireRole('admin'), async (req, res) => {
  const { nombre, email, tipo, password } = req.body;
  if (!nombre || !email || !password || !['user','admin'].includes(tipo)) {
    req.session.flash = { type: 'error', msg: 'Datos incompletos' };
    return res.redirect('/admin/users/new');
  }
  const conn = await pool.getConnection();
  try {
    const hash = await bcrypt.hash(password, 10);
    await conn.query(`INSERT INTO users (nombre, email, tipo, clave, password_hash) VALUES (?,?,?,?,?)`, [nombre, email, tipo, null, hash]);
    req.session.flash = { type: 'info', msg: 'Usuario creado' };
    res.redirect('/admin/users');
  } catch (e) {
    req.session.flash = { type: 'error', msg: 'Error creando usuario: ' + e.message };
    res.redirect('/admin/users/new');
  } finally {
    conn.release();
  }
});

app.get('/admin/users/:id/edit', requireAuth, requireRole('admin'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const [row] = await conn.query(`SELECT id, nombre, email, tipo FROM users WHERE id=?`, [req.params.id]);
    if (!row) {
      req.session.flash = { type: 'error', msg: 'Usuario no encontrado' };
      return res.redirect('/admin/users');
    }
    res.render('admin_user_form', { layout: 'layout', mode: 'edit', userData: row });
  } finally {
    conn.release();
  }
});

app.post('/admin/users/:id/edit', requireAuth, requireRole('admin'), async (req, res) => {
  const { nombre, email, tipo, password } = req.body;
  const id = Number(req.params.id);
  if (!nombre || !email || !['user','admin'].includes(tipo)) {
    req.session.flash = { type: 'error', msg: 'Datos incompletos' };
    return res.redirect(`/admin/users/${id}/edit`);
  }
  const conn = await pool.getConnection();
  try {
    if (password && password.trim().length > 0) {
      const hash = await bcrypt.hash(password, 10);
      await conn.query(`UPDATE users SET nombre=?, email=?, tipo=?, password_hash=? WHERE id=?`, [nombre, email, tipo, hash, id]);
    } else {
      await conn.query(`UPDATE users SET nombre=?, email=?, tipo=? WHERE id=?`, [nombre, email, tipo, id]);
    }
    // Si editaste a tu propio usuario, refresca sesiÃ³n mÃ­nima
    if (req.session.user && req.session.user.id === id) {
      req.session.user = { ...req.session.user, nombre, email, tipo };
    }
    req.session.flash = { type: 'info', msg: 'Usuario actualizado' };
    res.redirect('/admin/users');
  } catch (e) {
    req.session.flash = { type: 'error', msg: 'Error actualizando usuario: ' + e.message };
    res.redirect(`/admin/users/${id}/edit`);
  } finally {
    conn.release();
  }
});

app.post('/admin/users/:id/delete', requireAuth, requireRole('admin'), async (req, res) => {
  const id = Number(req.params.id);
  if (req.session.user?.id === id) {
    req.session.flash = { type: 'error', msg: 'No puedes eliminar tu propio usuario' };
    return res.redirect('/admin/users');
  }
  const conn = await pool.getConnection();
  try {
    await conn.query(`DELETE FROM users WHERE id=?`, [id]);
    req.session.flash = { type: 'info', msg: 'Usuario eliminado' };
    res.redirect('/admin/users');
  } catch (e) {
    req.session.flash = { type: 'error', msg: 'Error eliminando usuario: ' + e.message };
    res.redirect('/admin/users');
  } finally {
    conn.release();
  }
});

// 403 view fallback
app.get('/forbidden', (req, res) => res.status(403).render('403', { layout: 'layout' }));

// Start
await ensureUsersTable();
await ensureMovimientosTable();
await ensureAccessLogTables();
await ensureEnviosBoletosTable();
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Web app listening on http://localhost:${PORT}`);
  // Signal PM2 that this process is ready (if running under PM2 with wait_ready)
  if (process.send) {
    process.send('ready');
  }
});
