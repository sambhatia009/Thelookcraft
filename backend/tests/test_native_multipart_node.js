/**
 * Node.js verification of the native FormData multipart conversion path used by
 * Expo's global fetch (expo/winter). This mirrors the exact logic of
 *   node_modules/expo/src/winter/fetch/convertFormData.ts::convertFormDataAsync
 *
 * Goal: prove that the new upload path (append a File-like object exposing
 * `bytes()`/`name`/`type` — as produced by `new File(uri)` from expo-file-system)
 * generates a valid multipart body containing the filename and content-type
 * that FastAPI's UploadFile requires, AND that the OLD `{uri, name, type}`
 * pattern throws the exact 'Unsupported FormDataPart implementation' error
 * that was observed on Expo Go iPhone.
 *
 * Pure port — no expo/react-native native modules loaded.
 */

'use strict';

function encodeFilename(filename) {
  return encodeURIComponent(String(filename).replace(/\//g, '_'));
}

function getFormDataPartHeaders(part, name) {
  const headers = {
    'content-disposition': `form-data; name="${name}"`,
    'content-type': undefined,
  };
  if (typeof part === 'object' && part !== null) {
    if ('name' in part && typeof part.name === 'string') {
      headers['content-disposition'] += `; filename="${encodeFilename(part.name)}"`;
    }
    if ('type' in part && typeof part.type === 'string') {
      headers['content-type'] = part.type;
    }
  }
  return headers;
}

async function convertFormDataAsync(formData, boundary = '----ExpoFetchFormBoundaryTEST0001') {
  // Same guard as expo/winter — throws if no entries()/getParts()
  if (typeof formData.entries !== 'function') {
    if (typeof formData.getParts === 'function') {
      formData.entries = function () {
        return formData.getParts().map((part) => {
          if (part.string) return part.string;
          if (part.file) return part.file;
          if (part.blob) return part.blob;
        });
      };
    } else {
      throw new Error('Unsupported FormData implementation');
    }
  }
  const entries = formData.entries();
  const results = [];
  for (const [name, entry] of entries) {
    results.push(`--${boundary}\r\n`);
    for (const [k, v] of Object.entries(getFormDataPartHeaders(entry, name))) {
      if (v) results.push(`${k}: ${v}\r\n`);
    }
    results.push(`\r\n`);
    if (typeof entry === 'string') {
      results.push(entry);
    } else if (typeof Blob !== 'undefined' && entry instanceof Blob) {
      results.push(new Uint8Array(await entry.arrayBuffer()));
    } else if (typeof entry === 'object' && entry !== null && 'bytes' in entry) {
      results.push(await entry.bytes());
    } else {
      throw new Error('Unsupported FormDataPart implementation');
    }
    results.push(`\r\n`);
  }
  results.push(`--${boundary}--\r\n`);
  const encoded = results.map((r) =>
    typeof r === 'string' ? new TextEncoder().encode(r) : r
  );
  const total = encoded.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of encoded) { out.set(a, off); off += a.length; }
  return { body: out, boundary };
}

// --------------------------- test harness --------------------------- //
let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  PASS:', msg); passed += 1; }
  else { console.log('  FAIL:', msg); failed += 1; }
}

// Minimal FormData shim matching the shape Expo's convertFormDataAsync consumes
class MockFormData {
  constructor() { this._entries = []; }
  append(name, value) { this._entries.push([name, value]); }
  entries() { return this._entries; }
}

async function testNewNativePath() {
  console.log('\n[TEST 1] NEW native path — File-like { bytes(), name, type }');
  // Mimics `new File(uri)` from expo-file-system on native.
  const mockFile = {
    bytes: async () => new Uint8Array([0xff, 0xd8, 0xff]), // JPEG SOI marker
    name: 'item_1.jpg',
    type: 'image/jpeg',
  };
  const fd = new MockFormData();
  fd.append('file', mockFile);
  const { body, boundary } = await convertFormDataAsync(fd);
  const text = Buffer.from(body).toString('binary');

  assert(text.includes(`--${boundary}\r\n`), 'body starts with boundary marker');
  assert(
    text.includes('content-disposition: form-data; name="file"; filename="item_1.jpg"'),
    'contains content-disposition with name AND filename'
  );
  assert(text.includes('content-type: image/jpeg'), 'contains content-type: image/jpeg');
  // JPEG SOI (FFD8FF) bytes should be present as raw bytes in the body
  const hasBytes = body.includes(0xff) && body.includes(0xd8);
  assert(hasBytes, 'raw file bytes (FF D8 FF) inline in multipart part');
  assert(text.endsWith(`--${boundary}--\r\n`), 'closing boundary present');
}

