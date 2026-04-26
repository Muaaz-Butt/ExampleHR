import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TimeOffService } from './time-off.service';
import { TimeOffRequest, RequestStatus } from './entities/time-off-request.entity';
import { Balance } from './entities/balance.entity';
import {
  HcmClientService,
  HcmUnavailableException,
  HcmInsufficientBalanceException,
} from '../common/hcm-client.service';

// ─── Shared mock factories ────────────────────────────────────────────────────

const makeMockBalanceRepo = () => ({
  findOneBy: jest.fn(),
  save: jest.fn(),
  upsert: jest.fn(),
  find: jest.fn(),
});

const makeMockRequestRepo = () => ({
  findOneBy: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
});

const makeMockHcmClient = () => ({
  fetchBalance: jest.fn(),
  fileTimeOff: jest.fn(),
  pushBatch: jest.fn(),
});

// ─── HcmClientService unit tests ─────────────────────────────────────────────

describe('HcmClientService', () => {
  let hcmClient: HcmClientService;
  const mockHttpService = { get: jest.fn(), post: jest.fn() };
  const mockConfigService = { get: jest.fn() };

  beforeEach(async () => {
    mockConfigService.get.mockReturnValue('http://mock-hcm.local');

    const { HttpService } = await import('@nestjs/axios');
    const { ConfigService } = await import('@nestjs/config');

    const module = await Test.createTestingModule({
      providers: [
        HcmClientService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    hcmClient = module.get<HcmClientService>(HcmClientService);

    mockHttpService.get.mockReset();
    mockHttpService.post.mockReset();
  });

  // Helper: wrap a value in an Observable-compatible object
  const asObservable = (data: unknown) => ({
    pipe: jest.fn(),
    subscribe: jest.fn(),
    // firstValueFrom calls .then on this
    then: undefined,
  });

  // Helper: make firstValueFrom resolve with given data
  const mockGet = (data: unknown) => {
    const { of } = require('rxjs');
    mockHttpService.get.mockReturnValue(of({ data }));
  };

  const mockPost = (data: unknown) => {
    const { of } = require('rxjs');
    mockHttpService.post.mockReturnValue(of({ data }));
  };

  const mockGetError = (error: unknown) => {
    const { throwError } = require('rxjs');
    mockHttpService.get.mockReturnValue(throwError(() => error));
  };

  const mockPostError = (error: unknown) => {
    const { throwError } = require('rxjs');
    mockHttpService.post.mockReturnValue(throwError(() => error));
  };

  // ── fetchBalance ──────────────────────────────────────────────────────────

  it('fetchBalance — returns valid HCM response', async () => {
    mockGet({ employeeId: 'emp1', locationId: 'locA', availableDays: 10 });
    const result = await hcmClient.fetchBalance('emp1', 'locA');
    expect(result.availableDays).toBe(10);
  });

  it('fetchBalance — throws HcmUnavailableException when response is missing fields', async () => {
    mockGet({ employeeId: 'emp1' }); // missing locationId and availableDays
    await expect(hcmClient.fetchBalance('emp1', 'locA')).rejects.toBeInstanceOf(HcmUnavailableException);
  });

  it('fetchBalance — throws HcmUnavailableException when availableDays is not a finite number', async () => {
    mockGet({ employeeId: 'emp1', locationId: 'locA', availableDays: Infinity });
    await expect(hcmClient.fetchBalance('emp1', 'locA')).rejects.toBeInstanceOf(HcmUnavailableException);
  });

  it('fetchBalance — throws HcmUnavailableException on network error', async () => {
    const axiosError = { isAxiosError: true, response: undefined, message: 'ECONNREFUSED' };
    const { AxiosError } = await import('axios');
    // simulate isAxiosError returning true
    jest.spyOn(require('axios'), 'isAxiosError').mockReturnValueOnce(false);
    mockGetError(new Error('network down'));
    await expect(hcmClient.fetchBalance('emp1', 'locA')).rejects.toBeInstanceOf(HcmUnavailableException);
  });

  it('fetchBalance — throws HcmUnavailableException on 5xx HCM response', async () => {
    const err: any = new Error('Server Error');
    err.isAxiosError = true;
    err.response = { status: 500, data: { message: 'Internal Server Error' } };
    jest.spyOn(require('axios'), 'isAxiosError').mockReturnValueOnce(true);
    mockGetError(err);
    await expect(hcmClient.fetchBalance('emp1', 'locA')).rejects.toBeInstanceOf(HcmUnavailableException);
  });

  it('fetchBalance — throws HcmInsufficientBalanceException on 400 HCM response', async () => {
    const err: any = new Error('Bad Request');
    err.isAxiosError = true;
    err.response = { status: 400, data: { message: 'Insufficient balance' } };
    jest.spyOn(require('axios'), 'isAxiosError').mockReturnValueOnce(true);
    mockGetError(err);
    await expect(hcmClient.fetchBalance('emp1', 'locA')).rejects.toBeInstanceOf(HcmInsufficientBalanceException);
  });

  // ── fileTimeOff ───────────────────────────────────────────────────────────

  it('fileTimeOff — returns valid response with updated balance', async () => {
    mockPost({ employeeId: 'emp1', locationId: 'locA', availableDays: 8 });
    const result = await hcmClient.fileTimeOff('emp1', 'locA', 2);
    expect(result.availableDays).toBe(8);
  });

  it('fileTimeOff — throws HcmInsufficientBalanceException when HCM returns negative availableDays', async () => {
    // This covers line 59 — the defensive negative balance check inside fileTimeOff
    mockPost({ employeeId: 'emp1', locationId: 'locA', availableDays: -1 });
    await expect(hcmClient.fileTimeOff('emp1', 'locA', 2)).rejects.toBeInstanceOf(HcmInsufficientBalanceException);
  });

  it('fileTimeOff — throws HcmInsufficientBalanceException on HCM 400 error', async () => {
    // Covers lines 63-64 — handleHcmError called from fileTimeOff catch block
    const err: any = new Error('Insufficient balance');
    err.isAxiosError = true;
    err.response = { status: 400, data: { message: 'Insufficient HCM balance' } };
    jest.spyOn(require('axios'), 'isAxiosError').mockReturnValueOnce(true);
    mockPostError(err);
    await expect(hcmClient.fileTimeOff('emp1', 'locA', 2)).rejects.toBeInstanceOf(HcmInsufficientBalanceException);
  });

  it('fileTimeOff — throws HcmInsufficientBalanceException on HCM 409 conflict', async () => {
    // Covers line 99 — the status === 409 branch in handleHcmError
    const err: any = new Error('Conflict');
    err.isAxiosError = true;
    err.response = { status: 409, data: { message: 'Conflict' } };
    jest.spyOn(require('axios'), 'isAxiosError').mockReturnValueOnce(true);
    mockPostError(err);
    await expect(hcmClient.fileTimeOff('emp1', 'locA', 2)).rejects.toBeInstanceOf(HcmInsufficientBalanceException);
  });

  it('fileTimeOff — throws HcmUnavailableException on non-axios error', async () => {
    // Covers line 104 — the final non-axios throw in handleHcmError
    jest.spyOn(require('axios'), 'isAxiosError').mockReturnValueOnce(false);
    mockPostError(new Error('unexpected'));
    await expect(hcmClient.fileTimeOff('emp1', 'locA', 2)).rejects.toBeInstanceOf(HcmUnavailableException);
  });

  // ── pushBatch ─────────────────────────────────────────────────────────────

  it('pushBatch — returns HCM response data on success', async () => {
    // Covers lines 67-74 — the entire pushBatch method
    mockPost({ synced: true });
    const result = await hcmClient.pushBatch([{ employeeId: 'emp1', locationId: 'locA', availableDays: 15 }]);
    expect(result).toEqual({ synced: true });
    expect(mockHttpService.post).toHaveBeenCalled();
  });

  it('pushBatch — throws HcmUnavailableException on failure', async () => {
    // Covers the catch branch of pushBatch
    jest.spyOn(require('axios'), 'isAxiosError').mockReturnValueOnce(false);
    mockPostError(new Error('network down'));
    await expect(
      hcmClient.pushBatch([{ employeeId: 'emp1', locationId: 'locA', availableDays: 15 }]),
    ).rejects.toBeInstanceOf(HcmUnavailableException);
  });
});

// ─── TimeOffService unit tests ────────────────────────────────────────────────

describe('TimeOffService', () => {
  let service: TimeOffService;
  let mockBalanceRepo: ReturnType<typeof makeMockBalanceRepo>;
  let mockRequestRepo: ReturnType<typeof makeMockRequestRepo>;
  let mockHcmClient: ReturnType<typeof makeMockHcmClient>;
  let mockManager: any;
  let mockDataSource: any;

  beforeEach(async () => {
    mockBalanceRepo = makeMockBalanceRepo();
    mockRequestRepo = makeMockRequestRepo();
    mockHcmClient = makeMockHcmClient();

    mockManager = {
      findOne: jest.fn(async (entity: any, options: any) => {
        if (entity === TimeOffRequest) return mockRequestRepo.findOneBy(options.where);
        if (entity === Balance) return mockBalanceRepo.findOneBy(options.where);
        return null;
      }),
      create: jest.fn((_entity: any, payload: any) => ({ ...payload })),
      save: jest.fn(async (entity: any, payload?: any) => {
        const target = payload ?? entity;
        if (target && target.status !== undefined) return mockRequestRepo.save(target);
        return mockBalanceRepo.save(target);
      }),
    };

    mockDataSource = {
      transaction: jest.fn(async (callback: any) => callback(mockManager)),
    };

    // Default save implementations
    mockBalanceRepo.save.mockImplementation(async (v: any) => ({ id: 'bal1', ...v }));
    mockRequestRepo.save.mockImplementation(async (v: any) => ({ id: 'req1', ...v }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimeOffService,
        { provide: getRepositoryToken(TimeOffRequest), useValue: mockRequestRepo },
        { provide: getRepositoryToken(Balance), useValue: mockBalanceRepo },
        { provide: HcmClientService, useValue: mockHcmClient },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<TimeOffService>(TimeOffService);
  });

  // ── createRequest ─────────────────────────────────────────────────────────

  it('creates a PENDING request when HCM balance is sufficient', async () => {
    mockRequestRepo.findOneBy.mockResolvedValue(null);
    mockBalanceRepo.findOneBy.mockResolvedValue(null);
    mockHcmClient.fetchBalance.mockResolvedValue({ employeeId: 'emp1', locationId: 'locA', availableDays: 5 });

    const result = await service.createRequest({
      employeeId: 'emp1', locationId: 'locA', days: 2,
      startDate: '2026-05-01', endDate: '2026-05-02',
    });

    expect(result.status).toEqual(RequestStatus.PENDING);
    expect(mockHcmClient.fetchBalance).toHaveBeenCalledWith('emp1', 'locA');
    expect(mockRequestRepo.save).toHaveBeenCalled();
  });

  it('throws BadRequestException when HCM balance is insufficient', async () => {
    mockRequestRepo.findOneBy.mockResolvedValue(null);
    mockBalanceRepo.findOneBy.mockResolvedValue(null);
    mockHcmClient.fetchBalance.mockResolvedValue({ employeeId: 'emp1', locationId: 'locA', availableDays: 1 });

    await expect(
      service.createRequest({ employeeId: 'emp1', locationId: 'locA', days: 2,
        startDate: '2026-05-01', endDate: '2026-05-02' }),
    ).rejects.toThrow('Insufficient HCM balance');
  });

  it('short-circuits with local cache and does NOT call HCM when local balance is insufficient', async () => {
    mockRequestRepo.findOneBy.mockResolvedValue(null);
    mockBalanceRepo.findOneBy.mockResolvedValue({ employeeId: 'emp1', locationId: 'locA', availableDays: 1 });

    await expect(
      service.createRequest({ employeeId: 'emp1', locationId: 'locA', days: 2,
        startDate: '2026-05-01', endDate: '2026-05-02' }),
    ).rejects.toThrow('Insufficient local balance');

    expect(mockHcmClient.fetchBalance).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when a duplicate request exists for the same dates', async () => {
    mockRequestRepo.findOneBy.mockResolvedValue({
      id: 'existing', employeeId: 'emp1', locationId: 'locA',
      startDate: '2026-05-01', endDate: '2026-05-02', status: RequestStatus.PENDING,
    });

    await expect(
      service.createRequest({ employeeId: 'emp1', locationId: 'locA', days: 2,
        startDate: '2026-05-01', endDate: '2026-05-02' }),
    ).rejects.toThrow('A request for the same dates already exists.');

    expect(mockHcmClient.fetchBalance).not.toHaveBeenCalled();
  });

  // ── getBalance ────────────────────────────────────────────────────────────

  it('returns cached balance without calling HCM when refresh=false and cache exists', async () => {
    const cached = { id: 'bal1', employeeId: 'emp1', locationId: 'locA', availableDays: 7, source: 'HCM' };
    mockBalanceRepo.findOneBy.mockResolvedValue(cached);

    const result = await service.getBalance('emp1', 'locA', false);

    expect(result.availableDays).toBe(7);
    expect(mockHcmClient.fetchBalance).not.toHaveBeenCalled();
  });

  it('defaults refresh to false when omitted and returns cached balance', async () => {
    const cached = { id: 'bal1', employeeId: 'emp1', locationId: 'locA', availableDays: 9, source: 'HCM' };
    mockBalanceRepo.findOneBy.mockResolvedValue(cached);

    const result = await service.getBalance('emp1', 'locA');

    expect(result.availableDays).toBe(9);
    expect(mockHcmClient.fetchBalance).not.toHaveBeenCalled();
  });

  it('updates existing cached balance when refresh=true', async () => {
    const cached = {
      id: 'bal1',
      employeeId: 'emp1',
      locationId: 'locA',
      availableDays: 5,
      source: 'HCM',
    };

    mockBalanceRepo.findOneBy.mockResolvedValue(cached);

    mockHcmClient.fetchBalance.mockResolvedValue({
      employeeId: 'emp1',
      locationId: 'locA',
      availableDays: 10,
    });

    mockBalanceRepo.save.mockImplementation(async (v: any) => v);

    const result = await service.getBalance('emp1', 'locA', true);

    expect(result.availableDays).toBe(10);
    expect(mockBalanceRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ availableDays: 10 }),
    );
  });

  it('fetches from HCM and updates cache when refresh=true', async () => {
    const cached = { id: 'bal1', employeeId: 'emp1', locationId: 'locA', availableDays: 7, source: 'HCM' };
    mockBalanceRepo.findOneBy.mockResolvedValue(cached);
    mockHcmClient.fetchBalance.mockResolvedValue({ employeeId: 'emp1', locationId: 'locA', availableDays: 12 });

    const result = await service.getBalance('emp1', 'locA', true);

    expect(result.availableDays).toBe(12);
    expect(mockHcmClient.fetchBalance).toHaveBeenCalledWith('emp1', 'locA');
    expect(mockBalanceRepo.save).toHaveBeenCalled();
  });

  it('fetches from HCM and creates cache entry when no local balance exists', async () => {
    mockBalanceRepo.findOneBy.mockResolvedValue(null);
    mockHcmClient.fetchBalance.mockResolvedValue({ employeeId: 'emp1', locationId: 'locA', availableDays: 10 });

    const result = await service.getBalance('emp1', 'locA', false);

    expect(result.availableDays).toBe(10);
    expect(mockHcmClient.fetchBalance).toHaveBeenCalled();
  });

  // ── approveRequest ────────────────────────────────────────────────────────

  it('approves a PENDING request, calls fileTimeOff, and updates local balance', async () => {
    mockRequestRepo.findOneBy.mockResolvedValue({
      id: 'req1', employeeId: 'emp1', locationId: 'locA', days: 2, status: RequestStatus.PENDING,
    });
    mockBalanceRepo.findOneBy.mockResolvedValue({
      id: 'bal1', employeeId: 'emp1', locationId: 'locA', availableDays: 5, source: 'HCM',
    });
    mockHcmClient.fetchBalance.mockResolvedValue({ employeeId: 'emp1', locationId: 'locA', availableDays: 5 });
    mockHcmClient.fileTimeOff.mockResolvedValue({ employeeId: 'emp1', locationId: 'locA', availableDays: 3 });
    mockBalanceRepo.save.mockImplementation(async (v: any) => v);
    mockRequestRepo.save.mockImplementation(async (v: any) => v);

    const result = await service.approveRequest('req1');

    expect(result.status).toEqual(RequestStatus.APPROVED);
    expect(mockHcmClient.fileTimeOff).toHaveBeenCalledWith('emp1', 'locA', 2);
    expect(mockBalanceRepo.save).toHaveBeenCalledWith(expect.objectContaining({ availableDays: 3 }));
  });

  it('throws BadRequestException when approving a non-PENDING request (double-approve guard)', async () => {
    // Covers line 85 — the status !== PENDING guard
    mockRequestRepo.findOneBy.mockResolvedValue({
      id: 'req1', employeeId: 'emp1', locationId: 'locA', days: 2, status: RequestStatus.APPROVED,
    });

    await expect(service.approveRequest('req1')).rejects.toThrow('Only pending requests can be approved.');
    expect(mockHcmClient.fileTimeOff).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when request does not exist', async () => {
    mockRequestRepo.findOneBy.mockResolvedValue(null);

    await expect(service.approveRequest('nonexistent')).rejects.toThrow(NotFoundException);
  });

  it('throws BadRequestException when local cached balance is insufficient at approve time', async () => {
    mockRequestRepo.findOneBy.mockResolvedValue({
      id: 'req1', employeeId: 'emp1', locationId: 'locA', days: 5, status: RequestStatus.PENDING,
    });
    mockBalanceRepo.findOneBy.mockResolvedValue({
      id: 'bal1', employeeId: 'emp1', locationId: 'locA', availableDays: 1, source: 'HCM',
    });

    await expect(service.approveRequest('req1')).rejects.toThrow('Insufficient local balance for approval.');
    expect(mockHcmClient.fileTimeOff).not.toHaveBeenCalled();
  });

  it('creates a new Balance row when no balance exists in DB at approve time', async () => {
    // Covers line 105 — the manager.create(Balance, ...) branch
    mockRequestRepo.findOneBy.mockResolvedValue({
      id: 'req1', employeeId: 'emp1', locationId: 'locA', days: 2, status: RequestStatus.PENDING,
    });
    // No balance in DB
    mockBalanceRepo.findOneBy.mockResolvedValue(null);
    mockHcmClient.fetchBalance.mockResolvedValue({ employeeId: 'emp1', locationId: 'locA', availableDays: 10 });
    mockHcmClient.fileTimeOff.mockResolvedValue({ employeeId: 'emp1', locationId: 'locA', availableDays: 8 });
    mockBalanceRepo.save.mockImplementation(async (v: any) => v);
    mockRequestRepo.save.mockImplementation(async (v: any) => v);

    const result = await service.approveRequest('req1');

    expect(result.status).toEqual(RequestStatus.APPROVED);
    // manager.create should have been used to build the new balance
    expect(mockManager.create).toHaveBeenCalledWith(
      Balance,
      expect.objectContaining({ employeeId: 'emp1', locationId: 'locA', availableDays: 8 }),
    );
  });

  it('throws BadRequestException when HCM returns a negative balance after filing', async () => {
    mockRequestRepo.findOneBy.mockResolvedValue({
      id: 'req1', employeeId: 'emp1', locationId: 'locA', days: 2, status: RequestStatus.PENDING,
    });
    mockBalanceRepo.findOneBy.mockResolvedValue({
      id: 'bal1', employeeId: 'emp1', locationId: 'locA', availableDays: 5, source: 'HCM',
    });
    mockHcmClient.fetchBalance.mockResolvedValue({ employeeId: 'emp1', locationId: 'locA', availableDays: 5 });
    mockHcmClient.fileTimeOff.mockResolvedValue({ employeeId: 'emp1', locationId: 'locA', availableDays: -1 });

    await expect(service.approveRequest('req1')).rejects.toThrow(
      'HCM returned invalid remaining balance after approval.',
    );
  });

  it('throws BadRequestException when HCM balance has drifted below request days at approve time', async () => {
    mockRequestRepo.findOneBy.mockResolvedValue({
      id: 'req1', employeeId: 'emp1', locationId: 'locA', days: 3, status: RequestStatus.PENDING,
    });
    // Local cache shows sufficient
    mockBalanceRepo.findOneBy.mockResolvedValue({
      id: 'bal1', employeeId: 'emp1', locationId: 'locA', availableDays: 5, source: 'HCM',
    });
    // But HCM now shows drift — only 1 day remains (anniversary deduction happened externally)
    mockHcmClient.fetchBalance.mockResolvedValue({ employeeId: 'emp1', locationId: 'locA', availableDays: 1 });

    await expect(service.approveRequest('req1')).rejects.toThrow(
      'Insufficient HCM balance for approval',
    );
    expect(mockHcmClient.fileTimeOff).not.toHaveBeenCalled();
  });

  // ── rejectRequest ─────────────────────────────────────────────────────────

  it('rejects a PENDING request and stores the rejection reason', async () => {
    mockRequestRepo.findOneBy.mockResolvedValue({
      id: 'req1', employeeId: 'emp1', locationId: 'locA', days: 2, status: RequestStatus.PENDING,
    });
    mockRequestRepo.save.mockImplementation(async (v: any) => v);

    const result = await service.rejectRequest('req1', 'Insufficient coverage');

    expect(result.status).toEqual(RequestStatus.REJECTED);
    expect(result.rejectionReason).toEqual('Insufficient coverage');
  });

  it('rejects a PENDING request without a reason (reason is optional)', async () => {
    mockRequestRepo.findOneBy.mockResolvedValue({
      id: 'req1', employeeId: 'emp1', locationId: 'locA', days: 2, status: RequestStatus.PENDING,
    });
    mockRequestRepo.save.mockImplementation(async (v: any) => v);

    const result = await service.rejectRequest('req1');

    expect(result.status).toEqual(RequestStatus.REJECTED);
    expect(result.rejectionReason).toBeUndefined();
  });

  it('throws BadRequestException when rejecting a non-PENDING request', async () => {
    mockRequestRepo.findOneBy.mockResolvedValue({
      id: 'req1', employeeId: 'emp1', locationId: 'locA', days: 2, status: RequestStatus.APPROVED,
    });

    await expect(service.rejectRequest('req1', 'Too late')).rejects.toThrow(
      'Only pending requests can be rejected.',
    );
  });

  it('throws NotFoundException when rejecting a non-existent request', async () => {
    mockRequestRepo.findOneBy.mockResolvedValue(null);

    await expect(service.rejectRequest('nonexistent', 'No reason')).rejects.toThrow(NotFoundException);
  });

  // ── syncBalances ──────────────────────────────────────────────────────────

  it('syncs balances via upsert and returns the updated rows', async () => {
    // Covers line 137 — the payload .map() inside syncBalances
    const items = [
      { employeeId: 'emp1', locationId: 'locA', availableDays: 15 },
      { employeeId: 'emp2', locationId: 'locB', availableDays: 8 },
    ];
    mockBalanceRepo.upsert.mockResolvedValue(undefined);
    mockBalanceRepo.find.mockResolvedValue([
      { id: 'b1', employeeId: 'emp1', locationId: 'locA', availableDays: 15, source: 'HCM' },
      { id: 'b2', employeeId: 'emp2', locationId: 'locB', availableDays: 8, source: 'HCM' },
    ]);

    const result = await service.syncBalances(items);

    expect(result).toHaveLength(2);
    expect(mockBalanceRepo.upsert).toHaveBeenCalledWith(
      [
        { employeeId: 'emp1', locationId: 'locA', availableDays: 15, source: 'HCM' },
        { employeeId: 'emp2', locationId: 'locB', availableDays: 8, source: 'HCM' },
      ],
      ['employeeId', 'locationId'],
    );
    expect(mockBalanceRepo.find).toHaveBeenCalled();
  });

  it('syncs a single balance item correctly', async () => {
    const items = [{ employeeId: 'emp2', locationId: 'locB', availableDays: 12 }];
    mockBalanceRepo.upsert.mockResolvedValue(undefined);
    mockBalanceRepo.find.mockResolvedValue([
      { id: 'b1', employeeId: 'emp2', locationId: 'locB', availableDays: 12, source: 'HCM' },
    ]);

    const result = await service.syncBalances(items);

    expect(result).toHaveLength(1);
    expect(mockBalanceRepo.upsert).toHaveBeenCalledWith(
      [{ employeeId: 'emp2', locationId: 'locB', availableDays: 12, source: 'HCM' }],
      ['employeeId', 'locationId'],
    );
  });

  // ── getRequests ───────────────────────────────────────────────────────────

  it('returns all requests ordered by requestedAt DESC with no filters', async () => {
    mockRequestRepo.find.mockResolvedValue([
      { id: 'req2', employeeId: 'emp1', requestedAt: new Date('2026-05-10') },
      { id: 'req1', employeeId: 'emp1', requestedAt: new Date('2026-05-01') },
    ]);

    const result = await service.getRequests({});

    expect(result).toHaveLength(2);
    expect(mockRequestRepo.find).toHaveBeenCalledWith({
      where: {},
      order: { requestedAt: 'DESC' },
    });
  });

  it('filters requests by employeeId when provided', async () => {
    mockRequestRepo.find.mockResolvedValue([{ id: 'req1', employeeId: 'emp1' }]);

    await service.getRequests({ employeeId: 'emp1' });

    expect(mockRequestRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { employeeId: 'emp1' } }),
    );
  });
});

// ─── DaysWithinDateRange validator unit tests ─────────────────────────────────

describe('CreateTimeOffRequestDto — DaysWithinDateRange validator', () => {
  // We test the validator constraint directly by importing and invoking it
  // This covers lines 22, 28, 33, 43 in create-time-off-request.dto.ts

  let constraint: any;

  beforeEach(async () => {
    const mod = await import('./dto/create-time-off-request.dto');
    // Access the internal constraint class via the ValidationMetadataStorage
    // Simpler: just use class-validator's validate() on a DTO instance
  });

  const { validate } = require('class-validator');
  const { plainToInstance } = require('class-transformer');

  const buildDto = (days: number, startDate: string, endDate: string) => {
    const { CreateTimeOffRequestDto } = require('./dto/create-time-off-request.dto');
    return plainToInstance(CreateTimeOffRequestDto, {
      employeeId: 'emp1',
      locationId: 'locA',
      days,
      startDate,
      endDate,
    });
  };

  it('passes validation for a valid full-day request (2 days, May 5–6)', async () => {
    const dto = buildDto(2, '2026-05-05', '2026-05-06');
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('passes validation for a half-day request (0.5 days, same day)', async () => {
    const dto = buildDto(0.5, '2026-05-05', '2026-05-05');
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('fails validation when days exceeds the calendar span', async () => {
    // Covers line 33 — the diffDays === days check (strict equality fails)
    const dto = buildDto(5, '2026-05-05', '2026-05-06'); // span is 2 days, days=5
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e: any) => e.property === 'days')).toBe(true);
  });

  it('fails validation when endDate is before startDate', async () => {
    // Covers line 28 — the diffMs < 0 guard
    const dto = buildDto(1, '2026-05-10', '2026-05-05');
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails validation when days is below minimum (less than 0.5)', async () => {
    const dto = buildDto(0.1, '2026-05-05', '2026-05-05');
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails validation when dates are invalid strings', async () => {
    // Covers line 22 — NaN date guard
    const { CreateTimeOffRequestDto } = require('./dto/create-time-off-request.dto');
    const dto = plainToInstance(CreateTimeOffRequestDto, {
      employeeId: 'emp1',
      locationId: 'locA',
      days: 1,
      startDate: 'not-a-date',
      endDate: 'also-not-a-date',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails validation when days is negative', async () => {
    const dto = buildDto(-1, '2026-05-05', '2026-05-06');
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});