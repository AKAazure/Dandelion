'use strict';

function readHeader(headers, name) {
  const target = String(name || '').toLowerCase();
  const source = headers || {};
  const keys = Object.keys(source);

  for (let index = 0; index < keys.length; index += 1) {
    if (String(keys[index]).toLowerCase() === target) {
      return String(source[keys[index]] || '');
    }
  }

  return '';
}

function decodePostData(postData) {
  const raw = String(postData || '');

  if (!raw) {
    return Buffer.alloc(0);
  }

  if (raw.indexOf('------') === 0 || raw.indexOf('--') === 0) {
    return Buffer.from(raw, 'binary');
  }

  try {
    return Buffer.from(raw, 'base64');
  } catch (error) {
    return Buffer.from(raw, 'binary');
  }
}

function extractBoundary(contentType, body) {
  const headerMatch = /boundary=([^;]+)/i.exec(String(contentType || ''));

  if (headerMatch && headerMatch[1]) {
    return headerMatch[1].trim().replace(/^"|"$/g, '');
  }

  const firstLineEnd = body.indexOf(Buffer.from('\r\n', 'latin1'));

  if (firstLineEnd <= 2) {
    return '';
  }

  const firstLine = body.slice(0, firstLineEnd).toString('latin1');

  if (firstLine.indexOf('--') === 0) {
    return firstLine.slice(2);
  }

  return '';
}

function findHeaderEnd(body, offset) {
  return body.indexOf(Buffer.from('\r\n\r\n', 'latin1'), offset);
}

function findFilePart(body, boundary) {
  const boundaryBuffer = Buffer.from('--' + boundary, 'latin1');
  let cursor = 0;

  while (cursor < body.length) {
    const boundaryIndex = body.indexOf(boundaryBuffer, cursor);

    if (boundaryIndex === -1) {
      return null;
    }

    const afterBoundary = boundaryIndex + boundaryBuffer.length;
    const nextTwo = body.slice(afterBoundary, afterBoundary + 2).toString('latin1');

    if (nextTwo === '--') {
      return null;
    }

    let headersStart = afterBoundary;

    if (body.slice(headersStart, headersStart + 2).toString('latin1') === '\r\n') {
      headersStart += 2;
    }

    const headersEnd = findHeaderEnd(body, headersStart);

    if (headersEnd === -1) {
      return null;
    }

    const headersText = body.slice(headersStart, headersEnd).toString('utf8');
    const dataStart = headersEnd + 4;
    const nextBoundary = body.indexOf(Buffer.from('\r\n--' + boundary, 'latin1'), dataStart);

    if (nextBoundary === -1) {
      return null;
    }

    if (
      /content-disposition\s*:\s*form-data/i.test(headersText) &&
      /name="file"/i.test(headersText)
    ) {
      return {
        dataEnd: nextBoundary,
        dataStart: dataStart,
        headersText: headersText,
        originalSize: nextBoundary - dataStart
      };
    }

    cursor = nextBoundary + 2;
  }

  return null;
}

function contentTypeWithBoundary(contentType, boundary) {
  const text = String(contentType || '');

  if (/boundary=/i.test(text)) {
    return text;
  }

  return 'multipart/form-data; boundary=' + boundary;
}

function headersObjectToEntries(headers, contentType) {
  const entries = [];
  const source = headers || {};
  const keys = Object.keys(source);
  let contentTypeWritten = false;

  keys.forEach((key) => {
    const normalized = String(key || '').toLowerCase();

    if (normalized === 'content-length') {
      return;
    }

    if (!key || key[0] === ':') {
      return;
    }

    if (normalized === 'content-type') {
      contentTypeWritten = true;
      entries.push({
        name: key,
        value: contentType
      });
      return;
    }

    entries.push({
      name: key,
      value: String(source[key])
    });
  });

  if (!contentTypeWritten && contentType) {
    entries.push({
      name: 'content-type',
      value: contentType
    });
  }

  return entries;
}

function summarizeReplacement(originalBody, replacementBuffer, filePart, boundary) {
  return {
    boundary: boundary,
    originalBodyBytes: originalBody.length,
    originalFileBytes: filePart ? filePart.originalSize : 0,
    replacementFileBytes: replacementBuffer.length,
    replaced: Boolean(filePart),
    replacementDeltaBytes: filePart ? replacementBuffer.length - filePart.originalSize : 0
  };
}

/**
 * 用 app 侧 webm 替换 ChatGPT transcribe multipart body 里的 file part。
 *
 * @param {object} request CDP Fetch paused request object。
 * @param {object} recording app recording result。
 * @returns {object} replacement decision。
 */
function buildUploadReplacement(request, recording) {
  const currentRequest = request || {};
  const currentRecording = recording || {};
  const originalBody = decodePostData(currentRequest.postData || '');
  const contentType = readHeader(currentRequest.headers, 'content-type');
  const boundary = extractBoundary(contentType, originalBody);

  if (!originalBody.length) {
    return {
      ok: false,
      reason: 'missing_original_post_data'
    };
  }

  if (!boundary) {
    return {
      ok: false,
      reason: 'missing_multipart_boundary'
    };
  }

  if (!currentRecording.ok || !currentRecording.base64) {
    return {
      ok: false,
      reason: currentRecording.error || 'missing_app_recording'
    };
  }

  const replacementBuffer = Buffer.from(String(currentRecording.base64), 'base64');

  if (!replacementBuffer.length) {
    return {
      ok: false,
      reason: 'empty_app_recording'
    };
  }

  const filePart = findFilePart(originalBody, boundary);

  if (!filePart) {
    return {
      ok: false,
      reason: 'file_part_not_found'
    };
  }

  const replacementBody = Buffer.concat([
    originalBody.slice(0, filePart.dataStart),
    replacementBuffer,
    originalBody.slice(filePart.dataEnd)
  ]);
  const nextContentType = contentTypeWithBoundary(contentType, boundary);

  return {
    ok: true,
    body: replacementBody,
    contentType: nextContentType,
    headers: headersObjectToEntries(currentRequest.headers, nextContentType),
    recording: {
      byteLength: replacementBuffer.length,
      chunkCount: Number(currentRecording.chunkCount) || 0,
      durationMs: Number(currentRecording.durationMs) || 0,
      filename: String(currentRecording.filename || 'whisper.webm'),
      id: String(currentRecording.id || ''),
      mimeType: String(currentRecording.mimeType || 'audio/webm'),
      startedAt: String(currentRecording.startedAt || ''),
      stoppedAt: String(currentRecording.stoppedAt || '')
    },
    summary: summarizeReplacement(originalBody, replacementBuffer, filePart, boundary)
  };
}

module.exports = {
  buildUploadReplacement: buildUploadReplacement,
  decodePostData: decodePostData,
  extractBoundary: extractBoundary,
  findFilePart: findFilePart,
  headersObjectToEntries: headersObjectToEntries,
  readHeader: readHeader
};
