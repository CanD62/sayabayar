// apps/api/src/plugins/minio.js
// MinIO (S3-compatible) plugin for file uploads (KYC documents, etc.)
// Uses @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner

import { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import fp from 'fastify-plugin'

const BUCKET = process.env.MINIO_BUCKET || 'sayabayar'

function createS3Client() {
  const endpoint = process.env.MINIO_ENDPOINT
  if (!endpoint) {
    console.warn('[MinIO] MINIO_ENDPOINT not set — file uploads will be unavailable')
    return null
  }

  return new S3Client({
    endpoint,
    region: process.env.MINIO_REGION || 'us-east-1',
    credentials: {
      accessKeyId:     process.env.MINIO_ACCESS_KEY || 'minioadmin',
      secretAccessKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
    },
    forcePathStyle: true, // Required for MinIO
  })
}

async function ensureBucket(s3) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }))
  } catch {
    console.log(`[MinIO] Bucket "${BUCKET}" not found — creating...`)
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }))
    console.log(`[MinIO] Bucket "${BUCKET}" created`)
  }
}

/**
 * Upload file to MinIO
 * @param {string} key - Object key (e.g. 'kyc/client-id/ktp.jpg')
 * @param {Buffer} buffer - File content
 * @param {string} contentType - MIME type (e.g. 'image/jpeg')
 * @returns {Promise<string>} The object key
 */
async function uploadFile(s3, key, buffer, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }))
  return key
}

/**
 * Get presigned URL for viewing a file (default 1 hour expiry)
 * @param {string} key - Object key
 * @param {number} expiresIn - Seconds until URL expires (default 3600)
 * @returns {Promise<string>} Presigned URL
 */
async function getPresignedViewUrl(s3, key, expiresIn = 3600) {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  })
  return getSignedUrl(s3, command, { expiresIn })
}

async function minioPlugin(fastify) {
  const s3 = createS3Client()

  if (s3) {
    try {
      await ensureBucket(s3)
      console.log(`[MinIO] Connected — bucket: ${BUCKET}`)
    } catch (err) {
      console.error(`[MinIO] Failed to connect: ${err.message}`)
    }
  }

  // Decorate fastify with minio utilities
  fastify.decorate('minio', {
    s3,
    bucket: BUCKET,

    /** Upload a file to MinIO */
    upload: (key, buffer, contentType) => {
      if (!s3) throw new Error('MinIO not configured')
      return uploadFile(s3, key, buffer, contentType)
    },

    /** Get a presigned URL for viewing a file */
    getUrl: (key, expiresIn) => {
      if (!s3) throw new Error('MinIO not configured')
      return getPresignedViewUrl(s3, key, expiresIn)
    },
  })
}

export const minioRegistration = fp(minioPlugin, {
  name: 'minio',
})
