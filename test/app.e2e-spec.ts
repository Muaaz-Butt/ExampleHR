import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as request from 'supertest';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { AddressInfo } from 'net';

interface HcmStateItem {
  employeeId: string;
  locationId: string;
  availableDays: number;
}

function createMockHcmServer(state: HcmStateItem[]) {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '';
    if (req.method === 'GET' && url.startsWith('/hcm/balance')) {
      const params = new URLSearchParams(url.split('?')[1] || '');
      const employeeId = params.get('employeeId');
      const locationId = params.get('locationId');
      const balance = state.find((item) => item.employeeId === employeeId && item.locationId === locationId);
      if (!balance) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ employeeId, locationId, availableDays: 0 }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(balance));
      return;
    }

    if (req.method === 'POST' && url === '/hcm/timeoff') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const payload = JSON.parse(body || '{}');
        const item = state.find(
          (entry) => entry.employeeId === payload.employeeId && entry.locationId === payload.locationId,
        );
        if (!item || item.availableDays < payload.days) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Insufficient HCM balance' }));
          return;
        }
        item.availableDays -= payload.days;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(item));
      });
      return;
    }

    if (req.method === 'POST' && url === '/hcm/batch-sync') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const payload = JSON.parse(body || '{}');
        for (const incoming of payload.balances || []) {
          const existing = state.find(
            (item) => item.employeeId === incoming.employeeId && item.locationId === incoming.locationId,
          );
          if (existing) {
            existing.availableDays = incoming.availableDays;
          } else {
            state.push({ ...incoming });
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ synced: true }));
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return server;
}

