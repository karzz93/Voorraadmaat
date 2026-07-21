const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const MAX_EOCD_SEARCH = 65_535 + 22;
const MAX_SAMSUNG_NOTE_SIZE = 50 * 1024 * 1024;

/**
 * Extracts the editable plain text stored inside a Samsung Notes .sdocx file.
 *
 * Samsung Notes .sdocx files are ZIP containers. The note body is stored in
 * note.note as a binary structure containing one or more UTF-16LE text runs.
 */
export async function extractSamsungNoteText(source) {
  const bytes = await toUint8Array(source);

  if (bytes.byteLength > MAX_SAMSUNG_NOTE_SIZE) {
    throw new Error('Deze Samsung Note is groter dan 50 MB en kan niet veilig worden ingelezen.');
  }

  const noteBytes = await extractZipEntry(bytes, 'note.note');
  const text = extractLongestReadableUtf16Run(noteBytes);

  if (!text) {
    throw new Error('Er is geen leesbare tekst gevonden in deze Samsung Note.');
  }

  return cleanExtractedText(text);
}

async function toUint8Array(source) {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  if (ArrayBuffer.isView(source)) {
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  }
  if (source && typeof source.arrayBuffer === 'function') {
    return new Uint8Array(await source.arrayBuffer());
  }
  throw new TypeError('Ongeldig Samsung Notes-bestand.');
}

async function extractZipEntry(zipBytes, wantedName) {
  const view = new DataView(
    zipBytes.buffer,
    zipBytes.byteOffset,
    zipBytes.byteLength
  );

  const eocdOffset = findEndOfCentralDirectory(view);
  if (eocdOffset < 0) {
    throw new Error('Dit bestand is geen geldige .sdocx/ZIP-container.');
  }

  const entryCount = view.getUint16(eocdOffset + 10, true);
  let centralOffset = view.getUint32(eocdOffset + 16, true);
  const decoder = new TextDecoder('utf-8');

  for (let index = 0; index < entryCount; index += 1) {
    assertRange(view, centralOffset, 46);

    if (view.getUint32(centralOffset, true) !== ZIP_CENTRAL_DIRECTORY_HEADER) {
      throw new Error('De inhoudsopgave van het Samsung Notes-bestand is beschadigd.');
    }

    const flags = view.getUint16(centralOffset + 8, true);
    const compressionMethod = view.getUint16(centralOffset + 10, true);
    const compressedSize = view.getUint32(centralOffset + 20, true);
    const uncompressedSize = view.getUint32(centralOffset + 24, true);
    const fileNameLength = view.getUint16(centralOffset + 28, true);
    const extraLength = view.getUint16(centralOffset + 30, true);
    const commentLength = view.getUint16(centralOffset + 32, true);
    const localHeaderOffset = view.getUint32(centralOffset + 42, true);

    assertRange(view, centralOffset + 46, fileNameLength);

    const fileName = decoder.decode(
      zipBytes.subarray(
        centralOffset + 46,
        centralOffset + 46 + fileNameLength
      )
    );

    if (normalizeZipPath(fileName) === normalizeZipPath(wantedName)) {
      if ((flags & 0x1) !== 0) {
        throw new Error('Versleutelde Samsung Notes-bestanden worden niet ondersteund.');
      }

      return extractLocalEntry({
        view,
        zipBytes,
        localHeaderOffset,
        compressionMethod,
        compressedSize,
        uncompressedSize,
      });
    }

    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  throw new Error('Het bestand note.note ontbreekt in deze Samsung Note.');
}

function findEndOfCentralDirectory(view) {
  const start = Math.max(0, view.byteLength - MAX_EOCD_SEARCH);

  for (let offset = view.byteLength - 22; offset >= start; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_END_OF_CENTRAL_DIRECTORY) {
      return offset;
    }
  }

  return -1;
}

async function extractLocalEntry({
  view,
  zipBytes,
  localHeaderOffset,
  compressionMethod,
  compressedSize,
  uncompressedSize,
}) {
  assertRange(view, localHeaderOffset, 30);

  if (view.getUint32(localHeaderOffset, true) !== ZIP_LOCAL_FILE_HEADER) {
    throw new Error('De Samsung Note bevat een ongeldige bestandsverwijzing.');
  }

  const localNameLength = view.getUint16(localHeaderOffset + 26, true);
  const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
  const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;

  assertRange(view, dataOffset, compressedSize);
  const compressed = zipBytes.slice(dataOffset, dataOffset + compressedSize);

  if (compressionMethod === 0) {
    return compressed;
  }

  if (compressionMethod !== 8) {
    throw new Error(`Niet-ondersteunde ZIP-compressie (${compressionMethod}).`);
  }

  if (typeof DecompressionStream !== 'function') {
    throw new Error(
      'Deze browser kan .sdocx-bestanden niet uitpakken. Gebruik een recente versie van Chrome of Samsung Internet.'
    );
  }

  let output;
  try {
    const stream = new Blob([compressed])
      .stream()
      .pipeThrough(new DecompressionStream('deflate-raw'));
    output = new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    throw new Error('De tekst in het Samsung Notes-bestand kon niet worden uitgepakt.');
  }

  if (uncompressedSize && output.byteLength !== uncompressedSize) {
    throw new Error('De uitgepakte Samsung Note is onvolledig of beschadigd.');
  }

  return output;
}

function extractLongestReadableUtf16Run(bytes) {
  const candidates = [];

  for (const byteOffset of [0, 1]) {
    const alignedLength = bytes.byteLength - byteOffset;
    if (alignedLength < 2) continue;

    const usableLength = alignedLength - (alignedLength % 2);
    const decoded = new TextDecoder('utf-16le').decode(
      bytes.subarray(byteOffset, byteOffset + usableLength)
    );

    candidates.push(...findReadableRuns(decoded));
  }

  return candidates
    .map((text) => ({ text, score: scoreReadableRun(text) }))
    .filter((candidate) => candidate.text.trim().length >= 2)
    .sort((first, second) => second.score - first.score)[0]?.text || '';
}

function findReadableRuns(decoded) {
  const runs = [];
  let current = '';

  for (const character of decoded) {
    if (isReadableCharacter(character)) {
      current += character;
      continue;
    }

    if (current.trim().length >= 12) runs.push(current);
    current = '';
  }

  if (current.trim().length >= 12) runs.push(current);
  return runs;
}

function isReadableCharacter(character) {
  if (character === '\n' || character === '\r' || character === '\t') {
    return true;
  }

  // Letters, combining marks, numbers, punctuation, symbols and normal spaces.
  return /[\p{L}\p{M}\p{N}\p{P}\p{S}\p{Zs}]/u.test(character);
}

function scoreReadableRun(text) {
  const lineCount = (text.match(/\n/g) || []).length;
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const latinCharacters = (text.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) || []).length;

  return text.length + lineCount * 50 + wordCount * 2 + latinCharacters * 0.1;
}

function cleanExtractedText(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000\u000B\u000C\uFFFD]/g, '')
    .split('\n')
    .map((line) => line.replace(/[\t ]+$/g, ''))
    .join('\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function normalizeZipPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

function assertRange(view, offset, length) {
  if (offset < 0 || length < 0 || offset + length > view.byteLength) {
    throw new Error('Het Samsung Notes-bestand is afgekapt of beschadigd.');
  }
}
