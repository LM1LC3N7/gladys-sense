// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACTIONS, SESSION_KEY } from '../src/constants.js';
import { DEFAULTS } from '../src/config.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const index = read('index.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) {
      yield* texts(item, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.match(manifest.gladys_version, />=5\.2\.0/, 'publishEnergyConsumption needs Gladys 5.2');
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-sense:${manifest.version}`);
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.deepEqual(manifest.categories, ['energy']);
  assert.deepEqual(manifest.transports, ['cloud']);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
  }
  assert.match(manifest.description.en, /Unofficial/);
  assert.match(manifest.description.fr, /Non officiel/);
});

test('every text is bilingual', () => {
  for (const [path, text] of texts(manifest)) {
    assert.ok(text.en?.trim() && text.fr?.trim(), `${path} needs en and fr`);
  }
});

test('the configuration matches the code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  assert.equal(fields.email.type, 'string');
  assert.equal(fields.password.type, 'secret');
  assert.equal(fields.password.default, undefined);
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.equal(fields[key].default, value, `${key} default`);
  }
  assert.equal(fields.appliances.default, false, 'the detected devices are an option');
  assert.equal(fields[SESSION_KEY], undefined, 'the session stays outside the schema');
  const section = fields.intro;
  assert.equal(section.type, 'section');
  assert.equal(section.default, undefined);
  assert.equal(section.required, undefined);
  for (const link of section.links) {
    assert.match(link.url, /^https:\/\//);
  }
});

test('the actions of the manifest are the actions of the code', () => {
  assert.deepEqual(
    manifest.actions.map((a) => a.key),
    Object.values(ACTIONS),
  );
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(index.includes(`onAction(ACTIONS.${name}`), name);
  }
  const mfa = manifest.actions.find((a) => a.key === ACTIONS.MFA);
  assert.deepEqual(
    mfa.fields.map((f) => [f.key, f.type, f.required]),
    [['code', 'string', true]],
  );
  for (const action of manifest.actions) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120);
  }
});

test('no capability the code does not serve', () => {
  for (const key of ['scene_triggers', 'scene_actions', 'widgets', 'energy_contracts']) {
    assert.equal(manifest[key], undefined, key);
  }
});
