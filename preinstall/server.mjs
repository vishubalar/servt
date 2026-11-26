#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT_DIR = path.resolve(__dirname, '..');

const MAX_BODY_BYTES = 16 * 1024 * 1024; // 16 MB JSON payload limit for multiple base64 logos
const MAX_ASSET_BYTES = 2 * 1024 * 1024; // 2 MB decoded per image asset

const EXT_BY_MIME = {
  'image/svg+xml': 'svg',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
};

const MIME_BY_EXT = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const ASSET_SLOTS = {
  logoLight: { suffix: 'horizontal-light', field: 'logo', envKey: 'BRANDING_LOGO' },
  logoDark: { suffix: 'horizontal-dark', field: 'logo_dark', envKey: 'BRANDING_LOGO_DARK' },
  iconLight: { suffix: 'mark-light', field: 'icon', envKey: 'BRANDING_ICON' },
  iconDark: { suffix: 'mark-dark', field: 'icon_dark', envKey: 'BRANDING_ICON_DARK' },
  faviconSvg: { suffix: 'favicon', field: 'favicon', envKey: 'BRANDING_FAVICON' },
  faviconPng: { suffix: 'favicon-32', isLayoutFallback: true },
  faviconIco: { isBackendIco: true },
};

function parseCliArgs(argv) {
  const opts = {
    port: process.env.PORT !== undefined ? Number(process.env.PORT) : 3456,
    host: process.env.HOST || '127.0.0.1',
    rootDir: process.env.PREINSTALL_ROOT ? path.resolve(process.env.PREINSTALL_ROOT) : DEFAULT_ROOT_DIR,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--port=')) {
      opts.port = Number(arg.slice('--port='.length));
    } else if (arg === '--port' && argv[i + 1] !== undefined) {
      opts.port = Number(argv[++i]);
    } else if (arg.startsWith('--host=')) {
      opts.host = arg.slice('--host='.length);
    } else if (arg === '--host' && argv[i + 1] !== undefined) {
      opts.host = argv[++i];
    } else if (arg.startsWith('--root=')) {
      opts.rootDir = path.resolve(arg.slice('--root='.length));
    } else if (arg === '--root' && argv[i + 1] !== undefined) {
      opts.rootDir = path.resolve(argv[++i]);
    }
  }

  if (!Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535) {
    throw new Error(`Invalid port: ${opts.port}`);
  }
  if (!opts.host || /[\s\r\n]/.test(opts.host)) {
    throw new Error(`Invalid host: ${opts.host}`);
  }
  return opts;
}

function readLf(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

function writeLf(filePath, content) {
  const normalized = content.replace(/\r\n/g, '\n');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, normalized, 'utf8');
}

function unescapePhpSingle(str) {
  return str.replace(/\\(['\\])/g, '$1');
}

function phpSingleQuote(str) {
  return `'${str.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function formatEnvValue(val) {
  if (val === '') return '';
  if (/[\s#"'`$\\]/.test(val)) {
    return `"${val.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$')}"`;
  }
  return val;
}

function unquoteEnvValue(raw) {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\$/g, '$')
      .replace(/\\\\/g, '\\');
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function slugifyBrand(name) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'brand';
}

function extractBrandingPhp(content) {
  const out = {};
  const nameMatch = content.match(
    /^[ \t]*'name'\s*=>\s*(?:trim\(\(string\)\s*env\('BRANDING_NAME'\)\)\s*\?:\s*|env\('BRANDING_NAME'\s*,\s*)'((?:\\.|[^'\\])*)'/m
  );
  if (nameMatch) out.name = unescapePhpSingle(nameMatch[1]);

  const keyMap = [
    ['logo', 'BRANDING_LOGO'],
    ['logo_dark', 'BRANDING_LOGO_DARK'],
    ['icon', 'BRANDING_ICON'],
    ['icon_dark', 'BRANDING_ICON_DARK'],
    ['favicon', 'BRANDING_FAVICON'],
    ['primary_color', 'BRANDING_PRIMARY_COLOR'],
  ];

  for (const [key, envKey] of keyMap) {
    const re = new RegExp(`^[ \\t]*'${key}'\\s*=>\\s*env\\('${envKey}'\\s*,\\s*'((?:\\\\.|[^'\\\\])*)'`, 'm');
    const m = content.match(re);
    if (m) out[key] = unescapePhpSingle(m[1]);
  }
  return out;
}

