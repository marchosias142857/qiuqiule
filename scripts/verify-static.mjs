import assert from 'node:assert/strict';
import {readdir, readFile, stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
// GitHub Pages uses its workflow instead of the private Site hosting manifest.
const hostingText = await readFile(path.join(root, '.openai/hosting.json'), 'utf8').catch(error => {
  if (error.code === 'ENOENT') return null;
  throw error;
});
if (hostingText !== null) assert.equal(JSON.parse(hostingText).static.directory, 'build');
async function files(directory, prefix = '') {
  const found = [];
  for (const entry of await readdir(path.join(directory, prefix), {withFileTypes: true})) {
    if (entry.name.startsWith('.')) continue;
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) found.push(...await files(directory, relative));
    else found.push(relative);
  }
  return found.sort();
}
const source = path.join(root, 'dist'), build = path.join(root, 'build');
const inputs = await files(source);
assert.deepEqual(await files(build), inputs, 'Build must include exactly the runtime assets');
let scripts = 0, unchanged = 0;
for (const relative of inputs) {
  const output = path.join(build, relative), bytes = await readFile(output);
  if (relative.endsWith('.js')) {
    const result = spawnSync(process.execPath, ['--check', output], {encoding: 'utf8'});
    assert.equal(result.status, 0, `${relative}: ${result.stderr}`);
    scripts++;
    for (const [, specifier] of bytes.toString().matchAll(/\bfrom\s*["'](\.[^"']+)["']/g)) {
      assert.ok((await stat(path.resolve(path.dirname(output), specifier))).isFile(), `${relative}: ${specifier}`);
    }
  }
  if (!relative.endsWith('.js') || relative.startsWith('vendor/')) {
    assert.deepEqual(bytes, await readFile(path.join(source, relative)), `${relative} must stay byte-identical`);
    unchanged++;
  }
}
console.log(JSON.stringify({runtimeAssets: inputs.length, parsedScripts: scripts, identicalAssets: unchanged}));
