import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import dotenv from 'dotenv';
import dns from 'node:dns/promises';

dotenv.config();

// Resolver rutas relativo al directorio donde se ejecute el script.
// Evita dependencias de __dirname en ESM.
const rootDir = path.resolve(process.cwd());
const cachePath = path.join(rootDir, 'data', 'public-ip.json');
const requestTimeout = 7000;

function ensureConfig() {
  const hostList = (process.env.DYN_HOSTS || '@')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);

  const config = {
    dyn: {
      hosts: hostList,
      domain: process.env.DYN_DOMAIN,
      password: process.env.DYN_PASSWORD,
    },
  };

  const missing = [];
  if (!config.dyn.domain) missing.push('DYN_DOMAIN');
  if (!config.dyn.password) missing.push('DYN_PASSWORD');
  if (!config.dyn.hosts.length) missing.push('DYN_HOSTS');

  if (missing.length) {
    throw new Error(
      `Faltan variables de entorno: ${missing.join(
        ', '
      )}. Ver README para detalles.`
    );
  }

  return config;
}

async function fetchPublicIp() {
  const { data } = await axios.get('https://api.ipify.org', {
    params: { format: 'json' },
    timeout: requestTimeout,
  });

  if (!data?.ip) {
    throw new Error('No se pudo obtener la IP pública');
  }

  return data.ip.trim();
}

async function readCachedIp() {
  try {
    const raw = await fs.readFile(cachePath, 'utf8');
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw);
    return parsed.ip || null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    console.warn('No se pudo leer la IP previa; se continuará.', error);
    return null;
  }
}

async function writeCachedIp(ip) {
  await fs.ensureDir(path.dirname(cachePath));
  await fs.writeJson(
    cachePath,
    { ip, updatedAt: new Date().toISOString() },
    { spaces: 2 }
  );
}

const resolvableErrors = new Set([
  'ENOTFOUND',
  'ENODATA',
  'SERVFAIL',
  'ETIMEOUT',
  'EREFUSED',
]);

function fqdn(host, domain) {
  return host === '@' ? domain : `${host}.${domain}`;
}

async function resolveHostIps(host, domain) {
  const hostname = fqdn(host, domain);

  try {
    const ips = await dns.resolve4(hostname);
    return { host, hostname, ips };
  } catch (error) {
    if (error && resolvableErrors.has(error.code)) {
      console.warn(
        `Aviso: no se pudo resolver ${hostname} (${error.code}). Se intentará actualizar igualmente.`
      );
      return { host, hostname, ips: [] };
    }
    throw new Error(
      `Fallo inesperado resolviendo ${hostname}: ${error.message || error}`
    );
  }
}

async function classifyDns(currentIp, hosts, domain) {
  const lookups = await Promise.all(
    hosts.map((host) => resolveHostIps(host, domain))
  );

  const alreadyPointing = lookups.filter((r) => r.ips.includes(currentIp));
  const outdated = lookups.filter((r) => !r.ips.includes(currentIp));

  return { lookups, alreadyPointing, outdated };
}

async function updateDynDns(ip, { host, domain, password }) {
  const url = 'https://dynamicdns.park-your-domain.com/update';
  const params = { host, domain, password, ip };
  const { data } = await axios.get(url, { params, timeout: requestTimeout });

  const body = typeof data === 'string' ? data : JSON.stringify(data);
  if (!body.includes('<ErrCount>0</ErrCount>')) {
    throw new Error(
      `DynamicDNS respondió con error o formato desconocido: ${body}`
    );
  }

  return 'DynamicDNS actualizado';
}

async function main() {
  const config = ensureConfig();

  const [currentIp, cachedIp] = await Promise.all([
    fetchPublicIp(),
    readCachedIp(),
  ]);

  console.log(`IP pública detectada: ${currentIp}.`);

  const dnsStatus = await classifyDns(
    currentIp,
    config.dyn.hosts,
    config.dyn.domain
  );

  if (dnsStatus.outdated.length === 0) {
    console.log(
      `DNS ya apunta a la IP actual (${currentIp}) en todos los hosts. No se envía actualización.`
    );
    if (cachedIp !== currentIp) {
      await writeCachedIp(currentIp);
      console.log('IP guardada en caché. Listo.');
    }
    return;
  }

  console.log(
    `Hosts desactualizados: ${dnsStatus.outdated
      .map((r) => r.hostname)
      .join(', ')}`
  );

  if (cachedIp === currentIp) {
    console.log(
      `IP sin cambios (${currentIp}), pero hay hosts desactualizados. Se enviará actualización.`
    );
  } else {
    console.log(
      `IP cambiada: ${cachedIp ?? 'no registrada'} -> ${currentIp}. Enviando actualizaciones...`
    );
  }

  const results = await Promise.allSettled(
    dnsStatus.outdated.map((entry) =>
      updateDynDns(currentIp, {
        host: entry.host,
        domain: config.dyn.domain,
        password: config.dyn.password,
      }).then((msg) => `${msg} (${entry.hostname})`)
    )
  );

  const errors = results
    .filter((r) => r.status === 'rejected')
    .map((r) => r.reason?.message || r.reason);

  results
    .filter((r) => r.status === 'fulfilled')
    .forEach((r) => console.log(r.value));

  if (errors.length) {
    throw new Error(`Fallo al actualizar DNS: ${errors.join(' | ')}`);
  }

  await writeCachedIp(currentIp);
  console.log('IP guardada en caché. Listo.');

  const postDns = await classifyDns(
    currentIp,
    dnsStatus.outdated.map((r) => r.host),
    config.dyn.domain
  );

  if (postDns.outdated.length === 0) {
    console.log(
      `Validación DNS: todos los hosts ya resuelven a ${currentIp}.`
    );
  } else {
    console.warn(
      `Aviso: algunos hosts aún no resuelven a ${currentIp}: ${postDns.outdated
        .map((r) => r.hostname)
        .join(', ')}. Puede deberse a propagación del DNS.`
    );
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
