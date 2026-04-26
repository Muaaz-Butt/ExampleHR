import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { TimeOffService } from './time-off.service';
import { TimeOffRequest, RequestStatus } from './entities/time-off-request.entity';
import { Balance } from './entities/balance.entity';
import { HcmClientService } from '../common/hcm-client.service';

describe('TimeOffService', () => {
  let service: TimeOffService;
  let balanceRepo: Repository<Balance>;
  let requestRepo: Repository<TimeOffRequest>;
  let hcmClient: HcmClientService;
  let dataSource: DataSource;

  const mockBalanceRepo = {
    findOneBy: jest.fn(),
    save: jest.fn(),
    upsert: jest.fn(),
    find: jest.fn(),
  };

  const mockRequestRepo = {
    findOneBy: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
  };

  const mockHcmClient = {
    fetchBalance: jest.fn(),
    fileTimeOff: jest.fn(),
  };

  const mockManager = {
    findOne: jest.fn(async (entity: any, options: any) => {
      if (entity === TimeOffRequest) {
        return mockRequestRepo.findOneBy(options.where);
      }
      if (entity === Balance) {
        return mockBalanceRepo.findOneBy(options.where);
      }
      return null;
    }),
    create: jest.fn((entity: any, payload: any) => ({ ...payload })),
    save: jest.fn(async (entity: any) => {
      if (entity && entity.status !== undefined) {
        return mockRequestRepo.save(entity);
      }
      return mockBalanceRepo.save(entity);
    }),
  };

  const mockDataSource = {
    transaction: jest.fn(async (callback: any) => callback(mockManager)),
  };

  beforeEach(async () => {
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
    balanceRepo = module.get<Repository<Balance>>(getRepositoryToken(Balance));
    requestRepo = module.get<Repository<TimeOffRequest>>(getRepositoryToken(TimeOffRequest));
    hcmClient = module.get<HcmClientService>(HcmClientService);
    dataSource = module.get<DataSource>(DataSource);

    mockBalanceRepo.findOneBy.mockReset();
    mockBalanceRepo.save.mockReset().mockImplementation(async (value) => ({ id: 'bal1', ...value }));
    mockRequestRepo.findOneBy.mockReset();
    mockRequestRepo.save.mockReset().mockImplementation(async (value) => ({ id: 'req1', ...value }));
    mockRequestRepo.find.mockReset();
    mockHcmClient.fetchBalance.mockReset();
    mockHcmClient.fileTimeOff.mockReset();
    mockBalanceRepo.upsert.mockReset();
    mockBalanceRepo.find.mockReset();
    mockManager.findOne.mockReset().mockImplementation(async (entity: any, options: any) => {
      if (entity === TimeOffRequest) {
        return mockRequestRepo.findOneBy(options.where);
      }
      if (entity === Balance) {
        return mockBalanceRepo.findOneBy(options.where);
      }
      return null;
    });
    mockManager.create.mockReset().mockImplementation((entity: any, payload: any) => ({ ...payload }));
    mockManager.save.mockReset().mockImplementation(async (entity: any, payload?: any) => {
      const target = payload ?? entity;
      if (target && target.status !== undefined) {
        return mockRequestRepo.save(target);
      }
      return mockBalanceRepo.save(target);
    });
    mockDataSource.transaction.mockReset().mockImplementation(async (callback: any) => callback(mockManager));
  });

  it('should create a request when HCM balance is sufficient', async () => {
    mockHcmClient.fetchBalance.mockResolvedValue({ employeeId: 'emp1', locationId: 'locA', availableDays: 5 });
    mockRequestRepo.save.mockImplementation(async (value) => ({ id: 'req1', ...value }));

    const request = await service.createRequest({
      employeeId: 'emp1',
      locationId: 'locA',
      days: 2,
      startDate: '2026-05-01',
      endDate: '2026-05-02',
    });

    expect(request.status).toEqual(RequestStatus.PENDING);
    expect(mockHcmClient.fetchBalance).toHaveBeenCalledWith('emp1', 'locA');
    expect(mockRequestRepo.save).toHaveBeenCalled();
  });

  it('should reject a request when balance is insufficient', async () => {
    mockHcmClient.fetchBalance.mockResolvedValue({ employeeId: 'emp1', locationId: 'locA', availableDays: 1 });

    await expect(
      service.createRequest({
        employeeId: 'emp1',
        locationId: 'locA',
        days: 2,
        startDate: '2026-05-01',
        endDate: '2026-05-02',
      }),
    ).rejects.toThrow('Insufficient HCM balance');
  });

  it('should reject a request without calling HCM when a local cache is insufficient', async () => {
    mockBalanceRepo.findOneBy.mockResolvedValue({ employeeId: 'emp1', locationId: 'locA', availableDays: 1 });

    await expect(
      service.createRequest({
        employeeId: 'emp1',
        locationId: 'locA',
        days: 2,
        startDate: '2026-05-01',
        endDate: '2026-05-02',
      }),
    ).rejects.toThrow('Insufficient local balance');

    expect(mockHcmClient.fetchBalance).not.toHaveBeenCalled();
  });

  it('should approve a request and update local balance from HCM', async () => {
    mockRequestRepo.findOneBy.mockResolvedValue({
      id: 'req1',
      employeeId: 'emp1',
      locationId: 'locA',
      days: 2,
      status: RequestStatus.PENDING,
    });
    mockBalanceRepo.findOneBy.mockResolvedValue({
      employeeId: 'emp1',
      locationId: 'locA',
      availableDays: 5,
      source: 'HCM',
    });
    mockHcmClient.fileTimeOff.mockResolvedValue({ employeeId: 'emp1', locationId: 'locA', availableDays: 3 });
    mockBalanceRepo.save.mockImplementation(async (value) => value);
    mockRequestRepo.save.mockImplementation(async (request) => request);

    const result = await service.approveRequest('req1');

    expect(result.status).toEqual(RequestStatus.APPROVED);
    expect(mockHcmClient.fileTimeOff).toHaveBeenCalledWith('emp1', 'locA', 2);
    expect(mockBalanceRepo.save).toHaveBeenCalledWith(expect.objectContaining({ availableDays: 3 }));
  });

  it('should reject approval when local cached balance is insufficient', async () => {
    mockRequestRepo.findOneBy.mockResolvedValue({
      id: 'req1',
      employeeId: 'emp1',
      locationId: 'locA',
      days: 2,
      status: RequestStatus.PENDING,
    });
    mockBalanceRepo.findOneBy.mockResolvedValue({
      employeeId: 'emp1',
      locationId: 'locA',
      availableDays: 1,
      source: 'HCM',
    });

    await expect(service.approveRequest('req1')).rejects.toThrow('Insufficient local balance for approval.');
    expect(mockHcmClient.fileTimeOff).not.toHaveBeenCalled();
  });

  it('should sync balances from HCM batch updates', async () => {
    const items = [
      { employeeId: 'emp2', locationId: 'locB', availableDays: 12 },
    ];
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
    expect(mockBalanceRepo.find).toHaveBeenCalled();
  });

  it('should reject a pending time-off request', async () => {
    mockRequestRepo.findOneBy.mockResolvedValue({
      id: 'req1',
      employeeId: 'emp1',
      locationId: 'locA',
      days: 2,
      status: RequestStatus.PENDING,
    });
    mockRequestRepo.save.mockImplementation(async (request) => request);

    const result = await service.rejectRequest('req1', 'Insufficient coverage');

    expect(result.status).toEqual(RequestStatus.REJECTED);
    expect(result.rejectionReason).toEqual('Insufficient coverage');
  });
});
