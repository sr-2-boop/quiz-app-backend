import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { AccessKey, Attempt, CodeRun, Participant, Question, Test } from '../../src/models/index.js';

/** Spin up an in-memory MongoDB for this test file and wipe it between tests. */
export function useTestDb() {
  let mongod;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    await Promise.all([AccessKey, Attempt, CodeRun, Participant, Question, Test].map((m) => m.init()));
  });

  afterEach(async () => {
    await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod?.stop();
  });
}