async function testOldRNLegacyPath() {
  console.log('\n[TEST 2] OLD legacy RN path — { uri, name, type } (should THROW)');
  const oldPart = { uri: 'file:///tmp/item.jpg', name: 'item.jpg', type: 'image/jpeg' };
  const fd = new MockFormData();
  fd.append('file', oldPart);
  let err;
  try { await convertFormDataAsync(fd); }
  catch (e) { err = e; }
  assert(err instanceof Error, 'error thrown');
  assert(
    !!err && /Unsupported FormDataPart implementation/.test(err.message),
    'error message is exactly "Unsupported FormDataPart implementation"'
  );
}

async function testExpoFileSystemFileClassShape() {
  console.log('\n[TEST 3] expo-file-system File class exposes name/type/bytes contract');
  // Static verification via the type declaration files (bytes() is inherited
  // from Blob interface since `class File extends ExpoFileSystem.FileSystemFile implements Blob`).
  const fs = require('fs');
  const path = require('path');
  const fileDts = fs.readFileSync(
    path.resolve(__dirname, '../../frontend/node_modules/expo-file-system/build/File.d.ts'),
    'utf8'
  );
  assert(/class File\b[^{]*\bimplements Blob\b/.test(fileDts), 'File class implements Blob (so bytes() is available)');
  assert(/get name\(\): string/.test(fileDts), 'File exposes `name: string` accessor');
  const nativeTypes = fs.readFileSync(
    path.resolve(__dirname, '../../frontend/node_modules/expo-file-system/build/internal/NativeFileSystem.types.d.ts'),
    'utf8'
  );
  assert(/\btype\s*:\s*string/.test(nativeTypes), 'FileSystemFile base declares `type: string`');
  assert(/\bbytes\s*\(\s*\)\s*:\s*Promise<Uint8Array/.test(nativeTypes), 'FileSystemFile base declares `bytes(): Promise<Uint8Array>`');
}

async function testPkgJsonHasExpoFileSystem() {
  console.log('\n[TEST 4] expo-file-system pinned in package.json and installed');
  const fs = require('fs');
  const path = require('path');
  const pkg = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, '../../frontend/package.json'), 'utf8'));
  assert(!!pkg.dependencies['expo-file-system'], 'expo-file-system in dependencies');
  assert(/57\.0\./.test(pkg.dependencies['expo-file-system']), 'pinned to ~57.0.x');
  const installedPkg = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, '../../frontend/node_modules/expo-file-system/package.json'), 'utf8'));
  assert(/^57\.0\./.test(installedPkg.version), `installed version is 57.0.x (got ${installedPkg.version})`);
}

async function testApiTsUsesExpoFileSystemFile() {
  console.log('\n[TEST 5] api.ts uploadItemImage native branch uses expo-file-system File');
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../frontend/src/api.ts'), 'utf8');
  assert(/require\(["']expo-file-system["']\)/.test(src), 'imports expo-file-system via require (lazy, native-only)');
  assert(/new File\(\s*uri\s*\)/.test(src), 'appends `new File(uri)` (Blob-compatible)');
  assert(!/append\(["']file["']\s*,\s*\{\s*uri\s*[:,]/.test(src), 'no longer appends {uri, name, type} legacy part');
  // require() must be inside the native branch, not top-level (so web bundle doesn't crash)
  const nativeBlock = src.match(/Platform\.OS === ["']web["']\)\s*\{[\s\S]*?\} else \{([\s\S]*?)\}\s*const headers/);
  assert(!!nativeBlock, 'has web/native platform split');
  assert(nativeBlock && /require\(["']expo-file-system["']\)/.test(nativeBlock[1]), 'expo-file-system require is inside native (else) branch only');
}

(async () => {
  console.log('=== Node verification of Expo native multipart conversion ===');
  try { await testNewNativePath(); } catch (e) { console.log('  UNEXPECTED THROW:', e.message); failed += 1; }
  try { await testOldRNLegacyPath(); } catch (e) { console.log('  UNEXPECTED THROW:', e.message); failed += 1; }
  try { await testExpoFileSystemFileClassShape(); } catch (e) { console.log('  UNEXPECTED THROW:', e.message); failed += 1; }
  try { await testPkgJsonHasExpoFileSystem(); } catch (e) { console.log('  UNEXPECTED THROW:', e.message); failed += 1; }
  try { await testApiTsUsesExpoFileSystemFile(); } catch (e) { console.log('  UNEXPECTED THROW:', e.message); failed += 1; }
  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  process.exit(failed === 0 ? 0 : 1);
})();
