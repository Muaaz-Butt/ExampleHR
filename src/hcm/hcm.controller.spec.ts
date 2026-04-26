import { Test, TestingModule } from '@nestjs/testing';
import { HcmController } from './hcm.controller';
import { HcmService } from './hcm.service';
import { HcmBalanceQueryDto, HcmFileTimeOffDto, HcmBatchSyncDto } from './dto/hcm.dto';

describe('HcmController', () => {
  let controller: HcmController;
  let service: HcmService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HcmController],
      providers: [
        {
          provide: HcmService,
          useValue: {
            getBalance: jest.fn().mockReturnValue({ employeeId: 'emp1', locationId: 'locA', availableDays: 10 }),
            fileTimeOff: jest.fn().mockReturnValue({ employeeId: 'emp1', locationId: 'locA', availableDays: 8 }),
            batchSync: jest.fn().mockReturnValue([{ employeeId: 'emp1', locationId: 'locA', availableDays: 12 }]),
          },
        },
      ],
    }).compile();

    controller = module.get<HcmController>(HcmController);
    service = module.get<HcmService>(HcmService);
  });

  it('returns HCM balance from the service', () => {
    const result = controller.getBalance({ employeeId: 'emp1', locationId: 'locA' } as HcmBalanceQueryDto);
    expect(result).toEqual({ employeeId: 'emp1', locationId: 'locA', availableDays: 10 });
    expect(service.getBalance).toHaveBeenCalledWith('emp1', 'locA');
  });

  it('files time off through the service', () => {
    const result = controller.fileTimeOff({ employeeId: 'emp1', locationId: 'locA', days: 2 } as HcmFileTimeOffDto);
    expect(result).toEqual({ employeeId: 'emp1', locationId: 'locA', availableDays: 8 });
    expect(service.fileTimeOff).toHaveBeenCalledWith('emp1', 'locA', 2);
  });

  it('syncs balances through the service', () => {
    const payload = { balances: [{ employeeId: 'emp1', locationId: 'locA', availableDays: 12 }] } as HcmBatchSyncDto;
    const result = controller.batchSync(payload);
    expect(result).toEqual([{ employeeId: 'emp1', locationId: 'locA', availableDays: 12 }]);
    expect(service.batchSync).toHaveBeenCalledWith(payload.balances);
  });
});