function extractMergeBrandingJs(content) {
  const out = {};
  const blockMatch = content.match(/export\s+const\s+DEFAULT_BRANDING\s*=\s*\{([\s\S]*?)\n\};/);
  if (!blockMatch) return out;

  const block = blockMatch[1];
  for (const key of ['name', 'logo', 'logo_dark', 'icon', 'icon_dark', 'favicon', 'primary_color']) {
    const re = new RegExp(`^[ \\t]*${key}:\\s*(?:"((?:\\\\.|[^"\\\\])*)"|'((?:\\\\.|[^'\\\\])*)')`, 'm');
    const m = block.match(re);
    if (m) {
      if (m[1] !== undefined) {
        try {
          out[key] = JSON.parse(`"${m[1]}"`);
        } catch {
          out[key] = m[1];
        }
      } else if (m[2] !== undefined) {
        out[key] = unescapePhpSingle(m[2]);
      }
    }
  }
  return out;
}

function extractEnvVar(content, key) {
  const re = new RegExp(`^[ \\t]*${key}=(.*)$`, 'm');
  const m = content.match(re);
  return m ? unquoteEnvValue(m[1]) : undefined;
}

function readCurrentConfig(rootDir) {
  const paths = {
    brandingPhp: path.join(rootDir, 'backend/config/branding.php'),
    brandColorPhp: path.join(rootDir, 'backend/app/Support/BrandColor.php'),
    mergeBrandingJs: path.join(rootDir, 'frontend/lib/branding/merge-branding.js'),
    layoutJsx: path.join(rootDir, 'frontend/app/layout.jsx'),
    panelUpdatePhp: path.join(rootDir, 'backend/config/panel_update.php'),
    centralPhp: path.join(rootDir, 'backend/config/central.php'),
    installSh: path.join(rootDir, 'install.sh'),
    envExample: path.join(rootDir, 'backend/.env.example'),
    dotEnv: path.join(rootDir, 'backend/.env'),
  };

  const phpValues = fs.existsSync(paths.brandingPhp) ? extractBrandingPhp(readLf(paths.brandingPhp)) : {};
  const jsValues = fs.existsSync(paths.mergeBrandingJs) ? extractMergeBrandingJs(readLf(paths.mergeBrandingJs)) : {};

  let defaultColorFromClass;
  if (fs.existsSync(paths.brandColorPhp)) {
    const m = readLf(paths.brandColorPhp).match(/public\s+const\s+DEFAULT\s*=\s*'((?:\\.|[^'\\])*)'\s*;/);
    if (m) defaultColorFromClass = unescapePhpSingle(m[1]);
  }

  let faviconPng = '/brand/panel-favicon-32.png';
  if (fs.existsSync(paths.layoutJsx)) {
    const m = readLf(paths.layoutJsx).match(/\{\s*url:\s*(?:"([^"]+)"|'([^']+)')\s*,\s*sizes:\s*"32x32"/);
    if (m) faviconPng = m[1] || m[2];
  }

  let releasesUrl = '';
  if (fs.existsSync(paths.panelUpdatePhp)) {
    const m = readLf(paths.panelUpdatePhp).match(
      /'releases_url'\s*=>\s*env\(\s*'PANEL_RELEASES_URL'\s*,\s*'((?:\\.|[^'\\])*)'/
    );
    if (m) releasesUrl = unescapePhpSingle(m[1]);
  }

  let repoUrl = '';
  if (fs.existsSync(paths.installSh)) {
    const m = readLf(paths.installSh).match(/^[ \t]*REPO_URL="\$\{REPO_URL:-([^}]+)\}"/m);
    if (m) repoUrl = m[1].trim();
  }

  let centralUrl = '';
  if (fs.existsSync(paths.centralPhp)) {
    const m = readLf(paths.centralPhp).match(/'url'\s*=>\s*rtrim\(\(string\)\s*env\('CENTRAL_URL'\s*,\s*'((?:\\.|[^'\\])*)'/);
    if (m) centralUrl = unescapePhpSingle(m[1]);
  }

  let appUrl = 'http://localhost';
  let contactEmail = '';
  if (fs.existsSync(paths.envExample)) {
    const envEx = readLf(paths.envExample);
    appUrl = extractEnvVar(envEx, 'APP_URL') ?? appUrl;
    contactEmail = extractEnvVar(envEx, 'MAIL_FROM_ADDRESS') ?? contactEmail;
  }

  const hasEnv = fs.existsSync(paths.dotEnv);
  if (hasEnv) {
    const envLive = readLf(paths.dotEnv);
    appUrl = extractEnvVar(envLive, 'APP_URL') || appUrl;
    contactEmail = extractEnvVar(envLive, 'MAIL_FROM_ADDRESS') || contactEmail;
    const liveCentral = extractEnvVar(envLive, 'CENTRAL_URL');
    if (liveCentral !== undefined) centralUrl = liveCentral;
  }

  return {
    name: phpValues.name || jsValues.name || 'Control Panel',
    primary_color: phpValues.primary_color || defaultColorFromClass || jsValues.primary_color || '#3B82F6',
    repo_url: repoUrl,
    releases_url: releasesUrl,
    central_url: centralUrl,
    app_url: appUrl,
    contact_email: contactEmail,
    has_env: hasEnv,
    assets: {
      logo: phpValues.logo || jsValues.logo || '/brand/panel-horizontal-light.svg',
      logo_dark: phpValues.logo_dark || jsValues.logo_dark || '/brand/panel-horizontal-dark.svg',
      icon: phpValues.icon || jsValues.icon || '/brand/panel-mark-light.svg',
      icon_dark: phpValues.icon_dark || jsValues.icon_dark || '/brand/panel-mark-dark.svg',
      favicon: phpValues.favicon || jsValues.favicon || '/brand/panel-favicon.svg',
      favicon_png: faviconPng,
    },
  };
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 400;
  }
}

