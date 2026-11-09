process.env.TZ = 'Asia/Ho_Chi_Minh';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadEventDefinitions } from '../src/schedule.js';

const read = (name) => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));
const schema = read('events.schema.json');
const eventProps = Object.keys(schema.$defs.event.properties);

for (const file of ['events.example.json', 'events.json']) {
  test(`${file} loads without errors`, () => {
    const raw = read(file);
    const { definitions, errors } = loadEventDefinitions(raw);
    assert.deepEqual(errors, []);
    assert.equal(definitions.length, raw.events.length);
  });

  test(`${file} only uses fields from events.schema.json`, () => {
    for (const event of read(file).events) {
      for (const key of Object.keys(event)) assert.ok(eventProps.includes(key), `unknown field "${key}"`);
    }
  });
}

test('schema repeat values match the code', () => {
  assert.deepEqual(schema.$defs.event.properties.repeat.enum, ['daily', 'weekly', 'monthly']);
});
