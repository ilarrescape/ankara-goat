const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

function provider() {
  return String(process.env.MEDIA_PROVIDER || (process.env.NODE_ENV === 'production' ? 'r2' : 'local')).toLowerCase();
}

function extensionFromMime(mime) {
  return ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' })[mime] || '';
}

async function uploadLocal(buffer, mimeType, userId, category = 'crest') {
  const ext = extensionFromMime(mimeType) || '.bin';
  const key = `${category}-${userId}-${crypto.randomUUID()}${ext}`;
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

async function uploadR2(buffer, mimeType, userId, category = 'crest') {
  const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
  const cfg = r2Config();
  const ext = extensionFromMime(mimeType) || '.bin';
  const key = `${category === 'crest' ? 'crests' : category}/user-${userId}/${crypto.randomUUID()}${ext}`;
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

function hasImageSignature(buffer,mime){
  if(!Buffer.isBuffer(buffer))return false;
  if(mime==='image/png')return buffer.length>=8&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if(mime==='image/jpeg')return buffer.length>=3&&buffer[0]===255&&buffer[1]===216&&buffer[2]===255;
  if(mime==='image/webp')return buffer.length>=12&&buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP';
  return false;
}
async function uploadIllustration(buffer,mimeType,userId,category){
  if(!['questions','trophies','tournament-banners'].includes(category))throw new Error('Tipo de recurso inválido.');
  if(!buffer?.length||buffer.length>2*1024*1024)throw new Error('La imagen debe pesar entre 1 byte y 2 MB.');
  if(!hasImageSignature(buffer,mimeType))throw new Error('Se admite únicamente PNG, JPG o WebP válido.');
  return provider()==='r2'?uploadR2(buffer,mimeType,userId,category):uploadLocal(buffer,mimeType,userId,category);
}
function safeImageUrl(value){
  const url=String(value||'').trim();
  if(!url)return null;
  if(url.length>1000||(!/^https:\/\/[^\s<>"']+$/i.test(url)&&!/^\/uploads\/[a-zA-Z0-9_.-]+$/.test(url)))throw new Error('Imagen: utilizá una URL HTTPS válida o subí una imagen.');
  return url;
}
function normalizeQuestionMedia(value){
  if(value==null)return null;
  if(typeof value!=='object'||Array.isArray(value))throw new Error('Imágenes de pregunta inválidas.');
  const source=Array.isArray(value.optionImageUrls)?value.optionImageUrls:[];
  if(source.length>4)throw new Error('Sólo se admiten imágenes para cuatro respuestas.');
  const itemImages={};
  if(value.itemImageUrls!=null){
    if(typeof value.itemImageUrls!=='object'||Array.isArray(value.itemImageUrls))throw new Error('Imágenes de elementos inválidas.');
    const keys=Object.keys(value.itemImageUrls);if(keys.length>30)throw new Error('Demasiadas imágenes de elementos.');
    for(const key of keys){if(key.length>160)throw new Error('Nombre de elemento demasiado largo.');const url=safeImageUrl(value.itemImageUrls[key]);if(url)itemImages[key]=url;}
  }
  const data={promptImageUrl:safeImageUrl(value.promptImageUrl),optionImageUrls:Array.from({length:4},(_,i)=>safeImageUrl(source[i])),itemImageUrls:itemImages};
  return data.promptImageUrl||data.optionImageUrls.some(Boolean)||Object.keys(data.itemImageUrls).length?data:null;
}
module.exports = { uploadCrest, uploadIllustration, normalizeQuestionMedia, safeImageUrl, provider, r2Config };