function hasControlCharsOrScript(value) {
  return /[\x00-\x1f\x7f]/.test(value) || /<\/?script\b/i.test(value);
}

function validateHttpUrl(value, fieldName) {
  if (hasControlCharsOrScript(value) || /['"\s]/.test(value) || value.length > 300) {
    throw new ValidationError(`${fieldName} contains invalid characters or exceeds 300 chars.`);
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new ValidationError(`${fieldName} must be a valid URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ValidationError(`${fieldName} must use http:// or https://.`);
  }
  return value;
}

function validateRepoUrl(value) {
  if (hasControlCharsOrScript(value) || /['"`$;{}\s]/.test(value) || value.length > 300) {
    throw new ValidationError('repoUrl contains invalid characters or exceeds 300 chars.');
  }
  const urlMatch = /^(https?|ssh|git):\/\/\S+$/i.test(value);
  const scpMatch = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:\S+$/.test(value);
  if (!urlMatch && !scpMatch) {
    throw new ValidationError('repoUrl must be a valid git URL (https://, ssh://, git://, or user@host:path).');
  }
  return value;
}

function deriveGitHubReleasesUrl(repoUrl) {
  const match = repoUrl.match(
    /^(?:https?:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/i
  );
  if (!match) return null;
  return `https://api.github.com/repos/${match[1]}/${match[2]}/releases/latest`;
}

function validateEmail(value) {
  if (hasControlCharsOrScript(value) || value.length > 120) {
    throw new ValidationError('contactEmail contains invalid characters or exceeds 120 chars.');
  }
  if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(value)) {
    throw new ValidationError('contactEmail must be a valid email address.');
  }
  return value;
}

function sanitizeAndDecodeAsset(slotKey, assetObj) {
  if (!assetObj || typeof assetObj !== 'object') {
    throw new ValidationError(`${slotKey} must be an object with { filename, dataUrl }.`);
  }
  const { dataUrl } = assetObj;
  if (typeof dataUrl !== 'string') {
    throw new ValidationError(`${slotKey}.dataUrl must be a string.`);
  }

  const match = dataUrl.match(/^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)(?:;charset=[^;,]+)?;base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) {
    throw new ValidationError(`${slotKey}.dataUrl must be a valid base64 image data URL.`);
  }

  const mime = match[1].toLowerCase();
  const ext = EXT_BY_MIME[mime];
  if (!ext) {
    throw new ValidationError(`${slotKey} has unsupported mime type: ${mime}`);
  }

  const b64 = match[2].replace(/\s+/g, '');
  if (!b64 || b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
    throw new ValidationError(`${slotKey} contains invalid base64 data.`);
  }

  const buffer = Buffer.from(b64, 'base64');
  if (buffer.length === 0) {
    throw new ValidationError(`${slotKey} image payload is empty.`);
  }
  if (buffer.length > MAX_ASSET_BYTES) {
    throw new ValidationError(`${slotKey} exceeds maximum size of 2 MB.`);
  }

  if (mime === 'image/svg+xml') {
    const svgText = buffer.toString('utf8');
    if (svgText.includes('\0') || !/<svg\b/i.test(svgText)) {
      throw new ValidationError(`${slotKey} is not a valid SVG document.`);
    }
    if (
      /<script\b/i.test(svgText) ||
      /<\/script/i.test(svgText) ||
      /(?:^|[\s/])on[a-z]{2,}\s*=/i.test(svgText) ||
      /javascript\s*:/i.test(svgText) ||
      /<foreignObject\b/i.test(svgText) ||
      /<!ENTITY\b/i.test(svgText)
    ) {
      throw new ValidationError(`${slotKey} SVG rejected: contains disallowed script or event handler markup.`);
    }
    return { mime, ext, buffer: Buffer.from(svgText.replace(/\r\n/g, '\n'), 'utf8') };
  }

  if (mime === 'image/png') {
    const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (buffer.length < 8 || !buffer.subarray(0, 8).equals(pngSig)) {
      throw new ValidationError(`${slotKey} is not a valid PNG file.`);
    }
  } else if (mime === 'image/jpeg') {
    if (buffer.length < 3 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
      throw new ValidationError(`${slotKey} is not a valid JPEG file.`);
    }
  } else if (mime === 'image/webp') {
    if (
      buffer.length < 12 ||
      buffer.subarray(0, 4).toString('ascii') !== 'RIFF' ||
      buffer.subarray(8, 12).toString('ascii') !== 'WEBP'
    ) {
      throw new ValidationError(`${slotKey} is not a valid WebP file.`);
    }
  } else if (mime === 'image/x-icon' || mime === 'image/vnd.microsoft.icon') {
    const isIco = buffer.length >= 4 && buffer[0] === 0x00 && buffer[1] === 0x00 && (buffer[2] === 0x01 || buffer[2] === 0x02) && buffer[3] === 0x00;
    const isPngIco = buffer.length >= 8 && buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    if (!isIco && !isPngIco) {
      throw new ValidationError(`${slotKey} is not a valid ICO file.`);
    }
  }

  return { mime, ext, buffer };
}

function validateApplyPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ValidationError('Request body must be a JSON object.');
  }

  if (typeof payload.brandName !== 'string') {
    throw new ValidationError('brandName is required and must be a string.');
  }
  const brandName = payload.brandName.trim();
  if (!brandName) {
    throw new ValidationError('brandName must not be empty.');
  }
  if (brandName.length > 80) {
    throw new ValidationError('brandName must be 80 characters or fewer.');
  }
  if (hasControlCharsOrScript(brandName)) {
    throw new ValidationError('brandName contains disallowed control characters or script tags.');
  }

  if (typeof payload.primaryColor !== 'string') {
    throw new ValidationError('primaryColor is required and must be a hex color string.');
  }
  const primaryColor = payload.primaryColor.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(primaryColor)) {
    throw new ValidationError('primaryColor must match #RRGGBB (e.g. #35B87A).');
  }

  const out = {
    brandName,
    primaryColor,
    repoUrl: undefined,
    releasesUrl: undefined,
    centralUrl: undefined,
    contactEmail: undefined,
    appUrl: undefined,
    assets: {},
  };

  if (typeof payload.repoUrl === 'string' && payload.repoUrl.trim() !== '') {
    out.repoUrl = validateRepoUrl(payload.repoUrl.trim());
  }
  if (typeof payload.releasesUrl === 'string' && payload.releasesUrl.trim() !== '') {
    out.releasesUrl = validateHttpUrl(payload.releasesUrl.trim(), 'releasesUrl');
  } else if (out.repoUrl) {
    const derived = deriveGitHubReleasesUrl(out.repoUrl);
    if (derived) out.releasesUrl = derived;
  }
  if (payload.centralUrl !== undefined && payload.centralUrl !== null) {
    if (typeof payload.centralUrl !== 'string') {
      throw new ValidationError('centralUrl must be a string.');
    }
    const trimmed = payload.centralUrl.trim();
    out.centralUrl = trimmed === '' ? '' : validateHttpUrl(trimmed, 'centralUrl').replace(/\/+$/, '');
  }
  if (typeof payload.contactEmail === 'string' && payload.contactEmail.trim() !== '') {
    out.contactEmail = validateEmail(payload.contactEmail.trim());
  }
  if (typeof payload.appUrl === 'string' && payload.appUrl.trim() !== '') {
    out.appUrl = validateHttpUrl(payload.appUrl.trim(), 'appUrl').replace(/\/+$/, '');
  }

  for (const slotKey of Object.keys(ASSET_SLOTS)) {
    if (payload[slotKey] !== undefined && payload[slotKey] !== null) {
      out.assets[slotKey] = sanitizeAndDecodeAsset(slotKey, payload[slotKey]);
    }
  }

  return out;
}

