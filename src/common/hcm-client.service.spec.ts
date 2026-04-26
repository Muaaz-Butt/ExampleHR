import { HcmClientService, HcmUnavailableException, HcmInsufficientBalanceException } from './hcm-client.service';
import { of, throwError } from 'rxjs';

describe('HcmClientService', () => {
  let service: HcmClientService;
  const mockHttpService = { get: jest.fn(), post: jest.fn() };
  const mockConfigService = { get: jest.fn() };

  beforeEach(() => {
    mockConfigService.get.mockReturnValue('http://localhost:3000');
    service = new HcmClientService(mockHttpService as any, mockConfigService as any);
    mockHttpService.get.mockReset();
    mockHttpService.post.mockReset();
  });

  it('should throw HcmUnavailableException for malformed balance payload', () => {
    expect(() => (service as any).validateBalanceResponse({})).toThrow(HcmUnavailableException);
    expect(() => (service as any).validateBalanceResponse({ employeeId: 'emp1' })).toThrow(
      'Invalid HCM response payload.',
    );
  });

  it('should accept valid balance payload', () => {
    const result = (service as any).validateBalanceResponse({
      employeeId: 'emp1',
      locationId: 'locA',
      availableDays: 3,
    });

    expect(result).toEqual({
      employeeId: 'emp1',
      locationId: 'locA',
      availableDays: 3,
    });
  });

  it('should construct HcmInsufficientBalanceException correctly', () => {
    const error = new HcmInsufficientBalanceException('Test insufficiency');
    expect(error.getStatus()).toBe(400);
    expect(error.message).toBe('Test insufficiency');
  });

  it('should use the default message for HcmInsufficientBalanceException when none is provided', () => {
    const error = new HcmInsufficientBalanceException();
    expect(error.getStatus()).toBe(400);
    expect(error.message).toBe('Insufficient HCM balance.');
  });

  it('should construct HcmUnavailableException correctly', () => {
    const error = new HcmUnavailableException('Test unavailable');
    expect(error.getStatus()).toBe(503);
    expect(error.message).toBe('Test unavailable');
  });

  it('should use the default message for HcmUnavailableException when none is provided', () => {
    const error = new HcmUnavailableException();
    expect(error.getStatus()).toBe(503);
    expect(error.message).toBe('HCM is unavailable.');
  });

  it('pushBatch should return HCM response data on success', async () => {
    mockHttpService.post.mockReturnValue(of({ data: { synced: true } }));
    const result = await service.pushBatch([{ employeeId: 'emp1', locationId: 'locA', availableDays: 5 }]);
    expect(result).toEqual({ synced: true });
  });

  it('fetchBalance should reject with HcmUnavailableException when Axios error response has no message and fallback to error.message', async () => {
    const err: any = new Error('Network failure');
    err.isAxiosError = true;
    err.response = { status: 500, data: {} };
    jest.spyOn(require('axios'), 'isAxiosError').mockReturnValueOnce(true);
    mockHttpService.get.mockReturnValue(throwError(() => err));

    await expect(service.fetchBalance('emp1', 'locA')).rejects.toThrow('Network failure');
  });

  it('handleHcmError should use response data.message for HcmUnavailableException on 500 errors', () => {
    const err: any = new Error('Ignored');
    err.isAxiosError = true;
    err.response = { status: 500, data: { message: 'HCM timeout' } };

    expect(() => (service as any).handleHcmError(err)).toThrow('HCM timeout');
  });

  it('handleHcmError should fallback to error.message when response message is missing', () => {
    const err: any = new Error('Network failure');
    err.isAxiosError = true;
    err.response = { status: 500, data: {} };

    expect(() => (service as any).handleHcmError(err)).toThrow('Network failure');
  });

  it('pushBatch should throw HcmUnavailableException when the HTTP client fails', async () => {
    mockHttpService.post.mockReturnValue(throwError(() => new Error('Network error')));
    await expect(service.pushBatch([{ employeeId: 'emp1', locationId: 'locA', availableDays: 5 }]))
      .rejects.toBeInstanceOf(HcmUnavailableException);
  });
});
