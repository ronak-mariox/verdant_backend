import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { HttpError } from './httpError';

const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'application/pdf': '.pdf',
};

const IMAGE_MIME = Object.keys(EXT_BY_MIME).filter((m) => m.startsWith('image/'));
const DOCUMENT_MIME = Object.keys(EXT_BY_MIME);

function makeUploader(allowed: string[], label: string) {
  const allowedSet = new Set(allowed);
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
      // Extension comes from the validated mimetype, never from the client's filename.
      filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${EXT_BY_MIME[file.mimetype] ?? ''}`),
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!allowedSet.has(file.mimetype)) {
        cb(new HttpError(400, `Unsupported file type — only ${label} are allowed`));
        return;
      }
      cb(null, true);
    },
  });
}

export const upload = makeUploader(DOCUMENT_MIME, 'JPEG/PNG/WEBP/HEIC images or PDF documents');
export const uploadImage = makeUploader(IMAGE_MIME, 'JPEG/PNG/WEBP/HEIC images');

export function publicUrlFor(filename: string): string {
  return `/uploads/${filename}`;
}

export { UPLOAD_DIR };