function updateBrandingPhp(content, values) {
  let updated = content;
  const nameVal = phpSingleQuote(values.name);

  if (/^[ \t]*'name'\s*=>\s*trim\(\(string\)\s*env\('BRANDING_NAME'\)\)\s*\?:\s*'(?:\\.|[^'\\])*',/m.test(updated)) {
    updated = updated.replace(
      /^([ \t]*'name'\s*=>\s*trim\(\(string\)\s*env\('BRANDING_NAME'\)\)\s*\?:\s*)'(?:\\.|[^'\\])*'(,)/m,
      (_, p1, p2) => `${p1}${nameVal}${p2}`
    );
  } else {
    updated = updated.replace(
      /^([ \t]*'name'\s*=>\s*env\('BRANDING_NAME'\s*,\s*)'(?:\\.|[^'\\])*'(\),)/m,
      (_, p1, p2) => `${p1}${nameVal}${p2}`
    );
  }

  const pairs = [
    ['logo', 'BRANDING_LOGO', values.logo],
    ['logo_dark', 'BRANDING_LOGO_DARK', values.logo_dark],
    ['icon', 'BRANDING_ICON', values.icon],
    ['icon_dark', 'BRANDING_ICON_DARK', values.icon_dark],
    ['favicon', 'BRANDING_FAVICON', values.favicon],
    ['primary_color', 'BRANDING_PRIMARY_COLOR', values.primary_color],
  ];

  for (const [key, envKey, val] of pairs) {
    const re = new RegExp(`^([ \\t]*'${key}'\\s*=>\\s*env\\('${envKey}'\\s*,\\s*)'(?:\\\\.|[^'\\\\])*'(\\),)`, 'm');
    updated = updated.replace(re, (_, p1, p2) => `${p1}${phpSingleQuote(val)}${p2}`);
  }

  return updated;
}

