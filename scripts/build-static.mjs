// Keep the audited sources readable in dist; deploy a smaller, equivalent copy.
import {cp, mkdir, readdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {minify} from 'terser';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'dist');
const output = path.join(root, 'build');
await rm(output, {recursive: true, force: true});
await mkdir(output, {recursive: true});
let sourceBytes = 0, outputBytes = 0, sourceCodeBytes = 0, outputCodeBytes = 0;
const files = [];
async function build(directory = '') {
  for (const entry of await readdir(path.join(source, directory), {withFileTypes: true})) {
    if (entry.name.startsWith('.')) continue;
    const relative = path.join(directory, entry.name);
    const from = path.join(source, relative), to = path.join(output, relative);
    if (entry.isDirectory()) {
      await mkdir(to, {recursive: true});
      await build(relative);
      continue;
    }
    if (!entry.isFile()) throw new Error(`Unexpected asset: ${relative}`);
    const size = (await stat(from)).size;
    if (relative.endsWith('.js') && !relative.startsWith('vendor/')) {
      const result = await minify(await readFile(from, 'utf8'), {
        // Avoid rewriting expressions or floating-point operations. Name and
        // whitespace compaction alone reduces download/cache storage safely.
        compress: false,
        mangle: true,
        module: relative !== 'sw.js' && relative !== 'offline.js',
        format: {comments: 'some', ascii_only: false},
      });
      if (!result.code) throw new Error(`Empty script: ${relative}`);
      await writeFile(to, result.code + '\n');
      sourceCodeBytes += size;
      outputCodeBytes += (await stat(to)).size;
    } else {
      // Music, fonts, icons, HTML and CSS stay byte-for-byte identical.
      await cp(from, to);
    }
    sourceBytes += size;
    outputBytes += (await stat(to)).size;
    files.push(relative);
  }
}
await build();
console.log(JSON.stringify({files: files.length, sourceBytes, outputBytes,
  savedBytes: sourceBytes - outputBytes, sourceCodeBytes, outputCodeBytes,
  codeReductionPercent: Number((100 * (1 - outputCodeBytes / sourceCodeBytes)).toFixed(2))}));
