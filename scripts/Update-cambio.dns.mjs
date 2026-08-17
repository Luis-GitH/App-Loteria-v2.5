import axios from 'axios';
import dns from 'node:dns/promises';
import dotenv from 'dotenv';
import fs from 'fs-extra';
import path from 'node:path';

const rootDir = path.resolve(process.cwd());
const envPath = path.join(rootDir, '.env_dns');
const cachePath = path.join(rootDir, 'data', 'public-ip.json');
const requestTimeout = 7000;

if (!fs.existsSync(envPath)) {
  throw new Error(`No se encuentra el archivo ${envPath}`);
}

dotenv.config({ path: envPath });

function readConfig() {
  const domain = (process.env.DYN_DOMAIN || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\.$/, '');
  const password = (process.env.DYN_PASSWORD || '').trim();
  const hosts = (process.env.DYN_HOSTS || '@')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);

  const missing = [];
  if (!domain) missing.push('DYN_DOMAIN');
  if (!password) missing.push('DYN_PASSWORD');
  if (!hosts.length) missing.push('DYN_HOSTS');

  if (missing.length) {
    throw new Error(`Faltan variables en .env_dns: ${missing.join(', ')}`);
  }

  if (
    domain.includes('/') ||
    domain.includes(':') ||
    !domain.includes('.') ||
    !/^[a-z0-9.-]+$/.test(domain)
  ) {
    throw new Error(
      'DYN_DOMAIN debe contener solo el dominio base, por ejemplo: ejemplo.com'
    );
  }

  const invalidHost = hosts.find(
    (host) => host !== '@' && !/^(?:[a-z0-9_*-]+\.)*[a-z0-9_*-]+$/.test(host)
  );
  if (invalidHost) {
    throw new Error(`Host no válido en DYN_HOSTS: ${invalidHost}`);
  }

  return { domain, password, hosts: [...new Set(hosts)] };
}

function fqdn(host, domain) {
  return host === '@' ? domain : `${host}.${domain}`;
}

async function fetchPublicIp() {
  const { data } = await axios.get('https://api.ipify.org', {
    params: { format: 'json' },
    timeout: requestTimeout,
  });

  const ip = data?.ip?.trim();
  if (!ip || !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    throw new Error('No se pudo obtener una IP pública IPv4 válida');
  }

  return ip;
}

async function updateHost(ip, host, domain, password) {
  const { data } = await axios.get(
    'https://dynamicdns.park-your-domain.com/update',
    {
      params: { host, domain, password, ip },
      timeout: requestTimeout,
    }
  );

  const body = typeof data === 'string' ? data : JSON.stringify(data);
  if (!body.includes('<ErrCount>0</ErrCount>')) {
    throw new Error(`Namecheap rechazó ${fqdn(host, domain)}: ${body}`);
  }

  return fqdn(host, domain);
}

async function resolveHost(hostname) {
  try {
    return await dns.resolve4(hostname);
  } catch (error) {
    if (
      ['ENOTFOUND', 'ENODATA', 'SERVFAIL', 'ETIMEOUT', 'EREFUSED'].includes(
        error?.code
      )
    ) {
      return [];
    }
    throw error;
  }
}

async function saveCurrentIp(ip, domain, hosts) {
  await fs.ensureDir(path.dirname(cachePath));
  await fs.writeJson(
    cachePath,
    {
      ip,
      domain,
      hosts,
      updatedAt: new Date()
        .toLocaleString('sv-SE', {
          timeZone: 'Europe/Madrid',
          hour12: false,
        })
        .replace(/-/g, '/'),
    },
    { spaces: 2 }
  );
}

async function main() {
  const { domain, password, hosts } = readConfig();
  const ip = await fetchPublicIp();

  console.log(`Dominio configurado: ${domain}`);
  console.log(`IP pública detectada: ${ip}`);
  console.log(
    `Actualizando: ${hosts.map((host) => fqdn(host, domain)).join(', ')}`
  );

  const updates = await Promise.allSettled(
    hosts.map((host) => updateHost(ip, host, domain, password))
  );

  updates
    .filter((result) => result.status === 'fulfilled')
    .forEach((result) =>
      console.log(`Actualizado en Namecheap: ${result.value} -> ${ip}`)
    );

  const errors = updates
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason?.message || String(result.reason));

  if (errors.length) {
    throw new Error(`No se pudieron actualizar todos los dominios: ${errors.join(' | ')}`);
  }

  await saveCurrentIp(ip, domain, hosts);

  const checks = await Promise.all(
    hosts.map(async (host) => {
      const hostname = fqdn(host, domain);
      const ips = await resolveHost(hostname);
      return { hostname, ips, valid: ips.includes(ip) };
    })
  );

  const pending = checks.filter((check) => !check.valid);
  checks
    .filter((check) => check.valid)
    .forEach((check) =>
      console.log(`DNS verificado: ${check.hostname} -> ${ip}`)
    );

  if (pending.length) {
    console.warn(
      `Actualización aceptada, pero queda pendiente la propagación DNS de: ${pending
        .map(({ hostname, ips }) =>
          ips.length ? `${hostname} (ahora: ${ips.join(', ')})` : hostname
        )
        .join(', ')}`
    );
  } else {
    console.log('Todos los dominios están actualizados y verificados.');
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
