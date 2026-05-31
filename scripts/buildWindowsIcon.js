'use strict';

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ICON_SIZE = 256;
const ICO_SIZES = [16, 32, 48, 64, 128, 256];
const repoRoot = path.join(__dirname, '..');
const sourcePath = path.join(repoRoot, 'assets', 'logo.png');
const targetPath = path.join(repoRoot, 'assets', 'logo-256.png');
const icoPath = path.join(repoRoot, 'assets', 'logo.ico');

/**
 * 用 nearest-neighbor resize 生成 Windows packaging 需要的 256x256 PNG。
 *
 * 当前 source logo 是 200x200，Electron Builder 的 Windows icon 要求至少
 * 256x256。这个脚本只生成打包资源，不影响运行时 tray icon 使用的原图。
 *
 * @param {PNG} source 源 PNG。
 * @param {number} size 目标宽高。
 * @returns {PNG} resize 后的 PNG。
 */
function resizePngNearest(source, size) {
  const target = new PNG({
    width: size,
    height: size
  });

  for (let y = 0; y < size; y += 1) {
    const sourceY = Math.min(source.height - 1, Math.floor(y * source.height / size));

    for (let x = 0; x < size; x += 1) {
      const sourceX = Math.min(source.width - 1, Math.floor(x * source.width / size));
      const sourceIndex = (sourceY * source.width + sourceX) << 2;
      const targetIndex = (y * size + x) << 2;

      target.data[targetIndex] = source.data[sourceIndex];
      target.data[targetIndex + 1] = source.data[sourceIndex + 1];
      target.data[targetIndex + 2] = source.data[sourceIndex + 2];
      target.data[targetIndex + 3] = source.data[sourceIndex + 3];
    }
  }

  return target;
}

function writeUInt16LE(buffer, value, offset) {
  buffer.writeUInt16LE(value, offset);
}

function writeUInt32LE(buffer, value, offset) {
  buffer.writeUInt32LE(value, offset);
}

/**
 * 从 PNG buffers 构造 ICO 文件内容。
 *
 * ICO directory 支持直接嵌入 PNG image data。这里生成多尺寸 icon，供
 * Windows Explorer 和 electron-builder 写入 exe resource 使用。
 *
 * @param {Array<{size:number,buffer:Buffer}>} images PNG 图片列表。
 * @returns {Buffer} ICO 文件内容。
 */
function buildIcoBuffer(images) {
  const headerSize = 6;
  const directorySize = 16 * images.length;
  const header = Buffer.alloc(headerSize + directorySize);
  let offset = headerSize + directorySize;

  writeUInt16LE(header, 0, 0);
  writeUInt16LE(header, 1, 2);
  writeUInt16LE(header, images.length, 4);

  images.forEach((image, index) => {
    const entryOffset = headerSize + (index * 16);
    const sizeByte = image.size >= 256 ? 0 : image.size;

    header[entryOffset] = sizeByte;
    header[entryOffset + 1] = sizeByte;
    header[entryOffset + 2] = 0;
    header[entryOffset + 3] = 0;
    writeUInt16LE(header, 1, entryOffset + 4);
    writeUInt16LE(header, 32, entryOffset + 6);
    writeUInt32LE(header, image.buffer.length, entryOffset + 8);
    writeUInt32LE(header, offset, entryOffset + 12);
    offset += image.buffer.length;
  });

  return Buffer.concat([header].concat(images.map((image) => image.buffer)));
}

/**
 * 生成 Windows packaging icon 文件。
 *
 * @returns {void}
 */
function main() {
  const source = PNG.sync.read(fs.readFileSync(sourcePath));
  const target = resizePngNearest(source, ICON_SIZE);
  const icoImages = ICO_SIZES.map((size) => {
    return {
      buffer: PNG.sync.write(resizePngNearest(source, size)),
      size: size
    };
  });

  fs.writeFileSync(targetPath, PNG.sync.write(target));
  fs.writeFileSync(icoPath, buildIcoBuffer(icoImages));
  process.stdout.write('generated ' + path.relative(repoRoot, targetPath) + '\n');
  process.stdout.write('generated ' + path.relative(repoRoot, icoPath) + '\n');
}

if (require.main === module) {
  main();
}

module.exports = {
  buildIcoBuffer: buildIcoBuffer,
  ICON_SIZE: ICON_SIZE,
  ICO_SIZES: ICO_SIZES,
  resizePngNearest: resizePngNearest
};
