'use strict';

const assert = require('assert');

const {
  buildUploadReplacement,
  decodePostData,
  extractBoundary,
  findFilePart,
  headersObjectToEntries,
  readHeader
} = require('../src/main/chatgptUploadReplacement');

function buildMultipart(boundary, fileBuffer) {
  return Buffer.concat([
    Buffer.from(
      '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="file"; filename="whisper.webm"\r\n' +
      'Content-Type: audio/webm;codecs=opus\r\n' +
      '\r\n',
      'utf8'
    ),
    fileBuffer,
    Buffer.from(
      '\r\n--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="model"\r\n' +
      '\r\n' +
      'whisper-1' +
      '\r\n--' + boundary + '--\r\n',
      'utf8'
    )
  ]);
}

async function run() {
  const boundary = '----WebKitFormBoundaryTest';
  const originalFile = Buffer.from('original-webm');
  const replacementFile = Buffer.from('replacement-webm-is-longer');
  const originalBody = buildMultipart(boundary, originalFile);
  const contentType = 'multipart/form-data; boundary=' + boundary;

  assert.strictEqual(readHeader({
    'Content-Type': contentType
  }, 'content-type'), contentType);
  assert.strictEqual(decodePostData(originalBody.toString('base64')).equals(originalBody), true);
  assert.strictEqual(extractBoundary(contentType, originalBody), boundary);
  assert.strictEqual(findFilePart(originalBody, boundary).originalSize, originalFile.length);

  const replacement = buildUploadReplacement({
    headers: {
      Authorization: 'Bearer test',
      'Content-Length': String(originalBody.length),
      'Content-Type': contentType
    },
    postData: originalBody.toString('base64')
  }, {
    base64: replacementFile.toString('base64'),
    byteLength: replacementFile.length,
    chunkCount: 2,
    durationMs: 1234,
    id: 'app-recording-1',
    mimeType: 'audio/webm;codecs=opus',
    ok: true
  });

  assert.strictEqual(replacement.ok, true);
  assert.strictEqual(replacement.body.indexOf(replacementFile) !== -1, true);
  assert.strictEqual(replacement.body.indexOf(originalFile), -1);
  assert.strictEqual(replacement.summary.originalFileBytes, originalFile.length);
  assert.strictEqual(replacement.summary.replacementFileBytes, replacementFile.length);
  assert.strictEqual(replacement.recording.id, 'app-recording-1');

  const headerNames = replacement.headers.map((entry) => entry.name.toLowerCase());
  assert.strictEqual(headerNames.indexOf('content-length'), -1);
  assert.strictEqual(headerNames.indexOf('authorization') !== -1, true);
  assert.strictEqual(
    replacement.headers.some((entry) => entry.name.toLowerCase() === 'content-type' && entry.value === contentType),
    true
  );

  assert.deepStrictEqual(headersObjectToEntries({
    ':authority': 'chatgpt.com',
    'Content-Length': '10',
    'Content-Type': contentType,
    Cookie: 'a=b'
  }, contentType), [
    {
      name: 'Content-Type',
      value: contentType
    },
    {
      name: 'Cookie',
      value: 'a=b'
    }
  ]);

  assert.strictEqual(buildUploadReplacement({
    headers: {},
    postData: ''
  }, {
    ok: true
  }).reason, 'missing_original_post_data');
}

module.exports = {
  run: run
};
