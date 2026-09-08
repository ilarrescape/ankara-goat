const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

function provider() {
  return String(process.env.MEDIA_PROVIDER || (process.env.NODE_ENV === 'production' ? 'r2' : 'local')).toLowerCase();
}

function extensionFromMime(mime) {
  return ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' })[mime] || '';
}

async function uploadLocal(buffer, mimeType, userId) {
  const ext = extensionFromMime(mimeType) || '.bin';
  const key = `crest-${userId}-${crypto.randomUUID()}${ext}`;
  const dir = path.join(__dirname, '..', '..', 'public', 'uploads');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, key), buffer);
  return { url: `/uploads/${key}`, key: `local:${key}`, provider: 'local' };
}

function r2Config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  const publicBaseUrl = String(process.env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
    throw new Error('R2 incompleto: configurá R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET y R2_PUBLIC_BASE_URL.');
  }
  return {
    endpoint: process.env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`,
    accessKeyId, secretAccessKey, bucket, publicBaseUrl
  };
}

async function uploadR2(buffer, mimeType, userId) {
  const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
  const cfg = r2Config();
  const ext = extensionFromMime(mimeType) || '.bin';
  const key = `crests/user-${userId}/${crypto.randomUUID()}${ext}`;
  const client = new S3Client({
    region: 'auto',
    endpoint: cfg.endpoint,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }
  });
  await client.send(new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
    CacheControl: 'public,max-age=31536000,immutable'
  }));
  return { url: `${cfg.publicBaseUrl}/${key}`, key: `r2:${key}`, provider: 'r2' };
}

async function uploadCrest(buffer, mimeType, userId) {
  if (!buffer?.length) throw new Error('Archivo vacío.');
  if (!['image/png','image/jpeg','image/webp'].includes(mimeType)) throw new Error('Formato de imagen no permitido.');
  if (provider() === 'r2') return uploadR2(buffer, mimeType, userId);
  return uploadLocal(buffer, mimeType, userId);
}

module.exports = { uploadCrest, provider, r2Config };