function updateBrandColorPhp(content, primaryColor) {
  return content.replace(
    /^([ \t]*public\s+const\s+DEFAULT\s*=\s*)'(?:\\.|[^'\\])*'(\s*;)/m,
    (_, p1, p2) => `${p1}${phpSingleQuote(primaryColor)}${p2}`
  );
}

function updateMergeBrandingJs(content, values) {
  return content.replace(/(export\s+const\s+DEFAULT_BRANDING\s*=\s*\{[\s\S]*?\n\};)/, (block) => {
    let next = block;
    for (const key of ['name', 'logo', 'logo_dark', 'icon', 'icon_dark', 'favicon', 'primary_color']) {
      const re = new RegExp(`^([ \\t]*${key}:\\s*)(?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*')(,?)`, 'm');
      next = next.replace(re, (_, p1, p2) => `${p1}${JSON.stringify(values[key])}${p2}`);
    }
    return next;
  });
}

function updateLayoutJsx(content, { faviconMime, faviconPngPath, faviconPngMime }) {
  let updated = content;
  if (faviconMime) {
    updated = updated.replace(
      /(\{\s*url:\s*branding\.favicon,\s*type:\s*)"[^"]*"(\s*\})/,
      (_, p1, p2) => `${p1}${JSON.stringify(faviconMime)}${p2}`
    );
  }
  if (faviconPngPath) {
    updated = updated.replace(
      /(\{\s*url:\s*)(?:"[^"]*"|'[^']*')(\s*,\s*sizes:\s*"32x32",\s*type:\s*)"[^"]*"(\s*\})/,
      (_, p1, p2, p3) => `${p1}${JSON.stringify(faviconPngPath)}${p2}${JSON.stringify(faviconPngMime || 'image/png')}${p3}`
    );
  }
  return updated;
}

function setEnvLine(content, key, value, { keepCommentedIfCommented = false } = {}) {
  const formatted = formatEnvValue(value);
  const uncommentedRe = new RegExp(`^([ \\t]*${key}=).*$`, 'm');
  const commentedRe = new RegExp(`^([ \\t]*#[ \\t]*)(${key}=).*$`, 'm');

  if (uncommentedRe.test(content)) {
    return content.replace(uncommentedRe, (_, p1) => `${p1}${formatted}`);
  }
  if (commentedRe.test(content)) {
    return content.replace(commentedRe, (_, prefix, eq) =>
      keepCommentedIfCommented ? `${prefix}${eq}${formatted}` : `${eq}${formatted}`
    );
  }
  const suffix = content.endsWith('\n') || content === '' ? '' : '\n';
  return `${content}${suffix}${key}=${formatted}\n`;
}

function updateEnvExample(content, values, extras) {
  let updated = content;
  updated = setEnvLine(updated, 'APP_NAME', values.name);
  if (extras.appUrl && extractEnvVar(updated, 'APP_URL') !== extras.appUrl) {
    updated = setEnvLine(updated, 'APP_URL', extras.appUrl);
  }
  if (extras.contactEmail && extractEnvVar(updated, 'MAIL_FROM_ADDRESS') !== extras.contactEmail) {
    updated = setEnvLine(updated, 'MAIL_FROM_ADDRESS', extras.contactEmail);
  }

  const brandingEntries = [
    ['BRANDING_NAME', values.name],
    ['BRANDING_LOGO', values.logo],
    ['BRANDING_LOGO_DARK', values.logo_dark],
    ['BRANDING_ICON', values.icon],
    ['BRANDING_ICON_DARK', values.icon_dark],
    ['BRANDING_FAVICON', values.favicon],
    ['BRANDING_PRIMARY_COLOR', values.primary_color],
  ];

  for (const [key, val] of brandingEntries) {
    updated = setEnvLine(updated, key, val, { keepCommentedIfCommented: true });
  }
  if (extras.releasesUrl && /^#?\s*PANEL_RELEASES_URL=/m.test(updated)) {
    updated = setEnvLine(updated, 'PANEL_RELEASES_URL', extras.releasesUrl, { keepCommentedIfCommented: true });
  }
  if (extras.centralUrl !== undefined && /^#?\s*CENTRAL_URL=/m.test(updated)) {
    updated = setEnvLine(updated, 'CENTRAL_URL', extras.centralUrl, { keepCommentedIfCommented: true });
  }
  return updated;
}

function updateDotEnv(content, values, extras) {
  let updated = content;
  updated = setEnvLine(updated, 'APP_NAME', values.name);
  updated = setEnvLine(updated, 'BRANDING_NAME', values.name);
  updated = setEnvLine(updated, 'BRANDING_LOGO', values.logo);
  updated = setEnvLine(updated, 'BRANDING_LOGO_DARK', values.logo_dark);
  updated = setEnvLine(updated, 'BRANDING_ICON', values.icon);
  updated = setEnvLine(updated, 'BRANDING_ICON_DARK', values.icon_dark);
  updated = setEnvLine(updated, 'BRANDING_FAVICON', values.favicon);
  updated = setEnvLine(updated, 'BRANDING_PRIMARY_COLOR', values.primary_color);

  if (extras.appUrl) {
    updated = setEnvLine(updated, 'APP_URL', extras.appUrl);
  }
  if (extras.contactEmail) {
    updated = setEnvLine(updated, 'MAIL_FROM_ADDRESS', extras.contactEmail);
  }
  if (extras.centralUrl !== undefined) {
    updated = setEnvLine(updated, 'CENTRAL_URL', extras.centralUrl);
  }
  if (extras.releasesUrl && /^#?\s*PANEL_RELEASES_URL=/m.test(updated)) {
    updated = setEnvLine(updated, 'PANEL_RELEASES_URL', extras.releasesUrl);
  }
  return updated;
}

function updateInstallSh(content, repoUrl) {
  return content.replace(
    /^([ \t]*REPO_URL="\$\{REPO_URL:-)[^}]+(\}")/m,
    (_, p1, p2) => `${p1}${repoUrl}${p2}`
  );
}

function updatePanelUpdatePhp(content, releasesUrl) {
  return content.replace(
    /^([ \t]*'releases_url'\s*=>\s*env\(\s*'PANEL_RELEASES_URL'\s*,\s*)'(?:\\.|[^'\\])*'(\s*,?\s*\)\s*,)/m,
    (_, p1, p2) => `${p1}${phpSingleQuote(releasesUrl)}${p2}`
  );
}

