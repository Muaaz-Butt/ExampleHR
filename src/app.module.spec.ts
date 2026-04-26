import { validateEnvironment } from './app.module';

describe('validateEnvironment', () => {
  it('returns the config when HCM_API_BASE_URL is present', () => {
    const config = { HCM_API_BASE_URL: 'http://mock-hcm.local' };

    expect(validateEnvironment(config)).toBe(config);
  });

  it('throws when HCM_API_BASE_URL is missing', () => {
    expect(() => validateEnvironment({} as any)).toThrow(
      'Missing required environment variable: HCM_API_BASE_URL',
    );
  });
});
