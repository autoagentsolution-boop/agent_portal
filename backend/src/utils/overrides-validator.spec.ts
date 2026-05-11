import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { validateAndMergeOverrides } from './overrides-validator.js';
import type { ConfigSchema } from './config-schema-validator.js';

const baseSchema: ConfigSchema = {
  threshold: { type: 'number', label: 'Threshold', required: true, default: 70, min: 0, max: 100 },
  notify: { type: 'boolean', label: 'Notify', required: false, default: false },
  channel: {
    type: 'string',
    label: 'Channel',
    required: true,
    default: 'general',
    enum: ['general', 'alerts', 'reports'],
  },
};

const baseConfig = { threshold: 70, notify: false, channel: 'general' };
const overridable = ['threshold', 'notify'];

describe('validateAndMergeOverrides', () => {
  it('returns base config + null snapshot when overrides absent', () => {
    const result = validateAndMergeOverrides(undefined, baseConfig, overridable, baseSchema);
    expect(result.snapshot).toBeNull();
    expect(result.effective).toEqual(baseConfig);
  });

  it('returns base config + null snapshot when overrides empty', () => {
    const result = validateAndMergeOverrides({}, baseConfig, overridable, baseSchema);
    expect(result.snapshot).toBeNull();
    expect(result.effective).toEqual(baseConfig);
  });

  it('merges valid overrides and returns snapshot', () => {
    const result = validateAndMergeOverrides(
      { threshold: 85 },
      baseConfig,
      overridable,
      baseSchema,
    );
    expect(result.snapshot).toEqual({ threshold: 85 });
    expect(result.effective).toEqual({ threshold: 85, notify: false, channel: 'general' });
  });

  it('rejects keys not in overridable whitelist', () => {
    expect.assertions(2);
    try {
      validateAndMergeOverrides({ channel: 'alerts' }, baseConfig, overridable, baseSchema);
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as BadRequestException).getResponse()).toMatchObject({
        invalid_keys: ['channel'],
      });
    }
  });

  it('rejects overrides exceeding 16KB', () => {
    const huge = { threshold: 'x'.repeat(20_000) };
    expect(() =>
      validateAndMergeOverrides(huge, baseConfig, overridable, baseSchema),
    ).toThrow(PayloadTooLargeException);
  });

  it('rejects overrides producing schema-invalid effective config', () => {
    expect.assertions(2);
    try {
      validateAndMergeOverrides(
        { threshold: 200 },
        baseConfig,
        overridable,
        baseSchema,
      );
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      const body = (e as BadRequestException).getResponse() as { details: Array<{ field: string }> };
      expect(body.details.some((d) => d.field === 'threshold')).toBe(true);
    }
  });
});