function updateCentralPhp(content, centralUrl) {
  return content.replace(
    /^([ \t]*'url'\s*=>\s*rtrim\(\(string\)\s*env\('CENTRAL_URL'\s*,\s*)'(?:\\.|[^'\\])*'(\s*\)\s*,\s*'\/'\s*\)\s*,)/m,
    (_, p1, p2) => `${p1}${phpSingleQuote(centralUrl)}${p2}`
  );
}

function replaceTestBlock(content, testHeaderRegex, replacer) {
  return content.replace(testHeaderRegex, (block) => replacer(block));
}

function updateBrandingTestPhp(content, values) {
  let updated = content;

  const setPaths = (block, keys) => {
    let next = block;
    for (const key of keys) {
      const re = new RegExp(`(->assertJsonPath\\('branding\\.${key}',\\s*)'(?:\\\\.|[^'\\\\])*'(\\))`);
      next = next.replace(re, (_, p1, p2) => `${p1}${phpSingleQuote(values[key])}${p2}`);
    }
    return next;
  };

  updated = replaceTestBlock(
    updated,
    /it\('returns the default branding info without authentication'[\s\S]*?\n\}\);/,
    (b) => setPaths(b, ['name', 'logo', 'logo_dark', 'icon', 'icon_dark', 'favicon', 'primary_color'])
  );

  updated = replaceTestBlock(
    updated,
    /    it\('keeps the panel\\'s own value wherever Central has none'[\s\S]*?\n    \}\);/,
    (b) => setPaths(b, ['logo', 'logo_dark', 'favicon'])
  );

  updated = replaceTestBlock(
    updated,
    /    it\('refuses a link or colour that is not one'[\s\S]*?\n    \}\);/,
    (b) => setPaths(b, ['name', 'logo', 'favicon', 'primary_color'])
  );

  updated = replaceTestBlock(
    updated,
    /    it\('falls back to the panel\\'s branding when Central is down, and does not ask on every load'[\s\S]*?\n    \}\);/,
    (b) => setPaths(b, ['name'])
  );

  return updated;
}

function updateBrandPagesTestPhp(content, primaryColor) {
  return content.replace(
    /(expect\(renderSitePage\(\)\)->toContain\('--accent:\s*)#[0-9a-fA-F]{6}(;'\))/,
    (_, p1, p2) => `${p1}${primaryColor}${p2}`
  );
}

