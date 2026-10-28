import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEBOUNCE_MAX_MS,
  DEBOUNCE_MIN_MS,
  DEFAULT_SETTINGS,
  normalizeSettings,
  VALIDATE_MODES,
  validatesOnSave,
  validatesOnType,
} from '../../../src/shared/settings.ts';

interface ManifestProperty {
  default: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
}
const manifest = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
  contributes: { configuration: { properties: Record<string, ManifestProperty> } };
};
const properties = manifest.contributes.configuration.properties;

describe('shared/settings', () => {
  describe('package.json parity', () => {
    it('declares the same validate modes and default', () => {
      const mode = properties['ieLua.validate.mode'];
      assert.ok(mode);
      assert.deepEqual(mode.enum, [...VALIDATE_MODES]);
      assert.equal(mode.default, DEFAULT_SETTINGS.validate.mode);
    });

    it('declares the same debounce default and bounds', () => {
      const debounce = properties['ieLua.validate.debounce'];
      assert.ok(debounce);
      assert.equal(debounce.default, DEFAULT_SETTINGS.validate.debounce);
      assert.equal(debounce.minimum, DEBOUNCE_MIN_MS);
      assert.equal(debounce.maximum, DEBOUNCE_MAX_MS);
    });
  });

  describe('normalizeSettings', () => {
    it('returns the defaults for missing or malformed input', () => {
      for (const raw of [undefined, null, 42, 'save', {}, { validate: null }, { validate: [] }]) {
        assert.deepEqual(normalizeSettings(raw), DEFAULT_SETTINGS);
      }
    });

    it('keeps valid values', () => {
      assert.deepEqual(normalizeSettings({ validate: { mode: 'saveAndType', debounce: 750 } }), {
        validate: { mode: 'saveAndType', debounce: 750 },
      });
    });

    it('falls back to the default mode for unknown modes', () => {
      assert.equal(normalizeSettings({ validate: { mode: 'onSave' } }).validate.mode, 'save');
    });

    it('clamps and rounds the debounce delay', () => {
      assert.equal(normalizeSettings({ validate: { debounce: -5 } }).validate.debounce, DEBOUNCE_MIN_MS);
      assert.equal(normalizeSettings({ validate: { debounce: 1e9 } }).validate.debounce, DEBOUNCE_MAX_MS);
      assert.equal(normalizeSettings({ validate: { debounce: 12.6 } }).validate.debounce, 13);
      assert.equal(normalizeSettings({ validate: { debounce: Number.NaN } }).validate.debounce, 300);
      assert.equal(normalizeSettings({ validate: { debounce: '100' } }).validate.debounce, 300);
    });
  });

  it('maps each mode to its triggers', () => {
    assert.deepEqual(
      VALIDATE_MODES.map((mode) => [mode, validatesOnSave(mode), validatesOnType(mode)]),
      [
        ['manual', false, false],
        ['save', true, false],
        ['type', false, true],
        ['saveAndType', true, true],
      ],
    );
  });
});
