'use strict'
/**
 * compressImage(filePath)
 *
 * Compresses and resizes an uploaded image in-place using sharp.
 * - Max width / height: 1920 px (preserves aspect ratio, never upscales)
 * - Output format: JPEG at 82 % quality (converted from any input format)
 * - The original file is replaced with the compressed version
 * - The saved file is always renamed to a .jpg extension
 *
 * Returns the new file path (may differ from input if extension changed).
 */

const path  = require('path')
const fs    = require('fs')
const sharp = require('sharp')

const MAX_DIMENSION = 1920
const JPEG_QUALITY  = 82

async function compressImage(filePath) {
  const dir     = path.dirname(filePath)
  const base    = path.parse(filePath).name
  const outPath = path.join(dir, `${base}.jpg`)

  await sharp(filePath)
    .resize(MAX_DIMENSION, MAX_DIMENSION, {
      fit:                'inside',   // preserves aspect ratio
      withoutEnlargement: true,       // never upscale small images
    })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toFile(outPath)

  // If the original had a different extension, remove it now
  if (outPath !== filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }

  return outPath
}

module.exports = { compressImage }