function updateBrandingTestMjs(content, values, faviconPngPath) {
  let updated = content;

  updated = replaceTestBlock(
    updated,
    /test\("the live payload shape still resolves to real branding"[\s\S]*?\n\}\);/,
    (block) => {
      let next = block;
      for (const key of ['name', 'logo', 'logo_dark', 'icon', 'icon_dark', 'favicon', 'primary_color']) {
        const re = new RegExp(`^([ \\t]*${key}:\\s*)(?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*')(,?)`, 'm');
        next = next.replace(re, (_, p1, p2) => `${p1}${JSON.stringify(values[key])}${p2}`);
      }
      return next;
    }
  );

  if (faviconPngPath) {
    updated = replaceTestBlock(
      updated,
      /test\("every default logo is a file the panel ships"[\s\S]*?\n\}\);/,
      (block) =>
        block.replace(
          /(assert\.ok\(fs\.existsSync\(new URL\("..\/public)(\/brand\/[^"]+)("\s*,\s*import\.meta\.url\)\)\);)/,
          (_, p1, _oldPath, p3) => `${p1}${faviconPngPath}${p3}`
        )
    );
  }

  return updated;
}

function applyBrandingToRepo(rootDir, input) {
  const current = readCurrentConfig(rootDir);
  const slug = slugifyBrand(input.brandName);
  const brandDir = path.join(rootDir, 'frontend/public/brand');
  const savedAssets = [];
  const updatedFiles = [];

  const nextAssets = { ...current.assets };
  let faviconMime;
  let faviconPngMime;
  let faviconPngUpdated = false;

  for (const [slotKey, decoded] of Object.entries(input.assets)) {
    const spec = ASSET_SLOTS[slotKey];
    if (spec.isBackendIco) {
      const targetPath = path.join(rootDir, 'backend/public/favicon.ico');
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, decoded.buffer);
      savedAssets.push('backend/public/favicon.ico');
      updatedFiles.push('backend/public/favicon.ico');
      continue;
    }

    const filename = `${slug}-${spec.suffix}.${decoded.ext}`;
    const targetPath = path.join(brandDir, filename);
    fs.mkdirSync(brandDir, { recursive: true });
    fs.writeFileSync(targetPath, decoded.buffer);
    const webPath = `/brand/${filename}`;
    savedAssets.push(webPath);

    if (spec.isLayoutFallback) {
      nextAssets.favicon_png = webPath;
      faviconPngMime = decoded.mime;
      faviconPngUpdated = true;
    } else {
      nextAssets[spec.field] = webPath;
      if (slotKey === 'faviconSvg') {
        faviconMime = decoded.mime;
      }
    }
  }

  const nextValues = {
    name: input.brandName,
    logo: nextAssets.logo,
    logo_dark: nextAssets.logo_dark,
    icon: nextAssets.icon,
    icon_dark: nextAssets.icon_dark,
    favicon: nextAssets.favicon,
    primary_color: input.primaryColor,
  };

  const applyEdit = (relPath, transform) => {
    const absPath = path.join(rootDir, relPath);
    if (!fs.existsSync(absPath)) return;
    const before = readLf(absPath);
    const after = transform(before);
    if (after !== before) {
      writeLf(absPath, after);
      updatedFiles.push(relPath);
    }
  };

  applyEdit('backend/config/branding.php', (c) => updateBrandingPhp(c, nextValues));
  applyEdit('backend/app/Support/BrandColor.php', (c) => updateBrandColorPhp(c, nextValues.primary_color));
  applyEdit('frontend/lib/branding/merge-branding.js', (c) => updateMergeBrandingJs(c, nextValues));

  if (faviconMime || faviconPngUpdated) {
    applyEdit('frontend/app/layout.jsx', (c) =>
      updateLayoutJsx(c, {
        faviconMime,
        faviconPngPath: faviconPngUpdated ? nextAssets.favicon_png : undefined,
        faviconPngMime,
      })
    );
  }

  applyEdit('backend/.env.example', (c) =>
    updateEnvExample(c, nextValues, {
      appUrl: input.appUrl,
      contactEmail: input.contactEmail,
      releasesUrl: input.releasesUrl,
      centralUrl: input.centralUrl,
    })
  );

  if (fs.existsSync(path.join(rootDir, 'backend/.env'))) {
    applyEdit('backend/.env', (c) =>
      updateDotEnv(c, nextValues, {
        appUrl: input.appUrl,
        contactEmail: input.contactEmail,
        centralUrl: input.centralUrl,
        releasesUrl: input.releasesUrl,
      })
    );
  }

  if (input.repoUrl) {
    applyEdit('install.sh', (c) => updateInstallSh(c, input.repoUrl));
  }
  if (input.releasesUrl) {
    applyEdit('backend/config/panel_update.php', (c) => updatePanelUpdatePhp(c, input.releasesUrl));
  }
  if (input.centralUrl !== undefined) {
    applyEdit('backend/config/central.php', (c) => updateCentralPhp(c, input.centralUrl));
  }

  applyEdit('backend/tests/Feature/BrandingTest.php', (c) => updateBrandingTestPhp(c, nextValues));
  applyEdit('backend/tests/Feature/BrandPagesTest.php', (c) => updateBrandPagesTestPhp(c, nextValues.primary_color));
  applyEdit('frontend/tests/branding.test.mjs', (c) =>
    updateBrandingTestMjs(c, nextValues, faviconPngUpdated ? nextAssets.favicon_png : undefined)
  );

  return {
    ok: true,
    updatedFiles,
    savedAssets,
    current: readCurrentConfig(rootDir),
  };
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const contentLength = Number(req.headers['content-length']);
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      const err = new Error('Request body too large (max 16 MB).');
      err.statusCode = 413;
      reject(err);
      req.resume();
      return;
    }

    const chunks = [];
    let totalBytes = 0;
    let settled = false;

    req.on('data', (chunk) => {
      if (settled) return;
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        settled = true;
        const err = new Error('Request body too large (max 16 MB).');
        err.statusCode = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) {
        reject(new ValidationError('Empty JSON body.'));
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new ValidationError('Malformed JSON body.'));
      }
    });

    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