describe('TimeOff Microservice (e2e)', () => {
  let app: INestApplication;
  let serverAddress: AddressInfo;
  let mockHcmServer: ReturnType<typeof createMockHcmServer>;
  const hcmState = [{ employeeId: 'emp1', locationId: 'locA', availableDays: 10 }];

  beforeAll(async () => {
    mockHcmServer = createMockHcmServer(hcmState);
    await new Promise<void>((resolve) => mockHcmServer.listen(0, '127.0.0.1', () => resolve()));
    serverAddress = mockHcmServer.address() as AddressInfo;
    process.env.HCM_API_BASE_URL = `http://127.0.0.1:${serverAddress.port}`;
    process.env.SQLITE_DB_PATH = ':memory:';

    const { AppModule } = await import('../src/app.module');
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  beforeEach(() => {
    hcmState.length = 1;
    hcmState[0] = { employeeId: 'emp1', locationId: 'locA', availableDays: 10 };
  });

  afterAll(async () => {
    await app.close();
    mockHcmServer.close();
  });

  it('creates a time-off request when HCM balance is available', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/time-off/requests')
      .send({
        employeeId: 'emp1',
        locationId: 'locA',
        days: 2,
        startDate: '2026-05-05',
        endDate: '2026-05-06',
      })
      .expect(201);

    expect(response.body).toHaveProperty('id');
    expect(response.body.status).toBe('PENDING');
  });

  it('approves a request and updates the cached balance', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/api/time-off/requests')
      .send({
        employeeId: 'emp1',
        locationId: 'locA',
        days: 2,
        startDate: '2026-05-10',
        endDate: '2026-05-11',
      })
      .expect(201);

    const requestId = createResponse.body.id;
    const approveResponse = await request(app.getHttpServer())
      .post(`/api/time-off/requests/${requestId}/approve`)
      .expect(201);

    expect(approveResponse.body.status).toBe('APPROVED');

    const balanceResponse = await request(app.getHttpServer())
      .get('/api/time-off/balances')
      .query({ employeeId: 'emp1', locationId: 'locA' })
      .expect(200);

    expect(balanceResponse.body.availableDays).toBe(8);
  });

  it('returns 400 when approving the same request twice', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/api/time-off/requests')
      .send({
        employeeId: 'emp1',
        locationId: 'locA',
        days: 1,
        startDate: '2026-07-01',
        endDate: '2026-07-01',
      })
      .expect(201);

    const requestId = createResponse.body.id;

    await request(app.getHttpServer())
      .post(`/api/time-off/requests/${requestId}/approve`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/time-off/requests/${requestId}/approve`)
      .expect(400);
  });

  it('returns 400 when rejecting an already approved request', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/api/time-off/requests')
      .send({
        employeeId: 'emp1',
        locationId: 'locA',
        days: 1,
        startDate: '2026-07-05',
        endDate: '2026-07-05',
      })
      .expect(201);

    const requestId = createResponse.body.id;

    await request(app.getHttpServer())
      .post(`/api/time-off/requests/${requestId}/approve`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/time-off/requests/${requestId}/reject`)
      .send({ rejectionReason: 'Coverage change' })
      .expect(400);
  });

  it('returns 400 when days does not match the date range', async () => {
    await request(app.getHttpServer())
      .post('/api/time-off/requests')
      .send({
        employeeId: 'emp1',
        locationId: 'locA',
        days: 3,
        startDate: '2026-07-10',
        endDate: '2026-07-11',
      })
      .expect(400);
  });

  it('returns 400 when submitting negative days', async () => {
    await request(app.getHttpServer())
      .post('/api/time-off/requests')
      .send({
        employeeId: 'emp1',
        locationId: 'locA',
        days: -1,
        startDate: '2026-07-10',
        endDate: '2026-07-11',
      })
      .expect(400);
  });

  it('refreshes HCM balance when refresh=true is passed', async () => {
    const employeeId = 'emp-refresh';
    const locationId = 'locX';
    hcmState.push({ employeeId, locationId, availableDays: 10 });

    await request(app.getHttpServer())
      .get('/api/time-off/balances')
      .query({ employeeId, locationId })
      .expect(200)
      .expect((res) => {
        expect(res.body.availableDays).toBe(10);
      });

    hcmState.find((item) => item.employeeId === employeeId && item.locationId === locationId)!.availableDays = 5;

    await request(app.getHttpServer())
      .get('/api/time-off/balances')
      .query({ employeeId, locationId, refresh: 'true' })
      .expect(200)
      .expect((res) => {
        expect(res.body.availableDays).toBe(5);
      });
  });

  it('lists requests filtered by employeeId', async () => {
    hcmState.push({ employeeId: 'emp2', locationId: 'locB', availableDays: 5 });

    await request(app.getHttpServer())
      .post('/api/time-off/requests')
      .send({
        employeeId: 'emp1',
        locationId: 'locA',
        days: 1,
        startDate: '2026-07-15',
        endDate: '2026-07-15',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/time-off/requests')
      .send({
        employeeId: 'emp2',
        locationId: 'locB',
        days: 1,
        startDate: '2026-07-16',
        endDate: '2026-07-16',
      })
      .expect(201);

    const listResponse = await request(app.getHttpServer())
      .get('/api/time-off/requests')
      .query({ employeeId: 'emp1' })
      .expect(200);

    expect(listResponse.body.every((item: any) => item.employeeId === 'emp1')).toBe(true);
  });

  it('returns 503 when HCM is unavailable for balance refresh', async () => {
    const { AppModule } = await import('../src/app.module');
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue({
        get: (key: string, defaultValue?: unknown) =>
          key === 'HCM_API_BASE_URL' ? 'http://127.0.0.1:1' : defaultValue,
      })
      .compile();

    const downApp = moduleFixture.createNestApplication();
    downApp.setGlobalPrefix('api');
    await downApp.init();

    await request(downApp.getHttpServer())
      .get('/api/time-off/balances')
      .query({ employeeId: 'emp1', locationId: 'locA' })
      .expect(503);

    await downApp.close();
  });

  it('returns updated balances after HCM batch sync', async () => {
    await request(app.getHttpServer())
      .post('/api/time-off/balances/sync')
      .send({ balances: [{ employeeId: 'emp1', locationId: 'locA', availableDays: 15 }] })
      .expect(201);

    const balanceResponse = await request(app.getHttpServer())
      .get('/api/time-off/balances')
      .query({ employeeId: 'emp1', locationId: 'locA' })
      .expect(200);

    expect(balanceResponse.body.availableDays).toBe(15);
  });

  it('rejects a new request when HCM balance has become insufficient', async () => {
    hcmState[0].availableDays = 1;
    await request(app.getHttpServer())
      .post('/api/time-off/requests')
      .send({
        employeeId: 'emp1',
        locationId: 'locA',
        days: 2,
        startDate: '2026-06-01',
        endDate: '2026-06-02',
      })
      .expect(400);
  });

  it('rejects a pending request and records a rejection reason', async () => {
    hcmState[0].availableDays = 10;

    const createResponse = await request(app.getHttpServer())
      .post('/api/time-off/requests')
      .send({
        employeeId: 'emp1',
        locationId: 'locA',
        days: 1,
        startDate: '2026-06-10',
        endDate: '2026-06-11',
      })
      .expect(201);

    const requestId = createResponse.body.id;

    const rejectResponse = await request(app.getHttpServer())
      .post(`/api/time-off/requests/${requestId}/reject`)
      .send({ rejectionReason: 'Coverage conflict' })
      .expect(201);

    expect(rejectResponse.body.status).toBe('REJECTED');
    expect(rejectResponse.body.rejectionReason).toBe('Coverage conflict');
  });

  it('returns HTTP 400 when getBalance is called without required query params', async () => {
    await request(app.getHttpServer()).get('/api/time-off/balances').expect(400);
  });

});
