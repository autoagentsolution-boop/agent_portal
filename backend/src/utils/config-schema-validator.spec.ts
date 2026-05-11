import { validateConfig, type ConfigSchema } from './config-schema-validator.js';

describe('validateConfig — array type', () => {
  const requiredStringArray: ConfigSchema = {
    labels: {
      type: 'array',
      itemType: 'string',
      label: 'Labels',
      required: true,
      minItems: 1,
      maxItems: 3,
    },
  };

  it('accepts valid string array', () => {
    expect(validateConfig({ labels: ['a', 'b'] }, requiredStringArray)).toEqual([]);
  });

  it('rejects empty array when required (no default)', () => {
    const errors = validateConfig({ labels: [] }, requiredStringArray);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ field: 'labels' });
    expect(errors[0].message).toMatch(/required/i);
  });

  it('rejects non-string items', () => {
    const errors = validateConfig({ labels: [1, 2] }, requiredStringArray);
    expect(errors).toHaveLength(2);
    expect(errors.every((e) => e.field === 'labels')).toBe(true);
    expect(errors[0].message).toMatch(/\[0\] must be a string/);
    expect(errors[1].message).toMatch(/\[1\] must be a string/);
  });

  it('rejects non-array value for array field', () => {
    const errors = validateConfig({ labels: 'x' }, requiredStringArray);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/must be an array/);
  });

  it('enforces maxItems', () => {
    const errors = validateConfig({ labels: ['a', 'b', 'c', 'd'] }, requiredStringArray);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/at most 3/);
  });

  it('enforces minItems separately from required', () => {
    const schema: ConfigSchema = {
      tags: { type: 'array', itemType: 'string', label: 'Tags', required: false, minItems: 2 },
    };
    const errors = validateConfig({ tags: ['only-one'] }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/at least 2/);
  });

  it('accepts number array with itemType=number', () => {
    const schema: ConfigSchema = {
      ports: { type: 'array', itemType: 'number', label: 'Ports', required: true },
    };
    expect(validateConfig({ ports: [80, 443] }, schema)).toEqual([]);
  });

  it('rejects mixed-type number array (string item)', () => {
    const schema: ConfigSchema = {
      ports: { type: 'array', itemType: 'number', label: 'Ports', required: true },
    };
    const errors = validateConfig({ ports: [80, '443'] }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/\[1\] must be a number/);
  });

  it('uses default when value is omitted', () => {
    const schema: ConfigSchema = {
      labels: {
        type: 'array',
        itemType: 'string',
        label: 'Labels',
        required: true,
        default: ['Leads'],
        minItems: 1,
      },
    };
    expect(validateConfig({}, schema)).toEqual([]);
  });

  it('treats empty array as no value (falls back to default if present)', () => {
    const schema: ConfigSchema = {
      labels: {
        type: 'array',
        itemType: 'string',
        label: 'Labels',
        required: true,
        default: ['Leads'],
      },
    };
    expect(validateConfig({ labels: [] }, schema)).toEqual([]);
  });
});