function handleBrandAsset(rootDir, rawSegment, res) {
  let decoded;
  try {
    decoded = decodeURIComponent(rawSegment);
  } catch {
    sendJson(res, 400, { error: 'Invalid asset path encoding.' });
    return;
  }

  if (!decoded || decoded.includes('\0') || decoded.includes('/') || decoded.includes('\\') || decoded === '.' || decoded === '..') {
    sendJson(res, 400, { error: 'Invalid asset filename.' });
    return;
  }

  const ext = path.extname(decoded).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) {
    sendJson(res, 404, { error: 'Asset not found.' });
    return;
  }

  const brandDir = path.join(rootDir, 'frontend/public/brand');
  const candidate = path.resolve(brandDir, decoded);
  if (!candidate.startsWith(brandDir + path.sep) || !fs.existsSync(candidate)) {
    sendJson(res, 404, { error: 'Asset not found.' });
    return;
  }

  const realBrandDir = fs.realpathSync(brandDir);
  const realCandidate = fs.realpathSync(candidate);
  if (!realCandidate.startsWith(realBrandDir + path.sep)) {
    sendJson(res, 403, { error: 'Forbidden.' });
    return;
  }

  const stat = fs.statSync(realCandidate);
  if (!stat.isFile()) {
    sendJson(res, 404, { error: 'Asset not found.' });
    return;
  }

  const headers = {
    'Content-Type': mime,
    'Content-Length': stat.size,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (mime === 'image/svg+xml') {
    headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'";
  }
  res.writeHead(200, headers);
  fs.createReadStream(realCandidate).pipe(res);
}

export function createPreinstallServer({ rootDir = DEFAULT_ROOT_DIR, uiPath = path.join(__dirname, 'index.html') } = {}) {
  return http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    } catch {
      sendJson(res, 400, { error: 'Invalid request URL.' });
      return;
    }

    const { pathname } = url;

    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      try {
        const html = fs.readFileSync(uiPath, 'utf8');
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(html);
      } catch (err) {
        sendJson(res, 500, { error: `Failed to load UI: ${err.message}` });
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/api/current') {
      try {
        sendJson(res, 200, readCurrentConfig(rootDir));
      } catch (err) {
        sendJson(res, 500, { error: `Failed to read current config: ${err.message}` });
      }
      return;
    }

    if (req.method === 'GET' && pathname.startsWith('/brand/')) {
      handleBrandAsset(rootDir, pathname.slice('/brand/'.length), res);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/apply') {
      try {
        const body = await readJsonBody(req);
        const validated = validateApplyPayload(body);
        const result = applyBrandingToRepo(rootDir, validated);
        sendJson(res, 200, result);
      } catch (err) {
        const status = err.statusCode || 500;
        sendJson(res, status, { error: err.message || 'Internal server error.' });
      }
      return;
    }

    if (pathname === '/api/apply' || pathname === '/api/current') {
      sendJson(res, 405, { error: 'Method not allowed.' });
      return;
    }

    sendJson(res, 404, { error: 'Not found.' });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const opts = parseCliArgs(process.argv.slice(2));
  const server = createPreinstallServer({ rootDir: opts.rootDir });

  server.listen(opts.port, opts.host, () => {
    const addr = server.address();
    const displayHost = opts.host === '0.0.0.0' ? '127.0.0.1' : opts.host;
    console.log('');
    console.log('  White-Label Pre-Install Configurator');
    console.log(`  Local URL:  http://${displayHost}:${addr.port}`);
    if (opts.host === '0.0.0.0') {
      console.log(`  Bound on:   0.0.0.0:${addr.port}`);
    }
    console.log(`  Repo Root:  ${opts.rootDir}`);
    console.log('  Press Ctrl+C to stop.');
    console.log('');
  });
}
