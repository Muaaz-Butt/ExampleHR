import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { AppModule } from '../src/app.module';
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

    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
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

  it('exposes Swagger UI at /api/docs', async () => {
    const swaggerResponse = await request(app.getHttpServer()).get('/api/docs').expect(200);
    expect(swaggerResponse.header['content-type']).toMatch(/html/);
  });
});
